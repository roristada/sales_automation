"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AI_TASKS, DEFAULT_MODELS, parseModelPicks, TEST_MODEL, usdToThb } from "@/features/ai/models";
import { VOICE_PATTERN } from "@/features/ai/voiceover";
import { chat, isOpenRouterConfigured, OpenRouterError } from "@/features/ai/openrouter";
import { logAiRequest } from "@/features/ai/queries";
import { checkBudget } from "@/features/usage/budget";
import { getCurrentUser } from "@/lib/supabase/server";

export interface ProfileState {
  error?: string;
  message?: string;
}

const schema = z.object({ display_name: z.string().trim().max(80, "ชื่อยาวเกิน 80 ตัวอักษร") });

export async function updateProfile(_prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const parsed = schema.safeParse({ display_name: formData.get("display_name") ?? "" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase, user } = await getCurrentUser();
  if (!supabase || !user) return { error: "ยังไม่ได้เข้าสู่ระบบ" };

  const { error } = await supabase
    .from("profiles")
    .update({ display_name: parsed.data.display_name || null })
    .eq("id", user.id);
  if (error) return { error: `บันทึกไม่สำเร็จ: ${error.message}` };
  revalidatePath("/", "layout");
  return { message: "บันทึกแล้ว" };
}

export interface LimitsState {
  error?: string;
  fieldErrors?: Partial<Record<"daily_thb" | "monthly_thb", string>>;
  message?: string;
}

const money = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z.coerce.number({ error: "ต้องเป็นตัวเลข" }).min(0, "ต้องไม่ติดลบ").max(10_000_000, "มากเกินไป").nullable(),
);
const limitsSchema = z.object({ daily_thb: money, monthly_thb: money });

/** Daily/monthly spending caps in THB. Empty = no cap. */
export async function saveSpendingLimits(_prev: LimitsState, formData: FormData): Promise<LimitsState> {
  const parsed = limitsSchema.safeParse({ daily_thb: formData.get("daily_thb") ?? "", monthly_thb: formData.get("monthly_thb") ?? "" });
  if (!parsed.success) {
    const fe: LimitsState["fieldErrors"] = {};
    for (const i of parsed.error.issues) fe[i.path[0] as "daily_thb"] ??= i.message;
    return { fieldErrors: fe };
  }
  const { supabase, user } = await getCurrentUser();
  if (!supabase || !user) return { error: "ยังไม่ได้เข้าสู่ระบบ" };
  const { error } = await supabase.from("spending_limits").upsert({ owner_id: user.id, ...parsed.data }, { onConflict: "owner_id" });
  if (error) return { error: `บันทึกไม่สำเร็จ: ${error.message}` };
  revalidatePath("/settings");
  return { message: "บันทึกเพดานค่าใช้จ่ายแล้ว" };
}

export interface AiSettingsState {
  error?: string;
  fieldErrors?: Partial<Record<"per_video_cap_thb" | "confirm_over_thb" | "tts_voice", string>>;
  message?: string;
}

const aiSpendSchema = z.object({
  per_video_cap_thb: money,
  confirm_over_thb: z.coerce.number({ error: "ต้องเป็นตัวเลข" }).min(0, "ต้องไม่ติดลบ").max(10_000_000, "มากเกินไป"),
  tts_voice: z
    .string()
    .trim()
    .transform((s) => s || null)
    .pipe(z.string().regex(VOICE_PATTERN, "ใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข และ _ . : -").nullable()),
});

/** Model per AI task (from the catalog dropdowns), per-video cap and confirm threshold. */
export async function saveAiSettings(_prev: AiSettingsState, formData: FormData): Promise<AiSettingsState> {
  const parsed = aiSpendSchema.safeParse({ per_video_cap_thb: formData.get("per_video_cap_thb") ?? "", confirm_over_thb: formData.get("confirm_over_thb") ?? "", tts_voice: formData.get("tts_voice") ?? "" });
  if (!parsed.success) {
    const fe: AiSettingsState["fieldErrors"] = {};
    for (const i of parsed.error.issues) fe[i.path[0] as "confirm_over_thb" | "tts_voice"] ??= i.message;
    return { fieldErrors: fe };
  }
  const picks = Object.fromEntries(AI_TASKS.map((t) => [t, formData.get(`model_${t}`)]).filter(([, v]) => typeof v === "string" && v));
  const models = parseModelPicks(picks);
  if (Object.keys(models).length !== Object.keys(picks).length) return { error: "รหัสโมเดลไม่ถูกต้อง" };
  // Store only picks that differ from the default, so a later default change still applies.
  for (const t of AI_TASKS) if (models[t] === DEFAULT_MODELS[t]) delete models[t];

  const { supabase, user } = await getCurrentUser();
  if (!supabase || !user) return { error: "ยังไม่ได้เข้าสู่ระบบ" };
  const { error } = await supabase.from("ai_settings").upsert({ owner_id: user.id, models, ...parsed.data }, { onConflict: "owner_id" });
  if (error) return { error: `บันทึกไม่สำเร็จ: ${error.message}` };
  revalidatePath("/settings");
  return { message: "บันทึกการตั้งค่า AI แล้ว" };
}

export type TestAiResult = { ok: true; reply: string; model: string; costThb: number } | { ok: false; error: string };

/** One real, tiny OpenRouter call (≈ ฿0.001), logged in ai_requests like any paid call. */
export async function testOpenRouter(): Promise<TestAiResult> {
  if (!isOpenRouterConfigured()) return { ok: false, error: "ยังไม่ได้ตั้งค่า OPENROUTER_API_KEY ใน .env.local" };
  const { supabase, user } = await getCurrentUser();
  if (!supabase || !user) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };
  const [{ data: limits }, { data: spent }] = await Promise.all([supabase.from("spending_limits").select("daily_thb, monthly_thb").maybeSingle(), supabase.rpc("spend_summary")]);
  const budget = checkBudget(limits, { today_thb: Number(spent?.[0]?.today_thb ?? 0), month_thb: Number(spent?.[0]?.month_thb ?? 0) }, 0.01);
  if (!budget.ok) return { ok: false, error: budget.message };

  const log = { task: "test", model: TEST_MODEL } as const;
  try {
    const result = await chat({
      model: TEST_MODEL,
      messages: [{ role: "user", content: "ตอบกลับสั้นๆ เป็นภาษาไทยหนึ่งประโยคว่าเชื่อมต่อสำเร็จ" }],
      maxTokens: 400,
      reasoningEffort: "low",
      timeoutMs: 30_000,
    });
    const { error } = await logAiRequest(supabase, user.id, log, { result });
    revalidatePath("/settings");
    if (error) return { ok: false, error: `เรียก AI สำเร็จแต่บันทึกค่าใช้จ่ายไม่ได้: ${error.message}` };
    return { ok: true, reply: result.text.trim().slice(0, 200) || "(โมเดลไม่ได้ส่งข้อความกลับ)", model: result.model, costThb: usdToThb(result.costUsd) };
  } catch (e) {
    const message = e instanceof OpenRouterError ? e.message : "เรียก OpenRouter ไม่สำเร็จ";
    await logAiRequest(supabase, user.id, log, { error: message });
    revalidatePath("/settings");
    return { ok: false, error: message };
  }
}
