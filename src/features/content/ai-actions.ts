"use server";

import { z } from "zod";
import { parseJsonReply } from "@/features/ai/json";
import { runAiChat } from "@/features/ai/run";
import type { ChatContent } from "@/features/ai/openrouter";
import type { ActionResult } from "@/features/products/actions";
import { galleryList } from "@/features/products/schema";
import { getCurrentUser } from "@/lib/supabase/server";
import { buildScenePrompt, promptFacts } from "./ai-prompt";
import { buildScriptPrompt, parseScriptJson, SCRIPT_JSON_SCHEMA, type ScriptDraft } from "./ai-script";
import { buildFactExtractApiPrompt, FACT_JSON_SCHEMA, MAX_DESCRIPTION_CHARS, parseFactJson, type ParsedFact } from "./fact-extract";
import { loadStudio } from "./queries";
import { getTemplate, type Platform, PLATFORM_LABEL, SCENE_KIND_LABEL } from "./templates";
import { estimateSceneSeconds } from "./validate";

/*
 * AI through the API (docs/AI_VIDEO_PLAN.md AI-2). Each action makes one paid call via runAiChat
 * (caps checked, cost logged) and returns a draft for the user to preview; nothing is saved until
 * they apply it through the same actions as pasted AI text.
 */

const uuid = z.uuid();
const MAX_IMAGES = 5;

async function requireUser() {
  const { supabase, user } = await getCurrentUser();
  if (!supabase || !user) throw new Error("ยังไม่ได้เข้าสู่ระบบ");
  return { supabase, user };
}

const extractInput = z.object({ description: z.string().trim().min(1, "วางคำอธิบายสินค้าก่อน").max(MAX_DESCRIPTION_CHARS), useImages: z.boolean() });

/** Facts from the description (and the product's photos, if chosen), as a preview. */
export async function aiExtractFacts(productId: string, input: z.input<typeof extractInput>): Promise<ActionResult<{ facts: ParsedFact[]; images: number; costThb: number }>> {
  const parsed = extractInput.safeParse(input);
  if (!uuid.safeParse(productId).success || !parsed.success) return { ok: false, error: parsed.error?.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const { supabase, user } = await requireUser();
  const { data: product } = await supabase.from("products").select("name, image_url, gallery_urls").eq("id", productId).maybeSingle();
  if (!product) return { ok: false, error: "ไม่พบสินค้า" };
  const { data: existing } = await supabase.from("product_facts").select("label, value").eq("product_id", productId);
  const images = parsed.data.useImages ? [...new Set([product.image_url, ...galleryList(product.gallery_urls)].filter((u): u is string => !!u))].slice(0, MAX_IMAGES) : [];

  const prompt = buildFactExtractApiPrompt(product.name, parsed.data.description, existing ?? [], images.length);
  const content: ChatContent = images.length ? [{ type: "text", text: prompt }, ...images.map((url) => ({ type: "image_url" as const, image_url: { url } }))] : prompt;
  const run = await runAiChat(supabase, user.id, { task: "extract", messages: [{ role: "user", content }], schema: FACT_JSON_SCHEMA, maxTokens: 4000, temperature: 0, productId });
  if (!run.ok) return { ok: false, error: run.error };
  const result = parseFactJson(parseJsonReply(run.result.text), parsed.data.description, existing ?? []);
  if (result.error) return { ok: false, error: `${result.error} (ค่าใช้จ่ายครั้งนี้ ฿${run.costThb.toFixed(4)})` };
  return { ok: true, data: { facts: result.facts, images: images.length, costThb: run.costThb } };
}

/** One scene, with the same prompt as the copy button; the reply goes through the same parser. */
export async function aiWriteScene(sceneId: string, instruction: string): Promise<ActionResult<{ reply: string; codes: [string, string][]; costThb: number }>> {
  if (!uuid.safeParse(sceneId).success || instruction.length > 200) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const { supabase, user } = await requireUser();
  const { data: scene } = await supabase.from("storyboard_scenes").select("storyboard_id").eq("id", sceneId).maybeSingle();
  const bundle = scene && (await loadStudio(supabase, scene.storyboard_id));
  if (!bundle) return { ok: false, error: "ไม่พบฉาก" };
  if (bundle.storyboard.status === "approved") return { ok: false, error: "สคริปต์นี้อนุมัติแล้วจึงแก้ไขไม่ได้" };
  const s = bundle.scenes.find((x) => x.id === sceneId)!;
  const prompt = buildScenePrompt(
    { ...studioContext(bundle), instruction },
    {
      position: s.position,
      total: bundle.scenes.length,
      kindLabel: SCENE_KIND_LABEL[s.kind] ?? s.kind,
      narration: s.narration,
      on_screen_text: s.on_screen_text,
      visual_note: s.visual_note,
      estSeconds: estimateSceneSeconds(s.narration),
    },
    bundle.facts,
  );
  const run = await runAiChat(supabase, user.id, { task: "script", messages: [{ role: "user", content: prompt }], maxTokens: 3000, temperature: 0.7, productId: bundle.product.id, storyboardId: bundle.storyboard.id });
  if (!run.ok) return { ok: false, error: run.error };
  return { ok: true, data: { reply: run.result.text, codes: promptFacts(bundle.facts).map(({ code, fact }) => [code, fact.key]), costThb: run.costThb } };
}

/** The whole script in one call, as a checked draft to preview (applyAiScript saves it). */
export async function aiDraftScript(storyboardId: string, input: { instruction: string; confirmed?: boolean }): Promise<ActionResult<{ draft: ScriptDraft; warnings: string[]; costThb: number }> | { ok: false; error: string; needsConfirm: true }> {
  if (!uuid.safeParse(storyboardId).success || input.instruction.length > 300) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const { supabase, user } = await requireUser();
  const bundle = await loadStudio(supabase, storyboardId);
  if (!bundle) return { ok: false, error: "ไม่พบสคริปต์" };
  if (bundle.storyboard.status === "approved") return { ok: false, error: "สคริปต์นี้อนุมัติแล้วจึงแก้ไขไม่ได้ — สร้างเวอร์ชันใหม่เพื่อแก้" };
  const prompt = buildScriptPrompt(
    { ...studioContext(bundle), instruction: input.instruction },
    bundle.scenes.map((s) => ({ kindLabel: SCENE_KIND_LABEL[s.kind] ?? s.kind, narration: s.narration, on_screen_text: s.on_screen_text, visual_note: s.visual_note })),
    bundle.facts,
  );
  const run = await runAiChat(supabase, user.id, {
    task: "script",
    messages: [{ role: "user", content: prompt }],
    schema: SCRIPT_JSON_SCHEMA,
    maxTokens: 6000,
    temperature: 0.7,
    productId: bundle.product.id,
    storyboardId,
    confirmed: input.confirmed,
  });
  if (!run.ok) return run.needsConfirm ? { ok: false, error: run.error, needsConfirm: true } : { ok: false, error: run.error };
  const codes = new Map(promptFacts(bundle.facts).map(({ code, fact }) => [code, fact.key]));
  const result = parseScriptJson(parseJsonReply(run.result.text), codes, bundle.scenes.length);
  if (!result.ok) return { ok: false, error: `${result.errors.join(" · ")} (ค่าใช้จ่ายครั้งนี้ ฿${run.costThb.toFixed(4)})` };
  return { ok: true, data: { draft: result.value, warnings: result.warnings, costThb: run.costThb } };
}

function studioContext(bundle: NonNullable<Awaited<ReturnType<typeof loadStudio>>>) {
  return {
    productName: bundle.product.name,
    templateName: getTemplate(bundle.storyboard.template_id)?.name ?? bundle.storyboard.template_id,
    platformLabel: PLATFORM_LABEL[bundle.project.platform as Platform],
    targetSeconds: bundle.project.target_duration_s,
  };
}
