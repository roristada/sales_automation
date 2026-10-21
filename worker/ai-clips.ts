/*
 * AI clip jobs (docs/AI_VIDEO_PLAN.md AI-3), run from the render worker's loop. A queued
 * scene_generations row is submitted to OpenRouter once (never resubmitted automatically: that would
 * bill twice), then polled; the finished MP4 is downloaded, checked with ffprobe and stored as an
 * asset marked AI-generated, and the cost OpenRouter reports is logged in ai_requests.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { usdToThb } from "@/features/ai/models";
import { downloadVideo, getVideoJob, isOpenRouterConfigured, OpenRouterError, submitVideo } from "@/features/ai/openrouter";
import { runFfprobe } from "@/features/video/ffprobe";
import { probeFacts } from "@/features/video/qa";
import type { StorageAdapter } from "@/features/video/storage";
import type { Database, Tables } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;
type Generation = Tables<"scene_generations">;
type Log = (job: string | null, msg: string) => void;

/** A job that hasn't finished after this long is failed (OpenRouter may still bill it). */
const GIVE_UP_MS = 30 * 60_000;
const MAX_PER_TICK = 4;

const message = (e: unknown) => (e instanceof OpenRouterError ? e.message : e instanceof Error ? e.message : String(e)).slice(0, 1000);

async function logRequest(db: Db, g: Generation, status: "succeeded" | "failed", costUsd: number | null, extra: { generationId?: string | null; error?: string; seconds?: number | null }) {
  const { data: sb } = await db.from("storyboards").select("project:content_projects(product_id)").eq("id", g.storyboard_id).maybeSingle();
  await db.from("ai_requests").insert({
    owner_id: g.owner_id,
    task: g.video_task,
    model: g.model,
    status,
    generation_id: extra.generationId ?? g.openrouter_job_id,
    video_seconds: extra.seconds ?? null,
    cost_usd: costUsd ?? 0,
    cost_thb: usdToThb(costUsd ?? 0),
    error: extra.error ?? null,
    product_id: sb?.project?.product_id ?? null,
    storyboard_id: g.storyboard_id,
  });
}

async function finish(db: Db, id: string, patch: Database["public"]["Tables"]["scene_generations"]["Update"]) {
  await db
    .from("scene_generations")
    .update({ ...patch, locked_by: null, locked_at: null })
    .eq("id", id)
    .in("status", ["queued", "generating"]);
}

async function submit(db: Db, g: Generation, log: Log) {
  try {
    const job = await submitVideo({ model: g.model, prompt: g.prompt, duration: g.duration_s, aspectRatio: "9:16", resolution: g.resolution, firstFrameUrl: g.first_frame_url });
    await db
      .from("scene_generations")
      .update({ status: "generating", openrouter_job_id: job.id, submitted_at: new Date().toISOString(), polled_at: new Date().toISOString(), locked_by: null, locked_at: null })
      .eq("id", g.id)
      .eq("status", "queued");
    log(g.id, `ส่งงานคลิป AI แล้ว (${g.model}, ${g.duration_s} วิ) → ${job.id}`);
  } catch (e) {
    const error = message(e);
    await finish(db, g.id, { status: "failed", error, finished_at: new Date().toISOString(), cost_usd: 0, cost_thb: 0 });
    await logRequest(db, g, "failed", null, { error });
    log(g.id, `ส่งงานคลิป AI ไม่สำเร็จ: ${error}`);
  }
}

async function storeClip(db: Db, storage: StorageAdapter, g: Generation, bytes: Buffer): Promise<{ assetId: string; durationS: number | null }> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const { data: dup } = await db.from("assets").select("id, duration_s").eq("owner_id", g.owner_id).eq("sha256", sha256).maybeSingle();
  if (dup) return { assetId: dup.id, durationS: dup.duration_s };

  const tmp = await mkdtemp(path.join(os.tmpdir(), "ai-clip-"));
  try {
    const file = path.join(tmp, "clip.mp4");
    await writeFile(file, bytes);
    const facts = probeFacts(await runFfprobe(file));
    if (!facts.videoCodec) throw new Error("ไฟล์ที่ได้ไม่ใช่วิดีโอที่อ่านได้");
    const { data: sb } = await db.from("storyboards").select("project:content_projects(product_id)").eq("id", g.storyboard_id).maybeSingle();
    const { data: scene } = await db.from("storyboard_scenes").select("position").eq("id", g.scene_id).maybeSingle();
    const assetId = randomUUID();
    const key = `${g.owner_id}/${assetId}/original.mp4`;
    await storage.put(key, file);
    const { error } = await db.from("assets").insert({
      id: assetId,
      owner_id: g.owner_id,
      product_id: sb?.project?.product_id ?? null,
      kind: "video",
      storage_key: key,
      name: `คลิป AI ฉากที่ ${(scene?.position ?? 0) + 1} · ${g.model}`.slice(0, 200),
      mime: "video/mp4",
      size_bytes: bytes.length,
      sha256,
      width: facts.width,
      height: facts.height,
      duration_s: facts.durationS,
      source: "ai_generated",
      // Usage rights of generated output depend on the model provider's terms: flagged for review.
      license: "unknown",
      attribution: `สร้างด้วย ${g.model} ผ่าน OpenRouter`.slice(0, 300),
      ai_generated: true,
      notes: `prompt: ${g.prompt}`.slice(0, 1000),
    });
    if (error) {
      await storage.removePrefix(`${g.owner_id}/${assetId}`);
      throw new Error(`บันทึกไฟล์ไม่สำเร็จ: ${error.message}`);
    }
    return { assetId, durationS: facts.durationS };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function poll(db: Db, storage: StorageAdapter, g: Generation, log: Log) {
  let job;
  try {
    job = await getVideoJob(g.openrouter_job_id!);
  } catch (e) {
    // Temporary: try again on the next poll.
    await db.from("scene_generations").update({ polled_at: new Date().toISOString(), locked_by: null, locked_at: null }).eq("id", g.id);
    log(g.id, `ถามสถานะไม่สำเร็จ: ${message(e)}`);
    return;
  }
  const now = new Date().toISOString();
  if (job.status === "pending" || job.status === "in_progress") {
    if (g.submitted_at && Date.now() - new Date(g.submitted_at).getTime() > GIVE_UP_MS) {
      const error = "OpenRouter ใช้เวลานานเกิน 30 นาที — หยุดรอแล้ว (ตรวจค่าใช้จ่ายที่ openrouter.ai/activity)";
      await finish(db, g.id, { status: "failed", error, finished_at: now });
      await logRequest(db, g, "failed", job.costUsd, { error });
      return;
    }
    await db.from("scene_generations").update({ polled_at: now, locked_by: null, locked_at: null }).eq("id", g.id);
    return;
  }
  if (job.status === "failed") {
    const error = `สร้างคลิปไม่สำเร็จ: ${job.error ?? "ผู้ให้บริการไม่ได้บอกสาเหตุ"}`.slice(0, 1000);
    await finish(db, g.id, { status: "failed", error, finished_at: now, cost_usd: job.costUsd ?? 0, cost_thb: usdToThb(job.costUsd ?? 0) });
    await logRequest(db, g, "failed", job.costUsd, { error, generationId: job.generationId });
    log(g.id, error);
    return;
  }
  // completed
  try {
    const bytes = await downloadVideo(job.id);
    const { assetId, durationS } = await storeClip(db, storage, g, bytes);
    await finish(db, g.id, { status: "succeeded", asset_id: assetId, finished_at: now, cost_usd: job.costUsd ?? 0, cost_thb: usdToThb(job.costUsd ?? 0), error: null });
    await logRequest(db, g, "succeeded", job.costUsd, { generationId: job.generationId, seconds: durationS ?? g.duration_s });
    log(g.id, `คลิป AI เสร็จ ฿${usdToThb(job.costUsd ?? 0).toFixed(2)} → asset ${assetId}`);
  } catch (e) {
    if (g.submitted_at && Date.now() - new Date(g.submitted_at).getTime() > GIVE_UP_MS) {
      await finish(db, g.id, { status: "failed", error: `ดาวน์โหลด/บันทึกคลิปไม่สำเร็จ: ${message(e)}`, finished_at: now, cost_usd: job.costUsd ?? 0, cost_thb: usdToThb(job.costUsd ?? 0) });
      await logRequest(db, g, "failed", job.costUsd, { generationId: job.generationId, error: message(e) });
      return;
    }
    // The clip exists on OpenRouter; keep polling so a temporary download/storage error retries.
    await db.from("scene_generations").update({ polled_at: now, locked_by: null, locked_at: null, error: message(e) }).eq("id", g.id);
    log(g.id, `ดาวน์โหลด/บันทึกคลิปไม่สำเร็จ จะลองใหม่: ${message(e)}`);
  }
}

/** Handles the AI clip jobs that are due: submits queued ones, polls generating ones. */
export async function tickAiClips(db: Db, storage: StorageAdapter, workerId: string, log: Log) {
  if (!isOpenRouterConfigured()) return;
  for (let i = 0; i < MAX_PER_TICK; i++) {
    const { data, error } = await db.rpc("claim_scene_generation", { worker: workerId });
    if (error) return log(null, `ดึงงานคลิป AI ไม่สำเร็จ: ${error.message}`);
    const g = data?.[0];
    if (!g) return;
    if (g.status === "queued") await submit(db, g, log);
    else await poll(db, storage, g, log);
  }
}
