import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runFfprobe } from "@/features/video/ffprobe";
import { probeFacts } from "@/features/video/qa";
import { LocalDiskStorage } from "@/features/video/storage";
import type { Database } from "@/lib/supabase/database.types";
import { prepareVoiceover } from "../../worker/voiceover";

/*
 * AI-5 against LOCAL Supabase: the speech cache is worker-written and owner-readable only;
 * prepareVoiceover speaks each line once, measures it, caches it and logs the call; and a full
 * worker render with voice + music produces an MP4 whose scenes follow the spoken lengths.
 * OpenRouter is a FAKE server started here (OPENROUTER_BASE_URL) returning ffmpeg-made MP3s —
 * it proves our side of the contract, not how any real voice sounds.
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
const admin = createClient<Database>(URL, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const run = Date.now();

async function makeUser(tag: string) {
  const email = `voice-${tag}-${run}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: "test-password-123",
    email_confirm: true,
  });
  if (error) throw error;
  const client = createClient<Database>(URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  await client.auth.signInWithPassword({
    email,
    password: "test-password-123",
  });
  return { id: data.user.id, client };
}

const tmp = mkdtempSync(path.join(os.tmpdir(), "voice-test-"));
/** An MP3 of `seconds` of tone (stands in for speech). */
function mp3(seconds: number): Buffer {
  const file = path.join(tmp, `tone-${seconds}.mp3`);
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`, "-c:a", "libmp3lame", "-b:a", "64k", "-y", file]);
  return readFileSync(file);
}

// Fake OpenRouter speech API: the line "ยาว…" speaks for 3 s, others 1.5 s.
const speechCalls: Record<string, unknown>[] = [];
let failNext = false;
let tones: { short: Buffer; long: Buffer };
const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (req.headers.authorization !== "Bearer sk-or-test") return void res.writeHead(401).end();
    const send = (status: number, body: unknown) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
    if (req.method === "POST" && req.url === "/audio/speech") {
      const body = JSON.parse(raw) as Record<string, unknown>;
      speechCalls.push(body);
      if (failNext) {
        failNext = false;
        return send(402, {
          error: { code: 402, message: "Insufficient credits" },
        });
      }
      const n = speechCalls.length;
      return void res
        .writeHead(200, {
          "Content-Type": "audio/mpeg",
          "X-Generation-Id": `gen-tts-${n}`,
        })
        .end(String(body.input).startsWith("ยาว") ? tones.long : tones.short);
    }
    if (req.url?.startsWith("/generation?id=gen-tts-")) return send(200, { data: { total_cost: 0.0004 } });
    if (req.url === "/models?output_modalities=speech")
      return send(200, {
        data: [
          {
            id: "google/gemini-3.8-flash-tts",
            name: "Gemini TTS",
            pricing: { prompt: "0.0000005", completion: "0.000009" },
            architecture: {},
          },
        ],
      });
    send(404, { error: { message: "not found" } });
  });
});

let a: Awaited<ReturnType<typeof makeUser>>;
let b: Awaited<ReturnType<typeof makeUser>>;
let storyboardId: string;
let productId: string;
let storageDir: string;
const tts = {
  model: "google/gemini-3.8-flash-tts",
  voice: "Kore",
  instructions: "warm",
};

beforeAll(async () => {
  tones = { short: mp3(1.5), long: mp3(3) };
  storageDir = mkdtempSync(path.join(os.tmpdir(), "voice-store-"));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  process.env.USD_THB_RATE = "35";

  a = await makeUser("a");
  b = await makeUser("b");
  const { data: product } = await a.client.from("products").insert({ name: "ลำโพง", source: "manual" }).select("id").single();
  productId = product!.id;
  const { data: project } = await a.client
    .from("content_projects")
    .insert({
      product_id: productId,
      title: "t",
      platform: "tiktok",
      target_duration_s: 30,
    })
    .select("id")
    .single();
  const { data: sb } = await a.client
    .from("storyboards")
    .insert({
      project_id: project!.id,
      version: 1,
      template_id: "quick_review",
      template_version: 1,
      disclosure: "#ได้รับค่าคอมมิชชัน",
    })
    .select("id")
    .single();
  storyboardId = sb!.id;
  await a.client.from("storyboard_scenes").insert([
    {
      storyboard_id: storyboardId,
      position: 0,
      kind: "intro",
      narration: "ยาว ลำโพงตัวนี้เสียงดี",
    },
    {
      storyboard_id: storyboardId,
      position: 1,
      kind: "feature",
      narration: "  กันน้ำได้  ",
    },
    { storyboard_id: storyboardId, position: 2, kind: "cta", narration: "" },
  ]);
});

afterAll(async () => {
  server.close();
  delete process.env.OPENROUTER_BASE_URL;
  for (const u of [a, b]) if (u) await admin.auth.admin.deleteUser(u.id);
  rmSync(storageDir, { recursive: true, force: true });
  rmSync(tmp, { recursive: true, force: true });
});

const scenes = async () => (await admin.from("storyboard_scenes").select("id, position, narration").eq("storyboard_id", storyboardId).order("position")).data!;

describe("voice-over", () => {
  it("speaks each line once, measures and caches it, logs every call; a rerun reuses the cache", async () => {
    const storage = new LocalDiskStorage(storageDir);
    const input = {
      ownerId: a.id,
      storyboardId,
      productId,
      tts,
      scenes: await scenes(),
      tmp,
    };
    const first = await prepareVoiceover(admin, storage, input);
    expect([first.generated, first.reused]).toEqual([2, 0]);
    expect(speechCalls).toHaveLength(2);
    expect(speechCalls[1]).toEqual({
      model: tts.model,
      input: "กันน้ำได้",
      voice: "Kore",
      instructions: "warm",
      response_format: "mp3",
    });
    const [s0, s1, s2] = await scenes();
    expect(first.byScene.get(s0.id)!.seconds).toBeCloseTo(3, 0);
    expect(first.byScene.get(s1.id)!.seconds).toBeCloseTo(1.5, 0);
    expect(first.byScene.has(s2.id)).toBe(false);
    expect(first.costThb).toBeCloseTo(0.028, 3);

    const { data: logs } = await a.client.from("ai_requests").select("task, model, status, generation_id, cost_usd").eq("storyboard_id", storyboardId).order("generation_id");
    expect(logs).toEqual([
      {
        task: "tts",
        model: tts.model,
        status: "succeeded",
        generation_id: "gen-tts-1",
        cost_usd: 0.0004,
      },
      {
        task: "tts",
        model: tts.model,
        status: "succeeded",
        generation_id: "gen-tts-2",
        cost_usd: 0.0004,
      },
    ]);

    const again = await prepareVoiceover(admin, storage, input);
    expect([again.generated, again.reused, again.costThb]).toEqual([0, 2, 0]);
    expect(speechCalls).toHaveLength(2);
    // A different voice is a different recording.
    const other = await prepareVoiceover(admin, storage, {
      ...input,
      tts: { ...tts, voice: "Puck" },
    });
    expect(other.generated).toBe(2);
  });

  it("a failed call is logged and stops the voice-over with a readable error", async () => {
    await admin.from("storyboard_scenes").update({ narration: "ประโยคใหม่" }).eq("storyboard_id", storyboardId).eq("position", 1);
    failNext = true;
    const input = {
      ownerId: a.id,
      storyboardId,
      productId,
      tts,
      scenes: await scenes(),
      tmp,
    };
    await expect(prepareVoiceover(admin, new LocalDiskStorage(storageDir), input)).rejects.toThrow(/ฉากที่ 2 ไม่สำเร็จ: เครดิต OpenRouter ไม่พอ/);
    expect((await a.client.from("ai_requests").select("status").eq("storyboard_id", storyboardId).eq("status", "failed")).data).toHaveLength(1);
  });

  it("the cache is the owner's to read only; nobody but the worker writes it", async () => {
    expect(((await a.client.from("tts_cache").select("owner_id")).data ?? []).every((r) => r.owner_id === a.id)).toBe(true);
    expect((await a.client.from("tts_cache").select("id")).data!.length).toBeGreaterThan(0);
    expect((await b.client.from("tts_cache").select("id")).data).toEqual([]);
    const row = {
      owner_id: a.id,
      cache_key: "0".repeat(64),
      model: "m/x",
      text_chars: 1,
      storage_key: "k",
      mime: "audio/mpeg",
      duration_s: 1,
    };
    expect((await a.client.from("tts_cache").insert(row)).error?.code).toBe("42501");
    expect((await a.client.from("tts_cache").delete().eq("owner_id", a.id)).error?.code).toBe("42501");
  });

  it("an audio asset can't be a scene's picture", async () => {
    const id = crypto.randomUUID();
    const { data: track } = await admin
      .from("assets")
      .insert({
        id,
        owner_id: a.id,
        kind: "audio",
        storage_key: `${a.id}/${id}/original.mp3`,
        name: "เพลง",
        mime: "audio/mpeg",
        size_bytes: 1,
        sha256: "a".repeat(64),
        source: "own",
        license: "own_work",
      })
      .select("id")
      .single();
    const [s0] = await scenes();
    expect((await a.client.from("storyboard_scenes").update({ asset_id: track!.id }).eq("id", s0.id)).error?.code).toBe("22023");
    await admin.from("assets").delete().eq("id", track!.id);
  });
});

describe("render with voice and music (worker --drain)", () => {
  it("scenes follow the spoken lengths, the MP4 carries the audio, QA reports the voice", async () => {
    // Music: an own-work track in A's library, stored where the worker reads assets.
    const store = path.resolve(env.RENDER_STORAGE_DIR || "storage/renders");
    const storage = new LocalDiskStorage(store);
    const musicId = crypto.randomUUID();
    const key = `${a.id}/${musicId}/original.mp3`;
    const musicFile = path.join(tmp, "tone-3.mp3");
    await storage.put(key, musicFile);
    await admin.from("assets").insert({
      id: musicId,
      owner_id: a.id,
      kind: "audio",
      storage_key: key,
      name: "เพลงทดสอบ",
      mime: "audio/mpeg",
      size_bytes: tones.long.length,
      sha256: "b".repeat(64),
      duration_s: 3,
      source: "own",
      license: "own_work",
    });
    await admin.from("storyboard_scenes").update({ narration: "กันน้ำได้" }).eq("storyboard_id", storyboardId).eq("position", 1);
    await admin.from("storyboards").update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", storyboardId);
    const { data: job, error } = await a.client
      .from("render_jobs")
      .insert({
        owner_id: a.id,
        storyboard_id: storyboardId,
        settings: { tts, music_asset_id: musicId },
      })
      .select("id")
      .single();
    expect(error).toBeNull();

    const out = await new Promise<string>((resolve, reject) => {
      const p = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", "worker/render-worker.ts", "--drain"], { env: { ...process.env }, shell: process.platform === "win32" });
      let log = "";
      p.stdout.on("data", (d) => (log += d));
      p.stderr.on("data", (d) => (log += d));
      p.on("close", (code) => (code === 0 ? resolve(log) : reject(new Error(`worker exited ${code}\n${log}`))));
    });
    const { data: done } = await admin.from("render_jobs").select("status, error_message, output:render_outputs(*)").eq("id", job!.id).single();
    expect(done!.error_message, out).toBeNull();
    expect(done!.status).toBe("completed");
    const output = (Array.isArray(done!.output) ? done!.output[0] : done!.output)!;
    const report = output.report as {
      checks: { key: string; ok: boolean; detail: string }[];
    };
    // The lines cached above live in the test's own storage folder, so the worker speaks them again.
    expect(report.checks.find((c) => c.key === "voice")).toMatchObject({
      ok: true,
      detail: expect.stringContaining("2/2 ฉาก · สร้างใหม่ 2 ใช้ซ้ำ 0"),
    });
    expect(report.checks.find((c) => c.key === "music")).toMatchObject({
      ok: true,
    });
    const facts = probeFacts(await runFfprobe(path.join(store, ...output.video_key.split("/"))));
    expect(facts.audioCodec).toBe("aac");
    // Not the silent track: voice and music are mixed in.
    const levels = spawnSync("ffmpeg", ["-hide_banner", "-i", path.join(store, ...output.video_key.split("/")), "-af", "volumedetect", "-vn", "-f", "null", "-"], { encoding: "utf8" }).stderr;
    expect(Number(/mean_volume: (-?[\d.]+) dB/.exec(levels)?.[1])).toBeGreaterThan(-40);
    // 3 s + 1.5 s spoken (+ pauses), the silent scene's 2 s minimum, the 3.5 s end card.
    expect(facts.durationS!).toBeGreaterThan(10.4);
    expect(facts.durationS!).toBeLessThan(11.2);
    await storage.removePrefix(`${a.id}/${job!.id}`);
    await storage.removePrefix(`${a.id}/${musicId}`);
    for (const c of (await admin.from("tts_cache").select("storage_key").eq("owner_id", a.id)).data ?? []) await storage.removePrefix(c.storage_key.split("/").slice(0, 2).join("/"));
  }, 240_000);
});
