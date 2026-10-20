/*
 * Render worker (PLAN.md §2): a separate Node process that claims render jobs from Postgres,
 * renders them with Remotion, checks the file with ffprobe and stores the outputs.
 *
 *   npm run worker        # runs until Ctrl+C
 *   npm run worker -- --drain  # handles every queued job, then exits (tests, cron)
 */
import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { makeCancelSignal, renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { createClient } from "@supabase/supabase-js";
import { licenseVerdict } from "@/features/assets/licensing";
import { checkBudget, estimateRenderCost } from "@/features/usage/budget";
import { runFfprobe } from "@/features/video/ffprobe";
import { fetchPublic } from "@/features/video/safe-fetch";
import { probeFacts, type QaCheck, qaReport } from "@/features/video/qa";
import { getStorage } from "@/features/video/storage";
import { buildTimeline, RENDERER_VERSION, type SceneMedia, toSrt, toVtt, VIDEO, type VideoProps } from "@/features/video/timeline";
import type { Database, Json, Tables } from "@/lib/supabase/database.types";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function loadEnvFile() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch {
    // no .env.local: rely on the environment
  }
}
loadEnvFile();

/**
 * Remotion keeps per-render scratch (bundles, downloaded assets) in the OS temp folder and
 * doesn't always remove it, which slowly fills the system drive (C: on Windows). Point temp at
 * a folder beside the outputs instead; leftovers older than a day are removed at start.
 */
function moveTempToProject() {
  const dir = path.resolve(process.env.RENDER_TMP_DIR || "storage/tmp");
  mkdirSync(dir, { recursive: true });
  process.env.TEMP = process.env.TMP = process.env.TMPDIR = dir;
  const dayAgo = Date.now() - 86_400_000;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    try {
      if (statSync(full).mtimeMs < dayAgo) rmSync(full, { recursive: true, force: true });
    } catch {
      // in use or already gone
    }
  }
}
moveTempToProject();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("ต้องตั้ง NEXT_PUBLIC_SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY ใน .env.local");
  process.exit(1);
}

const WORKER_ID = `${os.hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
const POLL_MS = 2000;
// worker_status() treats a worker as offline after 45 s without a beat.
const HEARTBEAT_MS = 15_000;
const DRAIN = process.argv.includes("--drain");
// Free License: individuals / companies with up to 3 employees (docs/LICENSING.md).
const LICENSE_KEY = process.env.REMOTION_LICENSE_KEY || "free-license";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const db = createClient<Database>(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const storage = getStorage();

const log = (job: string | null, msg: string) => console.log(`[${new Date().toISOString()}]${job ? ` [${job.slice(0, 8)}]` : ""} ${msg}`);

/** An error with a stable code and a message the user can act on. */
class RenderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

let serveUrl: Promise<string> | null = null;
/** Bundles the Remotion project once per worker process. */
function getServeUrl() {
  serveUrl ??= bundle({
    entryPoint: path.resolve("src/remotion/index.ts"),
    webpackOverride: (config) => ({
      ...config,
      resolve: { ...config.resolve, alias: { ...(config.resolve?.alias ?? {}), "@": path.resolve("src") } },
    }),
  }).catch((e) => {
    serveUrl = null;
    throw new RenderError("bundle_failed", `เตรียมเทมเพลตวิดีโอไม่สำเร็จ: ${(e as Error).message}`, true);
  });
  return serveUrl;
}

/**
 * Serves library assets to the headless browser over loopback (Remotion can't read local files
 * directly). Only keys registered for the current job are reachable, via random tokens.
 */
const served = new Map<string, { key: string; mime: string }>();
let assetServer: Promise<string> | null = null;
function getAssetServer() {
  assetServer ??= new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const entry = served.get((req.url ?? "").slice(1));
      const size = entry ? await storage.size(entry.key) : null;
      if (!entry || size === null) return void res.writeHead(404).end();
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
      if (m && (m[1] || m[2])) {
        const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
        const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
        res.writeHead(206, { "Content-Type": entry.mime, "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
        storage.read(entry.key, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { "Content-Type": entry.mime, "Accept-Ranges": "bytes", "Content-Length": size });
        storage.read(entry.key).pipe(res);
      }
    });
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
    server.unref();
  });
  return assetServer;
}

/**
 * A port nothing else listens on, for Remotion's bundle server. Remotion's own check binds
 * 127.0.0.1 only, which Windows allows even while another app (e.g. a dev server on
 * 0.0.0.0:3000) holds the port — the browser then loads that app instead of the bundle.
 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

async function update(jobId: string, patch: Database["public"]["Tables"]["render_jobs"]["Update"]) {
  const { error } = await db.from("render_jobs").update(patch).eq("id", jobId);
  if (error) log(jobId, `อัปเดตสถานะไม่สำเร็จ: ${error.message}`);
}

async function isCanceled(jobId: string) {
  const { data } = await db.from("render_jobs").select("status").eq("id", jobId).single();
  return data?.status === "canceled";
}

/**
 * Downloads the product image into a data: URI so rendering never depends on the network.
 * The URL is user-supplied: `fetchPublic` refuses local/private addresses on every hop (SSRF).
 */
async function loadImage(url: string | null): Promise<{ src: string | null; check: QaCheck }> {
  const fail = (detail: string) => ({ src: null, check: { key: "image", label: "รูปสินค้า", ok: false, detail, level: "warn" as const } });
  if (!url) return fail("สินค้าไม่มีลิงก์รูป — ใช้การ์ดชื่อสินค้าแทน");
  try {
    const res = await fetchPublic(url, { timeoutMs: 15_000, maxBytes: MAX_IMAGE_BYTES });
    if (res.status < 200 || res.status >= 300) return fail(`โหลดรูปไม่สำเร็จ (HTTP ${res.status}) — ใช้การ์ดชื่อสินค้าแทน`);
    if (!/^image\/(png|jpe?g|webp|gif|avif)$/.test(res.contentType)) return fail(`ลิงก์ไม่ใช่ไฟล์รูป (${res.contentType || "ไม่ทราบชนิด"}) — ใช้การ์ดชื่อสินค้าแทน`);
    return { src: `data:${res.contentType};base64,${res.body.toString("base64")}`, check: { key: "image", label: "รูปสินค้า", ok: true, detail: "ใช้รูปจากลิงก์สินค้า", level: "warn" } };
  } catch (e) {
    return fail(`โหลดรูปไม่สำเร็จ: ${(e as Error).message} — ใช้การ์ดชื่อสินค้าแทน`);
  }
}

async function loadPlan(job: Tables<"render_jobs">) {
  const { data: sb } = await db.from("storyboards").select("*").eq("id", job.storyboard_id).maybeSingle();
  if (!sb) throw new RenderError("storyboard_missing", "ไม่พบสคริปต์ของงานนี้ (อาจถูกลบไปแล้ว)");
  if (sb.status !== "approved") throw new RenderError("not_approved", "สคริปต์ยังไม่ได้อนุมัติ — อนุมัติใน Script Studio ก่อน render");
  const { data: project } = await db.from("content_projects").select("product_id").eq("id", sb.project_id).single();
  const { data: product } = await db.from("products").select("name, image_url").eq("id", project!.product_id).single();
  const { data: scenes } = await db
    .from("storyboard_scenes")
    .select("id, kind, narration, on_screen_text, position, asset:assets(id, name, kind, mime, storage_key, license, attribution, source, ai_generated, duration_s)")
    .eq("storyboard_id", sb.id)
    .order("position");
  if (!scenes?.length) throw new RenderError("no_scenes", "สคริปต์ไม่มีฉาก");
  for (const s of scenes) {
    if (s.asset && licenseVerdict(s.asset).level === "block") {
      throw new RenderError("asset_license", `ฉากที่ ${s.position + 1}: ไฟล์ “${s.asset.name}” ${licenseVerdict(s.asset).message}`);
    }
  }
  return { sb, product: product!, scenes };
}

async function ffprobe(file: string): Promise<unknown> {
  try {
    return await runFfprobe(file);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "FFPROBE_FAILED") throw new RenderError("ffprobe_failed", `ffprobe ล้มเหลว: ${(e as Error).message}`);
    throw new RenderError("ffprobe_missing", `เรียก ffprobe ไม่ได้ (${code ?? (e as Error).message}) — ติดตั้ง FFmpeg หรือตั้ง FFPROBE_PATH`);
  }
}

// ---------------------------------------------------------------------------
// Job
// ---------------------------------------------------------------------------

async function processJob(job: Tables<"render_jobs">) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "render-"));
  const cleanups: (() => void)[] = [];
  const { cancelSignal, cancel } = makeCancelSignal();
  let canceled = false;
  const watcher = setInterval(async () => {
    if (await isCanceled(job.id)) {
      canceled = true;
      cancel();
    }
  }, POLL_MS);

  try {
    log(job.id, `เริ่มงาน (ครั้งที่ ${job.attempt}/${job.max_attempts})`);
    await update(job.id, { stage: "loading", progress: 0.02 });
    const { sb, product, scenes } = await loadPlan(job);
    const image = await loadImage(product.image_url);
    const base = scenes.some((s) => s.asset) ? await getAssetServer() : "";
    const tokens: string[] = [];
    const withMedia = scenes.map((s) => {
      let media: SceneMedia | null = null;
      if (s.asset) {
        const token = randomUUID();
        served.set(token, { key: s.asset.storage_key, mime: s.asset.mime });
        tokens.push(token);
        media = { kind: s.asset.kind as SceneMedia["kind"], src: `${base}/${token}`, durationS: s.asset.duration_s };
      }
      return { ...s, media };
    });
    cleanups.push(() => tokens.forEach((t) => served.delete(t)));
    const props: VideoProps = buildTimeline({
      productName: product.name,
      imageSrc: image.src,
      hook: sb.hook,
      cta: sb.cta,
      disclosure: sb.disclosure,
      scenes: withMedia,
    });

    // Spending cap, checked again here: limits or spend may have changed since queuing.
    const estimate = estimateRenderCost(props.durationInFrames / props.fps);
    const [{ data: limits }, { data: spent }] = await Promise.all([
      db.from("spending_limits").select("daily_thb, monthly_thb").eq("owner_id", job.owner_id).maybeSingle(),
      db.rpc("spend_summary", { owner: job.owner_id }),
    ]);
    const budget = checkBudget(limits, { today_thb: Number(spent?.[0]?.today_thb ?? 0), month_thb: Number(spent?.[0]?.month_thb ?? 0) }, estimate);
    if (!budget.ok) throw new RenderError("budget_exceeded", budget.message);

    await update(job.id, { stage: "bundling", progress: 0.05 });
    const url = await getServeUrl();
    const composition = await selectComposition({ serveUrl: url, id: "AffiliateVideo", inputProps: props, port: await freePort() });

    await update(job.id, { stage: "rendering", progress: 0.1 });
    const videoPath = path.join(tmp, "video.mp4");
    let lastReport = 0;
    await renderMedia({
      composition,
      serveUrl: url,
      port: await freePort(),
      codec: "h264",
      audioCodec: "aac",
      // No voice-over yet: a silent AAC track keeps the file valid for every platform.
      enforceAudioTrack: true,
      outputLocation: videoPath,
      inputProps: props,
      cancelSignal,
      licenseKey: LICENSE_KEY,
      onProgress: ({ progress }) => {
        const now = Date.now();
        if (now - lastReport > 1000) {
          lastReport = now;
          void update(job.id, { progress: 0.1 + progress * 0.75 });
        }
      },
    });
    if (canceled) return;

    await update(job.id, { stage: "thumbnail", progress: 0.88 });
    const thumbPath = path.join(tmp, "thumbnail.jpg");
    await renderStill({ composition, serveUrl: url, port: await freePort(), output: thumbPath, inputProps: props, frame: Math.min(20, props.durationInFrames - 1), imageFormat: "jpeg", licenseKey: LICENSE_KEY });
    await writeFile(path.join(tmp, "subtitles.srt"), toSrt(props), "utf8");
    await writeFile(path.join(tmp, "subtitles.vtt"), toVtt(props), "utf8");

    await update(job.id, { stage: "checking", progress: 0.93 });
    const probe = await ffprobe(videoPath);
    const facts = probeFacts(probe);
    const report = qaReport(facts, { width: VIDEO.width, height: VIDEO.height, fps: VIDEO.fps, durationS: props.durationInFrames / props.fps }, [
      image.check,
      { key: "disclosure", label: "เปิดเผยลิงก์ affiliate", ok: props.disclosure.includes("ค่าคอมมิชชัน"), detail: "แสดงในฉากปิดท้ายและซับไตเติล", level: "error" },
      { key: "voice", label: "เสียงพากย์", ok: false, detail: "ยังไม่ได้เชื่อมต่อ TTS — วิดีโอไม่มีเสียงพากย์ จังหวะมาจากการประมาณ", level: "warn" },
    ]);
    if (!report.ok) {
      const failed = report.checks.filter((c) => !c.ok && c.level === "error").map((c) => `${c.label}: ${c.detail}`);
      throw new RenderError("qa_failed", `ไฟล์ไม่ผ่านการตรวจคุณภาพ — ${failed.join("; ")}`, true);
    }

    await update(job.id, { stage: "saving", progress: 0.96 });
    const prefix = `${job.owner_id}/${job.id}`;
    for (const f of ["video.mp4", "thumbnail.jpg", "subtitles.srt", "subtitles.vtt"]) await storage.put(`${prefix}/${f}`, path.join(tmp, f));
    if (await isCanceled(job.id)) {
      await storage.removePrefix(prefix);
      return;
    }
    const { error } = await db.from("render_outputs").insert({
      job_id: job.id,
      owner_id: job.owner_id,
      video_key: `${prefix}/video.mp4`,
      thumbnail_key: `${prefix}/thumbnail.jpg`,
      srt_key: `${prefix}/subtitles.srt`,
      vtt_key: `${prefix}/subtitles.vtt`,
      duration_s: facts.durationS,
      size_bytes: facts.sizeBytes ?? (await stat(videoPath)).size,
      probe: probe as Json,
      report: report as unknown as NonNullable<Json>,
    });
    if (error) throw new RenderError("save_failed", `บันทึกผลลัพธ์ไม่สำเร็จ: ${error.message}`, true);
    const seconds = facts.durationS ?? props.durationInFrames / props.fps;
    const { error: usageError } = await db.from("usage_events").insert({
      owner_id: job.owner_id,
      provider: "render",
      units: Math.round(seconds * 1000) / 1000,
      unit: "video_seconds",
      est_cost_thb: estimateRenderCost(seconds),
      render_job_id: job.id,
    });
    if (usageError) log(job.id, `บันทึกการใช้งานไม่สำเร็จ: ${usageError.message}`);
    await update(job.id, {
      status: "completed",
      stage: null,
      progress: 1,
      finished_at: new Date().toISOString(),
      settings: { ...((job.settings as Record<string, Json>) ?? {}), renderer_version: RENDERER_VERSION, duration_frames: props.durationInFrames },
    });
    log(job.id, `เสร็จ (${facts.durationS?.toFixed(1)} วินาที)`);
  } catch (e) {
    if (canceled) {
      log(job.id, "ถูกยกเลิก");
      return;
    }
    const err = e instanceof RenderError ? e : new RenderError("render_failed", `render ไม่สำเร็จ: ${(e as Error).message}`, true);
    const retry = err.retryable && job.attempt < job.max_attempts;
    log(job.id, `${retry ? "ล้มเหลว จะลองใหม่" : "ล้มเหลว"}: ${err.code} ${err.message}`);
    await update(job.id, {
      status: retry ? "queued" : "failed",
      stage: null,
      error_code: err.code,
      error_message: err.message.slice(0, 2000),
      finished_at: retry ? null : new Date().toISOString(),
      locked_by: null,
      locked_at: null,
    });
  } finally {
    clearInterval(watcher);
    cleanups.forEach((f) => f());
    await rm(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Heartbeat (monitoring: Settings → สถานะระบบ, /api/health)
// ---------------------------------------------------------------------------

let busy = false;
async function beat() {
  const { error } = await db.from("worker_heartbeats").upsert({ worker_id: WORKER_ID, last_seen: new Date().toISOString(), busy });
  if (error) log(null, `ส่ง heartbeat ไม่สำเร็จ: ${error.message}`);
}

async function startHeartbeat() {
  // Rows left by workers that crashed instead of stopping cleanly.
  await db.from("worker_heartbeats").delete().lt("last_seen", new Date(Date.now() - 86_400_000).toISOString());
  await beat();
  setInterval(() => void beat(), HEARTBEAT_MS).unref();
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

let stopping = false;
process.on("SIGINT", () => {
  if (stopping) process.exit(1);
  stopping = true;
  log(null, "กำลังหยุดหลังงานปัจจุบัน… (กด Ctrl+C อีกครั้งเพื่อหยุดทันที)");
});

async function main() {
  log(null, `render worker ${WORKER_ID} เริ่มทำงาน`);
  await startHeartbeat();
  while (!stopping) {
    await db.rpc("fail_exhausted_render_jobs");
    const { data, error } = await db.rpc("claim_render_job", { worker: WORKER_ID });
    if (error) log(null, `ดึงงานไม่สำเร็จ: ${error.message}`);
    const job = data?.[0];
    if (job) {
      busy = true;
      void beat();
      await processJob(job);
      busy = false;
    }
    else if (DRAIN) break;
    else await new Promise((r) => setTimeout(r, POLL_MS));
  }
  await db.from("worker_heartbeats").delete().eq("worker_id", WORKER_ID);
  log(null, "หยุดแล้ว");
}

void main();
