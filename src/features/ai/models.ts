import type { SpeechModel, TextModel, VideoModel } from "./openrouter";

/**
 * AI tasks and their default models (docs/AI_VIDEO_PLAN.md §4). Model ids are only defaults: the
 * user picks per task in Settings from the live catalog, and a pick that disappears from the
 * catalog is flagged instead of silently replaced.
 */
export const AI_TASKS = ["script", "extract", "scene_prompt", "review", "video_product", "video_lifestyle", "tts"] as const;
export type AiTask = (typeof AI_TASKS)[number];

export const TASK_KIND: Record<AiTask, "text" | "video" | "speech"> = {
  script: "text",
  extract: "text",
  scene_prompt: "text",
  review: "text",
  video_product: "video",
  video_lifestyle: "video",
  tts: "speech",
};

export const TASK_LABEL: Record<AiTask | "test", string> = {
  test: "ทดสอบการเชื่อมต่อ",
  script: "เขียนสคริปต์",
  extract: "กรอกข้อมูล + ดึงข้อเท็จจริง",
  scene_prompt: "เขียน prompt ภาพแต่ละฉาก",
  review: "ตรวจคลิปที่ได้",
  video_product: "คลิปสินค้าเคลื่อนไหว",
  video_lifestyle: "คลิปคนใช้งาน/บรรยากาศ",
  tts: "เสียงพากย์",
};

export const TASK_HINT: Record<AiTask, string> = {
  script: "ต้องรองรับ JSON schema · ตัดสินจากคุณภาพภาษาไทย",
  extract: "ต้องรองรับ JSON schema และอ่านรูปได้ (รูปสเปก)",
  scene_prompt: "ต้องรองรับ JSON schema",
  review: "ต้องรับวิดีโอได้ · ช่วยคนตรวจ ไม่แทนคน",
  video_product: "ต้องรองรับ 9:16 และรูปสินค้าเป็นเฟรมแรก",
  video_lifestyle: "ต้องรองรับ 9:16",
  tts: "ต้องพูดไทยได้ — ฟังเทียบก่อนเลือก",
};

export const DEFAULT_MODELS: Record<AiTask, string> = {
  script: "deepseek/deepseek-v4.1-flash",
  extract: "deepseek/deepseek-v4.1-flash",
  scene_prompt: "deepseek/deepseek-v4.1-flash",
  review: "z-ai/glm-5.3-flash",
  video_product: "kwaivgi/kling-v3.0-std",
  video_lifestyle: "google/veo-3.1-fast",
  tts: "google/gemini-3.8-flash-tts",
};

/** The cheap model used by the paid connection test (a few hundred tokens ≈ ฿0.001). */
export const TEST_MODEL = DEFAULT_MODELS.script;

const MODEL_ID = /^[a-z0-9][\w.-]*\/[\w.:~-]+$/i;

/** Stored picks, keeping only known tasks with a well-formed model id. */
export function parseModelPicks(value: unknown): Partial<Record<AiTask, string>> {
  const out: Partial<Record<AiTask, string>> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const task of AI_TASKS) {
    const v = (value as Record<string, unknown>)[task];
    if (typeof v === "string" && v.length <= 200 && MODEL_ID.test(v)) out[task] = v;
  }
  return out;
}

export function modelFor(task: AiTask, picks: Partial<Record<AiTask, string>>): string {
  return picks[task] ?? DEFAULT_MODELS[task];
}

/** Catalog models a task can use. */
export function textModelsFor(task: AiTask, models: TextModel[]): TextModel[] {
  return models.filter((m) => {
    if (!m.structuredOutputs) return false;
    if (task === "extract") return m.inputModalities.includes("image");
    if (task === "review") return m.inputModalities.includes("video");
    return true;
  });
}

/** Speech models, cheapest first (free ones on top). */
export function speechModelsFor(models: SpeechModel[]): SpeechModel[] {
  return [...models].sort((a, b) => a.prompt + a.completion - (b.prompt + b.completion));
}

export function videoModelsFor(task: AiTask, models: VideoModel[]): VideoModel[] {
  return models.filter((m) => m.aspectRatios.includes("9:16") && (task !== "video_product" || m.frameImages.includes("first_frame")));
}

/** USD→THB for logging and caps. OpenRouter bills in USD; the rate is an estimate from env. */
export function usdThbRate(): number {
  const v = Number(process.env.USD_THB_RATE ?? "35");
  return Number.isFinite(v) && v > 0 ? v : 35;
}

export function usdToThb(usd: number, rate = usdThbRate()): number {
  return Math.round(usd * rate * 10_000) / 10_000;
}

/** "$0.03 / $0.12 ต่อล้าน token" for text models. */
export function textPriceLabel(m: Pick<TextModel, "prompt" | "completion">): string {
  if (m.prompt === 0 && m.completion === 0) return "ฟรี";
  const per = (n: number) => `$${(n * 1_000_000).toFixed(n * 1_000_000 < 1 ? 3 : 2).replace(/0+$/, "").replace(/\.$/, "")}`;
  return `${per(m.prompt)} / ${per(m.completion)} ต่อล้าน token`;
}
