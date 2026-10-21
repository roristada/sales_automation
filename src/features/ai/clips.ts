import { z } from "zod";
import { estimateVideoUsd, nearestDuration, type VideoModel } from "./openrouter";

/**
 * AI clips per scene (docs/AI_VIDEO_PLAN.md AI-3): the visual plan of each scene, the prompt the
 * scene-prompt model writes for it, and the honest label every AI clip carries.
 */

export const AI_CLIP_LABEL = "คลิป AI — สินค้าอาจไม่ตรงของจริง 100%";

export const VISUAL_MODES = ["product_motion", "ai_video"] as const;
export type VisualMode = (typeof VISUAL_MODES)[number];
export const VIDEO_TASKS = ["video_product", "video_lifestyle"] as const;
export type VideoTask = (typeof VIDEO_TASKS)[number];

export const VISUAL_MODE_LABEL: Record<VisualMode, string> = {
  product_motion: "ภาพสินค้า + motion graphics (ฟรี)",
  ai_video: "คลิป AI",
};
export const VIDEO_TASK_LABEL: Record<VideoTask, string> = {
  video_product: "สินค้าเคลื่อนไหว (ใช้รูปสินค้าเป็นเฟรมแรก)",
  video_lifestyle: "คนใช้งาน / บรรยากาศ",
};

export const GENERATION_STATUS_LABEL: Record<string, string> = {
  queued: "รอคิว",
  generating: "กำลังสร้าง",
  succeeded: "สร้างเสร็จ · รอตรวจ",
  failed: "ล้มเหลว",
  canceled: "ยกเลิกแล้ว",
};

export const DEFAULT_CLIP_SECONDS = 5;
export const MAX_PROMPT_CHARS = 2000;

export interface PlanScene {
  kindLabel: string;
  narration: string;
  on_screen_text: string;
}

export interface PlanFact {
  label: string;
  value: string;
}

export function buildVisualPlanPrompt(productName: string, category: string | null, facts: PlanFact[], scenes: PlanScene[]): string {
  const factLines = facts.length ? facts.map((f) => `- ${f.label}: ${f.value}`).join("\n") : "(ไม่มี)";
  const sceneLines = scenes.map((s, i) => `${i + 1}. [${s.kindLabel}] คำพูด: ${s.narration || "-"} | บนจอ: ${s.on_screen_text || "-"}`).join("\n");
  return `You plan the visuals of a short vertical (9:16) affiliate video for a Thai audience. For every scene decide:
- mode: "ai_video" for 2–4 scenes where an AI-generated clip adds the most (product in motion, product in use); "product_motion" for the rest (motion graphics over the product photo — always use it for price and call-to-action scenes)
- video_task: "video_product" when the clip should start from the product photo and show the product itself moving (rotation, close-up, light sweep); "video_lifestyle" for a person using it or a setting
- prompt: an English prompt for an image-to-video model, one paragraph, under 400 characters: subject, action, camera movement, lighting, background. For "product_motion" scenes give an empty string.

Rules:
- Describe only what the facts below support. Never add features, colours, materials, accessories or text that aren't listed.
- No real people's likeness, no celebrities, no brand logos other than the product's own, no on-screen text, no testimonials.
- Keep the product as in the photo: do not change its shape, colour or parts.
- People, if any, are generic adults; no children.

Product: ${productName}${category ? ` (${category})` : ""}
Verified facts:
${factLines}

Scenes (${scenes.length}, answer for each, in order):
${sceneLines}`;
}

export const VISUAL_PLAN_SCHEMA = {
  name: "visual_plan",
  schema: {
    type: "object",
    properties: {
      scenes: {
        type: "array",
        items: {
          type: "object",
          properties: { mode: { type: "string", enum: [...VISUAL_MODES] }, video_task: { type: "string", enum: [...VIDEO_TASKS] }, prompt: { type: "string" } },
          required: ["mode", "video_task", "prompt"],
          additionalProperties: false,
        },
      },
    },
    required: ["scenes"],
    additionalProperties: false,
  },
};

export interface VisualPlan {
  mode: VisualMode;
  video_task: VideoTask;
  prompt: string;
}

const planSchema = z.object({ scenes: z.array(z.object({ mode: z.enum(VISUAL_MODES), video_task: z.enum(VIDEO_TASKS), prompt: z.string() })) });

export function parseVisualPlanJson(value: unknown, sceneCount: number): { ok: true; plans: VisualPlan[] } | { ok: false; error: string } {
  const parsed = planSchema.safeParse(value);
  if (!parsed.success) return { ok: false, error: "คำตอบของ AI ไม่ตรงรูปแบบที่กำหนด ลองใหม่อีกครั้ง" };
  if (parsed.data.scenes.length !== sceneCount) return { ok: false, error: `AI ตอบมา ${parsed.data.scenes.length} ฉาก แต่สคริปต์มี ${sceneCount} ฉาก` };
  const plans = parsed.data.scenes.map((s) => ({ ...s, prompt: s.prompt.trim().slice(0, MAX_PROMPT_CHARS) }));
  const empty = plans.findIndex((p) => p.mode === "ai_video" && !p.prompt);
  if (empty >= 0) return { ok: false, error: `ฉากที่ ${empty + 1} เป็นคลิป AI แต่ไม่มี prompt` };
  return { ok: true, plans };
}

/** Why a scene can't be queued yet, or null. */
export function clipBlocker(plan: { mode: string; video_task: string; prompt: string } | null, firstFrameUrl: string | null): string | null {
  if (!plan || plan.mode !== "ai_video") return "ฉากนี้ใช้ภาพสินค้า + motion graphics — เปลี่ยนเป็น “คลิป AI” ก่อน";
  if (!plan.prompt.trim()) return "ใส่ prompt ก่อน (หรือกด “ให้ AI วางแผนภาพ”)";
  if (plan.video_task === "video_product" && !firstFrameUrl) return "สินค้าไม่มีรูป (http/https) ให้ใช้เป็นเฟรมแรก — ใส่ลิงก์รูปในหน้าสินค้า หรือเลือก “คนใช้งาน / บรรยากาศ”";
  return null;
}

/**
 * What will actually be sent for a clip with this model: a duration it supports, 720p (or the
 * closest it offers), and the estimated cost. Token-priced models get a cautious $0.15/s so the
 * spending caps still apply; the real cost is logged when OpenRouter reports it.
 */
export function clipSpec(model: Pick<VideoModel, "durations" | "resolutions" | "pricing"> | undefined, wantedSeconds: number, withImage: boolean) {
  const duration = nearestDuration(wantedSeconds, model?.durations ?? []);
  const res = model?.resolutions ?? [];
  const resolution = res.includes("720p") ? "720p" : res.includes("768p") ? "768p" : res.includes("480p") ? "480p" : res.includes("1080p") ? "1080p" : "720p";
  const usd = model ? estimateVideoUsd(model.pricing, duration, withImage) : null;
  return { duration, resolution, estUsd: usd ?? 0.15 * duration, priced: usd !== null };
}

/** Shown in the caption of a video that contains AI clips (platform policies on AI content). */
export const AI_CAPTION_NOTE = "มีภาพบางส่วนในคลิปนี้สร้างด้วย AI";

/**
 * Which scenes use an AI clip in the render (AI-4): every scene planned as "ai_video" needs an
 * approved clip; the rest keep their own media or the product photo. `missing` are 1-based scene
 * numbers that block rendering.
 */
export function resolveAiClips(
  scenes: { id: string }[],
  plans: { scene_id: string; mode: string }[],
  approved: { scene_id: string; asset_id: string | null }[],
): { assetByScene: Map<string, string>; missing: number[] } {
  const aiScenes = new Set(plans.filter((p) => p.mode === "ai_video").map((p) => p.scene_id));
  const clip = new Map(approved.filter((g) => g.asset_id).map((g) => [g.scene_id, g.asset_id!]));
  const assetByScene = new Map<string, string>();
  const missing: number[] = [];
  scenes.forEach((s, i) => {
    if (!aiScenes.has(s.id)) return;
    const asset = clip.get(s.id);
    if (asset) assetByScene.set(s.id, asset);
    else missing.push(i + 1);
  });
  return { assetByScene, missing };
}

export const missingClipsMessage = (missing: number[]) =>
  `ฉากที่ ${missing.join(", ")} ตั้งเป็นคลิป AI แต่ยังไม่มีคลิปที่อนุมัติ — กด “ใช้คลิปนี้” หรือเปลี่ยนฉากนั้นเป็นภาพสินค้า + motion graphics`;
