/**
 * Video-model bake-off (docs/AI_VIDEO_PLAN.md AI-3): the same product photo (first frame) and
 * prompt sent to several OpenRouter video models. Saves each MP4 plus a frame sheet under
 * storage/ai-bakeoff/clips/ and logs every job (with the cost OpenRouter reports) in ai_requests
 * under the product's owner, so it counts toward your spending caps.
 *
 *   npx tsx scripts/video-bakeoff.ts <product-id> <image-url> [model:seconds ...]
 *
 * Costs money (≈ ฿38 for the default three). Nothing in the product is changed.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { usdToThb } from "../src/features/ai/models";
import { downloadVideo, estimateVideoUsd, getVideoJob, listVideoModels, OpenRouterError, submitVideo } from "../src/features/ai/openrouter";
import type { Database } from "../src/lib/supabase/database.types";

const DEFAULT_RUNS = ["google/veo-3.1-lite:6", "kwaivgi/kling-v3.0-std:5", "google/veo-3.1-fast:6"];
const PROMPT =
  "Slow 360-degree turntable rotation of the product from the first frame on a clean white studio surface. Soft diffused studio lighting, gentle reflections, shallow depth of field. The product keeps exactly its shape, colors and details from the first frame. No text, no logos added, no people, no hands.";
const POLL_MS = 15_000;
const GIVE_UP_MS = 20 * 60_000;

function env(name: string): string {
  if (process.env[name]) return process.env[name]!;
  const m = new RegExp(`^${name}=(.*)$`, "m").exec(readFileSync(".env.local", "utf8"));
  if (!m) throw new Error(`${name} missing in .env.local`);
  return (process.env[name] = m[1].trim());
}

async function main() {
  const [productId, imageUrl, ...runs] = process.argv.slice(2);
  if (!productId || !imageUrl) throw new Error("usage: npx tsx scripts/video-bakeoff.ts <product-id> <image-url> [model:seconds ...]");
  env("OPENROUTER_API_KEY");
  const db = createClient<Database>(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const { data: product } = await db.from("products").select("owner_id, name").eq("id", productId).single();
  if (!product) throw new Error("product not found");
  const catalog = await listVideoModels();
  const dir = path.resolve("storage/ai-bakeoff/clips", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(dir, { recursive: true });
  const log = (model: string, status: "succeeded" | "failed", extra: { generationId?: string | null; seconds?: number; usd?: number; error?: string }) =>
    db.from("ai_requests").insert({
      owner_id: product.owner_id,
      task: "video_product",
      model,
      status,
      generation_id: extra.generationId ?? null,
      video_seconds: extra.seconds ?? null,
      cost_usd: extra.usd ?? 0,
      cost_thb: usdToThb(extra.usd ?? 0),
      error: extra.error?.slice(0, 1000) ?? null,
      product_id: productId,
    });

  const results = await Promise.all(
    (runs.length ? runs : DEFAULT_RUNS).map(async (run) => {
      const [model, secs] = run.split(":");
      const seconds = Number(secs) || 5;
      const info = catalog.find((m) => m.id === model);
      const est = info ? estimateVideoUsd(info.pricing, seconds, true) : null;
      const started = Date.now();
      try {
        const job = await submitVideo({ model, prompt: PROMPT, duration: seconds, aspectRatio: "9:16", resolution: "720p", firstFrameUrl: imageUrl });
        console.log(`${model}: submitted ${job.id} (est. ${est === null ? "?" : `฿${usdToThb(est).toFixed(2)}`})`);
        for (;;) {
          await new Promise((r) => setTimeout(r, POLL_MS));
          const s = await getVideoJob(job.id);
          if (s.status === "completed") {
            const mp4 = await downloadVideo(job.id);
            const file = path.join(dir, `${model.replace(/[/:]/g, "_")}.mp4`);
            writeFileSync(file, mp4);
            execFileSync("ffmpeg", ["-v", "error", "-i", file, "-vf", "fps=2,scale=180:-1,tile=6x2", "-frames:v", "1", "-y", file.replace(/\.mp4$/, "-frames.png")]);
            await log(model, "succeeded", { generationId: s.generationId ?? job.id, seconds, usd: s.costUsd ?? est ?? 0 });
            return { model, ok: true, thb: usdToThb(s.costUsd ?? est ?? 0), reported: s.costUsd !== null, secs: (Date.now() - started) / 1000, file };
          }
          if (s.status === "failed") throw new OpenRouterError(s.error ?? "งานล้มเหลว");
          if (Date.now() - started > GIVE_UP_MS) throw new OpenRouterError("รอนานเกิน 20 นาที");
        }
      } catch (e) {
        const msg = e instanceof OpenRouterError ? e.message : (e as Error).message;
        await log(model, "failed", { error: msg });
        return { model, ok: false, error: msg, secs: (Date.now() - started) / 1000 };
      }
    }),
  );

  const lines = [`# เทียบโมเดลวิดีโอ — ${product.name}`, "", `รูปเฟรมแรก: ${imageUrl}`, "", `Prompt: ${PROMPT}`, ""];
  let total = 0;
  for (const r of results) {
    if (r.ok) {
      total += r.thb!;
      lines.push(`- **${r.model}** · ฿${r.thb!.toFixed(2)}${r.reported ? "" : " (ประมาณ)"} · ${r.secs.toFixed(0)} วิ · ${path.basename(r.file!)}`);
    } else lines.push(`- **${r.model}** · ล้มเหลว: ${r.error}`);
    console.log(r.ok ? `${r.model}: ok ฿${r.thb!.toFixed(2)} in ${r.secs.toFixed(0)} s` : `${r.model}: FAILED ${r.error}`);
  }
  lines.push("", `รวม ฿${total.toFixed(2)}`);
  writeFileSync(path.join(dir, "report.md"), lines.join("\n"), "utf8");
  console.log(`total ฿${total.toFixed(2)} → ${dir}`);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
