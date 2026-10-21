"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AI_TASKS, type AiTask, isModelId, speechModelsFor, TASK_KIND, textModelsFor, VIDEO_OVERRIDE_TASKS, videoModelsFor } from "@/features/ai/models";
import { VISUAL_LEVELS } from "@/features/ai/clips";
import { getCatalog } from "@/features/ai/queries";
import { VOICE_PATTERN } from "@/features/ai/voiceover";
import type { ActionResult } from "@/features/products/actions";
import { productInputSchema } from "@/features/products/schema";
import { getCurrentUser } from "@/lib/supabase/server";

/*
 * Video workspace (one page per video): the video's own AI picks over the Settings defaults,
 * and the product photo links, edited without leaving the page.
 */

const uuid = z.uuid();

async function requireUser() {
  const { supabase, user } = await getCurrentUser();
  if (!supabase || !user) throw new Error("ยังไม่ได้เข้าสู่ระบบ");
  return { supabase, user };
}

const settingsSchema = z.object({
  /** "" or missing = use the Settings default. */
  models: z.record(z.string(), z.string()),
  ttsVoice: z.string().trim().max(100),
  visualLevel: z.enum(VISUAL_LEVELS),
});

/** Saves this video's AI picks (all its script versions). Empty = back to the Settings default. */
export async function saveVideoSettings(projectId: string, input: z.input<typeof settingsSchema>): Promise<ActionResult<null>> {
  const parsed = settingsSchema.safeParse(input);
  if (!uuid.safeParse(projectId).success || !parsed.success) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const models: Partial<Record<AiTask, string>> = {};
  for (const [task, id] of Object.entries(parsed.data.models)) {
    if (!id) continue;
    if (!(VIDEO_OVERRIDE_TASKS as readonly string[]).includes(task) || !(AI_TASKS as readonly string[]).includes(task) || !isModelId(id)) return { ok: false, error: "รหัสโมเดลไม่ถูกต้อง" };
    models[task as AiTask] = id;
  }
  const voice = parsed.data.ttsVoice;
  if (voice && !VOICE_PATTERN.test(voice)) return { ok: false, error: "ชื่อเสียงใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข และ _ . : -" };

  // A pick must fit its task (same lists as the dropdowns), when the catalog can be checked.
  const catalog = await getCatalog();
  if (!("error" in catalog)) {
    for (const [task, id] of Object.entries(models) as [AiTask, string][]) {
      const kind = TASK_KIND[task];
      const ok =
        kind === "text" ? textModelsFor(task, catalog.text).some((m) => m.id === id) : kind === "video" ? videoModelsFor(task, catalog.video).some((m) => m.id === id) : speechModelsFor(catalog.speech).some((m) => m.id === id);
      if (!ok) return { ok: false, error: `${id} ใช้กับงานนี้ไม่ได้ — เลือกรุ่นอื่น` };
    }
  }

  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("content_projects")
    .update({ ai_overrides: { models, visual_level: parsed.data.visualLevel, ...(voice ? { tts_voice: voice } : {}) } })
    .eq("id", projectId)
    .select("id, storyboards(id)")
    .maybeSingle();
  if (error) return { ok: false, error: `บันทึกไม่สำเร็จ: ${error.message}` };
  if (!data) return { ok: false, error: "ไม่พบวิดีโอ หรือไม่มีสิทธิ์แก้ไข" };
  for (const s of data.storyboards) revalidatePath(`/workspace/${s.id}`);
  return { ok: true, data: null };
}

const imagesSchema = productInputSchema.pick({ image_url: true, gallery_urls: true });

/** The product's main photo and extra photos (the main one is the AI clips' first frame). */
export async function updateProductImages(productId: string, input: { image_url: string; gallery_urls: string }): Promise<ActionResult<null> | { ok: false; error: string; fieldErrors: Record<string, string> }> {
  if (!uuid.safeParse(productId).success) return { ok: false, error: "รหัสไม่ถูกต้อง" };
  const parsed = imagesSchema.safeParse({ image_url: input.image_url.trim() || null, gallery_urls: input.gallery_urls });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { ok: false, error: Object.values(fieldErrors)[0] ?? "ลิงก์ไม่ถูกต้อง", fieldErrors };
  }
  const { supabase } = await requireUser();
  const { error, count } = await supabase.from("products").update(parsed.data, { count: "exact" }).eq("id", productId);
  if (error) return { ok: false, error: `บันทึกไม่สำเร็จ: ${error.message}` };
  if (!count) return { ok: false, error: "ไม่พบสินค้า หรือไม่มีสิทธิ์แก้ไข" };
  revalidatePath(`/products/${productId}`);
  return { ok: true, data: null };
}
