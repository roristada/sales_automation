"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/features/products/actions";
import { getCurrentUser } from "@/lib/supabase/server";
import { checkBudget, estimateRenderCost } from "@/features/usage/budget";
import { missingClipsMessage, resolveAiClips } from "@/features/ai/clips";
import { buildTimeline, RENDERER_VERSION, VIDEO } from "./timeline";

const uuid = z.uuid();

/**
 * Queues a render of an approved storyboard. Idempotent: if a job for it is already queued or
 * running, that job is returned instead of a second one (DB partial unique index).
 */
export async function queueRender(storyboardId: string): Promise<ActionResult<{ jobId: string; existing: boolean }>> {
  if (!uuid.safeParse(storyboardId).success) return { ok: false, error: "รหัสไม่ถูกต้อง" };
  const { supabase, user } = await getCurrentUser();
  if (!supabase || !user) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };

  const { data: sb } = await supabase.from("storyboards").select("id, status").eq("id", storyboardId).maybeSingle();
  if (!sb) return { ok: false, error: "ไม่พบสคริปต์" };
  if (sb.status !== "approved") return { ok: false, error: "ต้องอนุมัติสคริปต์ใน Script Studio ก่อน render" };

  // Spending cap (free local renders are never blocked).
  const [{ data: scenes }, { data: plans }, { data: approvedClips }] = await Promise.all([
    supabase.from("storyboard_scenes").select("id, kind, narration, on_screen_text").eq("storyboard_id", storyboardId).order("position"),
    supabase.from("scene_visual_plans").select("scene_id, mode").eq("storyboard_id", storyboardId),
    supabase.from("scene_generations").select("scene_id, asset_id").eq("storyboard_id", storyboardId).eq("review_status", "approved"),
  ]);
  // Every scene planned as an AI clip needs an approved clip (AI-4).
  const clips = resolveAiClips(scenes ?? [], plans ?? [], approvedClips ?? []);
  if (clips.missing.length) return { ok: false, error: missingClipsMessage(clips.missing) };
  const plan = buildTimeline({ productName: "", imageSrc: null, hook: "", cta: "", disclosure: "", scenes: scenes ?? [] });
  const estimate = estimateRenderCost(plan.durationInFrames / plan.fps);
  const [{ data: limits }, { data: spent }] = await Promise.all([
    supabase.from("spending_limits").select("daily_thb, monthly_thb").maybeSingle(),
    supabase.rpc("spend_summary"),
  ]);
  const budget = checkBudget(limits, { today_thb: Number(spent?.[0]?.today_thb ?? 0), month_thb: Number(spent?.[0]?.month_thb ?? 0) }, estimate);
  if (!budget.ok) return { ok: false, error: budget.message };

  const { data, error } = await supabase
    .from("render_jobs")
    .insert({ owner_id: user.id, storyboard_id: storyboardId, settings: { ...VIDEO, tts: "none", renderer_version: RENDERER_VERSION, ai_clip_scenes: clips.assetByScene.size } })
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
