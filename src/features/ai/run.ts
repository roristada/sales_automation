import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { checkAiSpend } from "./budget";
import { type AiTask, modelFor, usdToThb } from "./models";
import { chat, type ChatInput, type ChatResult, isOpenRouterConfigured, OpenRouterError } from "./openrouter";
import { getAiSettings, getCatalog, logAiRequest } from "./queries";

type Db = SupabaseClient<Database>;

export type AiRun = { ok: true; result: ChatResult; costThb: number } | { ok: false; error: string; needsConfirm?: boolean };

/** Rough upper estimate in THB from catalog prices: ~1 token per 2 characters in, maxTokens out. */
async function estimateThb(model: string, inputChars: number, maxTokens: number): Promise<number> {
  const catalog = await getCatalog();
  const m = "error" in catalog ? undefined : catalog.text.find((x) => x.id === model);
  // Unknown price: assume a mid-priced model ($3 / $15 per million) so caps still bite.
  const prompt = m?.prompt ?? 0.000003;
  const completion = m?.completion ?? 0.000015;
  return usdToThb((inputChars / 2) * prompt + maxTokens * completion);
}

const messageChars = (messages: ChatInput["messages"]) =>
  messages.reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : m.content.reduce((k, p) => k + (p.type === "text" ? p.text.length : 1500), 0)), 0);

/**
 * One paid text call for a task: model from the user's settings, spending caps checked first,
 * result (or failure) logged in ai_requests with the cost OpenRouter reports.
 */
export async function runAiChat(
  supabase: Db,
  userId: string,
  input: { task: AiTask; messages: ChatInput["messages"]; schema?: ChatInput["schema"]; maxTokens: number; temperature?: number; productId?: string | null; storyboardId?: string | null; confirmed?: boolean },
): Promise<AiRun> {
  if (!isOpenRouterConfigured()) return { ok: false, error: "ยังไม่ได้ตั้งค่า AI ผ่าน API — ใส่ OPENROUTER_API_KEY ใน .env.local (หรือใช้ปุ่มคัดลอกคำสั่งไปแชท AI แทน)" };
  const settings = await getAiSettings(supabase);
  const model = modelFor(input.task, settings.models);
  const [{ data: limits }, { data: spent }, videoSpent, estimate] = await Promise.all([
    supabase.from("spending_limits").select("daily_thb, monthly_thb").maybeSingle(),
    supabase.rpc("spend_summary"),
    input.storyboardId
      ? supabase
          .from("ai_requests")
          .select("cost_thb")
          .eq("storyboard_id", input.storyboardId)
          .then(({ data }) => (data ?? []).reduce((n, r) => n + Number(r.cost_thb), 0))
      : Promise.resolve(undefined),
    estimateThb(model, messageChars(input.messages), input.maxTokens),
  ]);
  const guard = checkAiSpend({
    limits,
    spent: { today_thb: Number(spent?.[0]?.today_thb ?? 0), month_thb: Number(spent?.[0]?.month_thb ?? 0) },
    settings,
    videoSpent,
    estimate,
    confirmed: input.confirmed,
  });
  if (!guard.ok) return { ok: false, error: guard.message, needsConfirm: guard.needsConfirm };

  const log = { task: input.task, model, productId: input.productId, storyboardId: input.storyboardId };
  try {
    const result = await chat({ model, messages: input.messages, schema: input.schema, maxTokens: input.maxTokens, temperature: input.temperature, reasoningEffort: "low", timeoutMs: 90_000 });
    await logAiRequest(supabase, userId, log, { result });
    if (result.finishReason === "length") return { ok: false, error: "คำตอบของ AI ยาวเกินกำหนดจนถูกตัด ลองใหม่หรือเลือกโมเดลอื่นในหน้าตั้งค่า" };
    if (!result.text.trim()) return { ok: false, error: "AI ไม่ได้ส่งข้อความกลับ ลองใหม่อีกครั้ง" };
    return { ok: true, result, costThb: usdToThb(result.costUsd) };
  } catch (e) {
    const error = e instanceof OpenRouterError ? e.message : "เรียก AI ไม่สำเร็จ";
    await logAiRequest(supabase, userId, log, { error });
    return { ok: false, error };
  }
}
