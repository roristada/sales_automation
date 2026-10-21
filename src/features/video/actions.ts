"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/features/products/actions";
import { getCurrentUser } from "@/lib/supabase/server";
import { checkBudget, estimateRenderCost } from "@/features/usage/budget";
import { checkAiSpend } from "@/features/ai/budget";
import { missingClipsMessage, resolveAiClips } from "@/features/ai/clips";
import { modelFor, usdToThb } from "@/features/ai/models";
import { isOpenRouterConfigured } from "@/features/ai/openrouter";
import { getAiSettings, getCatalog } from "@/features/ai/queries";
import { estimateVoiceoverUsd, speechText, TTS_INSTRUCTIONS, voiceFor } from "@/features/ai/voiceover";
import { speechCacheKey } from "@/features/ai/voiceover-key";
import { licenseVerdict } from "@/features/assets/licensing";
import { buildTimeline, RENDERER_VERSION, VIDEO } from "./timeline";

const uuid = z.uuid();

export interface RenderOptions {
  /** Thai voice-over through OpenRouter TTS (AI-5). */
  voice?: boolean;
  /** Background music: an audio asset from the library. */
  musicAssetId?: string | null;
  /** The user confirmed a voice-over estimated above the confirm threshold. */
  confirmed?: boolean;
}

/**
 * Queues a render of an approved storyboard. Idempotent: if a job for it is already queued or
 * running, that job is returned instead of a second one (DB partial unique index). A voice-over
 * goes through the AI spend guard first; lines already in the speech cache cost nothing.
 */
export async function queueRender(storyboardId: string, opts: RenderOptions = {}): Promise<ActionResult<{ jobId: string; existing: boolean }> | { ok: false; error: string; needsConfirm: true }> {
  if (!uuid.safeParse(storyboardId).success || (opts.musicAssetId && !uuid.safeParse(opts.musicAssetId).success)) return { ok: false, error: "รหัสไม่ถูกต้อง" };
  const { supabase, user } = await getCurrentUser();
  if (!supabase || !user) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };

  const { data: sb } = await supabase.from("storyboards").select("id, status").eq("id", storyboardId).maybeSingle();
  if (!sb) return { ok: false, error: "ไม่พบสคริปต์" };
  if (sb.status !== "approved") return { ok: false, error: "ต้องอนุมัติสคริปต์ใน Script Studio ก่อน render" };

  const [{ data: scenes }, { data: plans }, { data: approvedClips }] = await Promise.all([
    supabase.from("storyboard_scenes").select("id, kind, narration, on_screen_text").eq("storyboard_id", storyboardId).order("position"),
    supabase.from("scene_visual_plans").select("scene_id, mode").eq("storyboard_id", storyboardId),
    supabase.from("scene_generations").select("scene_id, asset_id").eq("storyboard_id", storyboardId).eq("review_status", "approved"),
  ]);
  // Every scene planned as an AI clip needs an approved clip (AI-4).
  const clips = resolveAiClips(scenes ?? [], plans ?? [], approvedClips ?? []);
  if (clips.missing.length) return { ok: false, error: missingClipsMessage(clips.missing) };

  let music: string | null = null;
  if (opts.musicAssetId) {
    const { data: asset } = await supabase.from("assets").select("id, kind, license, attribution, source, ai_generated").eq("id", opts.musicAssetId).maybeSingle();
    if (!asset || asset.kind !== "audio") return { ok: false, error: "ไม่พบไฟล์เพลงนี้ในคลัง" };
    const verdict = licenseVerdict(asset);
    if (verdict.level === "block") return { ok: false, error: `เพลงนี้${verdict.message}` };
    music = asset.id;
  }

  // Spending: the render itself (free when local) plus the voice-over estimate.
  const plan = buildTimeline({ productName: "", imageSrc: null, hook: "", cta: "", disclosure: "", scenes: scenes ?? [] });
  const renderEstimate = estimateRenderCost(plan.durationInFrames / plan.fps);
  const [{ data: limits }, { data: spent }] = await Promise.all([
    supabase.from("spending_limits").select("daily_thb, monthly_thb").maybeSingle(),
    supabase.rpc("spend_summary"),
  ]);
  const spentNow = { today_thb: Number(spent?.[0]?.today_thb ?? 0), month_thb: Number(spent?.[0]?.month_thb ?? 0) };

  let tts: { model: string; voice: string | null; instructions: string } | null = null;
  if (opts.voice) {
    if (!isOpenRouterConfigured()) return { ok: false, error: "ยังไม่ได้ตั้งค่า OPENROUTER_API_KEY ใน .env.local — render แบบไม่มีเสียงพากย์ได้" };
    const [settings, catalog] = await Promise.all([getAiSettings(supabase, { storyboardId }), getCatalog()]);
    const model = modelFor("tts", settings.models);
    if ("error" in catalog) return { ok: false, error: catalog.error };
    const info = catalog.speech.find((m) => m.id === model);
    if (!info) return { ok: false, error: `ไม่พบโมเดลเสียง ${model} ใน catalog ของ OpenRouter ตอนนี้ — เลือกรุ่นใหม่ในหน้าตั้งค่า` };
    tts = { model, voice: voiceFor(model, settings.ttsVoice), instructions: TTS_INSTRUCTIONS };
    const lines = (scenes ?? []).map((s) => speechText(s.narration)).filter(Boolean);
    if (!lines.length) return { ok: false, error: "สคริปต์ไม่มีคำบรรยายให้พากย์" };
    const keys = lines.map((text) => speechCacheKey({ ...tts!, text }));
    const { data: cached } = await supabase.from("tts_cache").select("cache_key").in("cache_key", keys);
    const have = new Set((cached ?? []).map((c) => c.cache_key));
    const estThb = usdToThb(estimateVoiceoverUsd(info, lines.filter((_, i) => !have.has(keys[i]))));
    const { data: logged } = await supabase.from("ai_requests").select("cost_thb").eq("storyboard_id", storyboardId);
    const guard = checkAiSpend({
      limits,
      spent: spentNow,
      settings,
      videoSpent: (logged ?? []).reduce((n, r) => n + Number(r.cost_thb), 0),
      estimate: estThb + renderEstimate,
      confirmed: opts.confirmed,
    });
    if (!guard.ok) return guard.needsConfirm ? { ok: false, error: guard.message, needsConfirm: true } : { ok: false, error: guard.message };
  } else {
    const budget = checkBudget(limits, spentNow, renderEstimate);
    if (!budget.ok) return { ok: false, error: budget.message };
  }

  const { data, error } = await supabase
    .from("render_jobs")
    .insert({
      owner_id: user.id,
      storyboard_id: storyboardId,
      settings: { ...VIDEO, tts: tts ?? "none", music_asset_id: music, renderer_version: RENDERER_VERSION, ai_clip_scenes: clips.assetByScene.size },
    })
    .select("id")
    .single();
  if (error?.code === "23505") {
    const { data: active } = await supabase.from("render_jobs").select("id").eq("storyboard_id", storyboardId).in("status", ["queued", "processing"]).maybeSingle();
    if (active) return { ok: true, data: { jobId: active.id, existing: true } };
  }
  if (error) return { ok: false, error: `เข้าคิวไม่สำเร็จ: ${error.message}` };
  revalidatePath(`/videos/${storyboardId}`);
  revalidatePath("/videos");
  return { ok: true, data: { jobId: data.id, existing: false } };
}

export async function cancelRender(jobId: string, storyboardId: string): Promise<ActionResult<null>> {
  if (!uuid.safeParse(jobId).success) return { ok: false, error: "รหัสไม่ถูกต้อง" };
  const { supabase } = await getCurrentUser();
  if (!supabase) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };
  const { data, error } = await supabase.rpc("cancel_render_job", { job: jobId });
  if (error) return { ok: false, error: `ยกเลิกไม่สำเร็จ: ${error.message}` };
  if (!data) return { ok: false, error: "งานนี้จบไปแล้ว ยกเลิกไม่ได้" };
  revalidatePath(`/videos/${storyboardId}`);
  return { ok: true, data: null };
}
