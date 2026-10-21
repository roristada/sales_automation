import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalDiskStorage } from "@/features/video/storage";
import type { Database } from "@/lib/supabase/database.types";
import { tickAiClips } from "../../worker/ai-clips";

/*
 * AI-3 against LOCAL Supabase: who may queue, review and cancel AI clips (RLS + column grants),
 * and the worker pipeline end to end — submit → poll → download → ffprobe → asset → cost log —
 * against a FAKE OpenRouter server started here (OPENROUTER_BASE_URL). The fake only stands in
 * for the network; it proves our side of the contract, not the quality of any real model.
 */

function loadEnv(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(".env.local", "utf8")
        .split(/\r?\n/)
        .filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
    );
  } catch {
    return {};
  }
}
const env = { ...loadEnv(), ...process.env };
const URL = env.NEXT_PUBLIC_SUPABASE_URL!;
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(URL)) throw new Error("these tests create and delete users; they only run against local Supabase");
const admin = createClient<Database>(URL, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const run = Date.now();

async function makeUser(tag: string) {
  const email = `clips-${tag}-${run}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "test-password-123", email_confirm: true });
  if (error) throw error;
  const client = createClient<Database>(URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  await client.auth.signInWithPassword({ email, password: "test-password-123" });
  return { id: data.user.id, client };
}

// Fake OpenRouter video API.
const calls: { method: string; url: string; body: unknown }[] = [];
let polls = 0;
let failSubmit = false;
let clip: Buffer;
const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    calls.push({ method: req.method!, url: req.url!, body: raw ? JSON.parse(raw) : null });
    if (req.headers.authorization !== "Bearer sk-or-test") return void res.writeHead(401).end();
    const send = (status: number, body: unknown) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
    if (req.method === "POST" && req.url === "/videos") return failSubmit ? send(500, { error: { message: "boom" } }) : send(202, { id: "job-1", polling_url: "x", status: "pending" });
    if (req.url === "/videos/job-1") return ++polls < 2 ? send(200, { id: "job-1", status: "in_progress" }) : send(200, { id: "job-1", generation_id: "gen-9", status: "completed", unsigned_urls: [], usage: { cost: 0.42 } });
    if (req.url === "/videos/job-1/content?index=0") return void res.writeHead(200, { "Content-Type": "video/mp4" }).end(clip);
    send(404, { error: { message: "not found" } });
  });
});

let a: Awaited<ReturnType<typeof makeUser>>;
let b: Awaited<ReturnType<typeof makeUser>>;
let storyboardId: string;
let sceneId: string;
let storageDir: string;
const storage = () => new LocalDiskStorage(storageDir);
const quiet = () => {};

beforeAll(async () => {
  storageDir = mkdtempSync(path.join(os.tmpdir(), "clips-test-"));
  const mp4 = path.join(storageDir, "fake.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=red:s=360x640:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", mp4]);
  clip = readFileSync(mp4);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  process.env.USD_THB_RATE = "35";

  a = await makeUser("a");
  b = await makeUser("b");
  const { data: product } = await a.client.from("products").insert({ name: "ลำโพง", source: "manual", image_url: "https://example.test/p.jpg" }).select("id").single();
  const { data: project } = await a.client.from("content_projects").insert({ product_id: product!.id, title: "t", platform: "tiktok", target_duration_s: 30 }).select("id").single();
  const { data: sb } = await a.client.from("storyboards").insert({ project_id: project!.id, version: 1, template_id: "quick_review", template_version: 1, disclosure: "#ได้รับค่าคอมมิชชัน" }).select("id").single();
  storyboardId = sb!.id;
  const { data: scene } = await a.client.from("storyboard_scenes").insert({ storyboard_id: storyboardId, position: 0, kind: "intro", narration: "x" }).select("id").single();
  sceneId = scene!.id;
});

afterAll(async () => {
  server.close();
  delete process.env.OPENROUTER_BASE_URL;
  for (const u of [a, b]) if (u) await admin.auth.admin.deleteUser(u.id);
  rmSync(storageDir, { recursive: true, force: true });
});

const queued = (over: Partial<Database["public"]["Tables"]["scene_generations"]["Insert"]> = {}) => ({
  scene_id: sceneId,
  storyboard_id: storyboardId,
  video_task: "video_product",
  model: "kwaivgi/kling-v3.0-std",
  prompt: "slow rotation, studio light",
  duration_s: 5,
  first_frame_url: "https://example.test/p.jpg",
  est_cost_thb: 14.7,
  ...over,
});

describe("AI clips", () => {
  it("visual plans: owner-only, and only for the owner's own scenes", async () => {
    expect((await a.client.from("scene_visual_plans").upsert({ scene_id: sceneId, storyboard_id: storyboardId, mode: "ai_video", prompt: "p" }, { onConflict: "scene_id" })).error).toBeNull();
    // Upsert again (update path) works too.
    expect((await a.client.from("scene_visual_plans").upsert({ scene_id: sceneId, storyboard_id: storyboardId, mode: "ai_video", prompt: "p2" }, { onConflict: "scene_id" })).error).toBeNull();
    expect((await b.client.from("scene_visual_plans").select("scene_id")).data).toEqual([]);
    expect((await b.client.from("scene_visual_plans").insert({ scene_id: sceneId, storyboard_id: storyboardId })).error?.code).toBe("42501");
  });

  it("clips can be queued only for an approved storyboard, by its owner, and only as queued", async () => {
    expect((await a.client.from("scene_generations").insert(queued())).error?.code).toBe("42501");
    expect((await admin.from("storyboards").update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", storyboardId)).error).toBeNull();
    expect((await b.client.from("scene_generations").insert(queued())).error?.code).toBe("42501");
    // Worker-only columns can't be set by the owner.
    expect((await a.client.from("scene_generations").insert({ ...queued(), status: "succeeded" } as never)).error?.code).toBe("42501");
    expect((await a.client.from("scene_generations").insert({ ...queued(), cost_thb: 0 } as never)).error?.code).toBe("42501");
  });

  it("worker: submit once with the product photo as first frame, poll, store the clip as an AI asset, log the real cost", async () => {
    const { data: g, error } = await a.client.from("scene_generations").insert(queued()).select("id").single();
    expect(error).toBeNull();
    // One in flight per scene.
    expect((await a.client.from("scene_generations").insert(queued())).error?.code).toBe("23505");
    // The owner can't mark it done or approve it before it exists.
    expect((await a.client.from("scene_generations").update({ status: "succeeded" } as never).eq("id", g!.id)).error?.code).toBe("42501");
    expect((await a.client.from("scene_generations").update({ review_status: "approved" }).eq("id", g!.id)).error?.code).toBe("23514");

    await tickAiClips(admin, storage(), "test-worker", quiet);
    const submit = calls.find((c) => c.method === "POST");
    expect(submit?.body).toEqual({
      model: "kwaivgi/kling-v3.0-std",
      prompt: "slow rotation, studio light",
      duration: 5,
      aspect_ratio: "9:16",
      resolution: "720p",
      generate_audio: false,
      frame_images: [{ type: "image_url", image_url: { url: "https://example.test/p.jpg" }, frame_type: "first_frame" }],
    });
    let row = (await admin.from("scene_generations").select("*").eq("id", g!.id).single()).data!;
    expect(row).toMatchObject({ status: "generating", openrouter_job_id: "job-1", locked_by: null });

    // Not polled again before poll_every; then in progress; then completed.
    await tickAiClips(admin, storage(), "test-worker", quiet);
    expect(polls).toBe(0);
    for (let i = 0; i < 2; i++) {
      await admin.from("scene_generations").update({ polled_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", g!.id);
      await tickAiClips(admin, storage(), "test-worker", quiet);
    }
    row = (await admin.from("scene_generations").select("*").eq("id", g!.id).single()).data!;
    expect(row).toMatchObject({ status: "succeeded", cost_usd: 0.42, cost_thb: 14.7, error: null });
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);

    const { data: asset } = await a.client.from("assets").select("*").eq("id", row.asset_id!).single();
    expect(asset).toMatchObject({ kind: "video", source: "ai_generated", ai_generated: true, license: "unknown", width: 360, height: 640, mime: "video/mp4" });
    expect(await storage().size(asset!.storage_key)).toBe(clip.length);
    const { data: logs } = await a.client.from("ai_requests").select("task, model, status, cost_thb, generation_id, storyboard_id").eq("storyboard_id", storyboardId);
    expect(logs).toEqual([{ task: "video_product", model: "kwaivgi/kling-v3.0-std", status: "succeeded", cost_thb: 14.7, generation_id: "gen-9", storyboard_id: storyboardId }]);

    // Review: the owner approves; B can't.
    expect((await b.client.from("scene_generations").update({ review_status: "rejected" }).eq("id", g!.id).select()).data).toEqual([]);
    expect((await a.client.from("scene_generations").update({ review_status: "approved", review_note: "ตรงกับของจริง" }).eq("id", g!.id)).error).toBeNull();
  });

  it("a failed submit is failed and logged, never resubmitted; cancel stops a queued job", async () => {
    failSubmit = true;
    const before = calls.filter((c) => c.method === "POST").length;
    const { data: g } = await a.client.from("scene_generations").insert(queued({ prompt: "second try" })).select("id").single();
    await tickAiClips(admin, storage(), "test-worker", quiet);
    await tickAiClips(admin, storage(), "test-worker", quiet);
    expect(calls.filter((c) => c.method === "POST").length).toBe(before + 1);
    const { data: row } = await admin.from("scene_generations").select("status, error").eq("id", g!.id).single();
    expect(row!.status).toBe("failed");
    expect(row!.error).toMatch(/ขัดข้อง/);
    expect((await a.client.from("ai_requests").select("status").eq("storyboard_id", storyboardId).eq("status", "failed")).data).toHaveLength(1);

    const { data: c } = await a.client.from("scene_generations").insert(queued({ prompt: "third" })).select("id").single();
    expect((await b.client.rpc("cancel_scene_generation", { generation: c!.id })).data).toBe(false);
    expect((await a.client.rpc("cancel_scene_generation", { generation: c!.id })).data).toBe(true);
    expect((await admin.from("scene_generations").select("status").eq("id", c!.id).single()).data!.status).toBe("canceled");
    failSubmit = false;
  });

  it("anonymous clients see nothing; only the worker can claim jobs", async () => {
    const anon = createClient<Database>(URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    for (const t of ["scene_visual_plans", "scene_generations"] as const) expect((await anon.from(t).select("*")).data ?? []).toEqual([]);
    expect((await a.client.rpc("claim_scene_generation", { worker: "x" })).error?.code).toBe("42501");
  });
});

