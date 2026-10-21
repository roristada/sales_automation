import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { type AiSpendSettings, DEFAULT_AI_SPEND } from "./budget";
import { type AiTask, parseModelPicks, usdToThb } from "./models";
import { type ChatResult, getKeyInfo, isOpenRouterConfigured, type KeyInfo, listTextModels, listVideoModels, OpenRouterError, type TextModel, type VideoModel } from "./openrouter";

type Db = SupabaseClient<Database>;

export interface AiSettings extends AiSpendSettings {
  models: Partial<Record<AiTask, string>>;
}

export async function getAiSettings(supabase: Db): Promise<AiSettings> {
  const { data } = await supabase.from("ai_settings").select("models, per_video_cap_thb, confirm_over_thb").maybeSingle();
  if (!data) return { models: {}, ...DEFAULT_AI_SPEND };
  return {
    models: parseModelPicks(data.models),
    per_video_cap_thb: data.per_video_cap_thb === null ? null : Number(data.per_video_cap_thb),
    confirm_over_thb: Number(data.confirm_over_thb),
  };
}

export type AccountStatus = { state: "not_configured" } | { state: "connected"; key: KeyInfo } | { state: "error"; message: string };

/** Key check against OpenRouter (free). Never returns the key itself. */
export async function getAccountStatus(): Promise<AccountStatus> {
  if (!isOpenRouterConfigured()) return { state: "not_configured" };
  try {
    return { state: "connected", key: await getKeyInfo() };
  } catch (e) {
    return { state: "error", message: e instanceof OpenRouterError ? e.message : "ตรวจสถานะ OpenRouter ไม่ได้" };
  }
}

// The catalogs are public and change slowly: cache per server process for an hour.
const CATALOG_TTL_MS = 3_600_000;
let catalog: { at: number; text: TextModel[]; video: VideoModel[] } | null = null;

export async function getCatalog(): Promise<{ text: TextModel[]; video: VideoModel[] } | { error: string }> {
  if (catalog && Date.now() - catalog.at < CATALOG_TTL_MS) return catalog;
  try {
    const [text, video] = await Promise.all([listTextModels(), listVideoModels()]);
    catalog = { at: Date.now(), text, video };
    return catalog;
  } catch (e) {
    return { error: e instanceof OpenRouterError ? e.message : "โหลดรายชื่อโมเดลไม่ได้" };
  }
}

export interface AiRequestLog {
  task: AiTask | "test" | "tts";
  model: string;
  productId?: string | null;
  storyboardId?: string | null;
}

/** Logs one call with the owner's session. Failed calls are logged too (cost 0 unless reported). */
export async function logAiRequest(supabase: Db, ownerId: string, log: AiRequestLog, outcome: { result: ChatResult } | { error: string }) {
  const r = "result" in outcome ? outcome.result : null;
  return supabase.from("ai_requests").insert({
    owner_id: ownerId,
    task: log.task,
    model: r?.model ?? log.model,
    status: r ? "succeeded" : "failed",
    generation_id: r?.generationId ?? null,
    input_tokens: r?.inputTokens ?? null,
    output_tokens: r?.outputTokens ?? null,
    cost_usd: r?.costUsd ?? 0,
    cost_thb: usdToThb(r?.costUsd ?? 0),
    error: "error" in outcome ? outcome.error.slice(0, 1000) : null,
    product_id: log.productId ?? null,
    storyboard_id: log.storyboardId ?? null,
  });
}
