import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";

/*
 * AI-3 (docs/AI_VIDEO_PLAN.md): Video Studio shows "คลิป AI ต่อฉาก" — each scene's visual plan can be
 * switched to an AI clip with a prompt and saved, with the model and estimated cost from the live
 * catalog; render is blocked until the AI scene has an approved clip, then uses it (QA check) and
 * the caption notes AI imagery (AI-4). Nothing paid is clicked; the worker's OpenRouter pipeline is
 * covered by tests/rls/ai-clips.test.ts.
 */

function env(name: string): string {
  if (process.env[name]) return process.env[name]!;
  const m = new RegExp(`^${name}=(.*)$`, "m").exec(readFileSync(".env.local", "utf8"));
  return m?.[1].trim() ?? "";
}
const run = Date.now();
const today = new Date().toISOString().slice(0, 10);

test("plan an AI clip, render only with an approved clip, caption notes AI imagery", async ({ page }) => {
  test.skip(!env("OPENROUTER_API_KEY"), "OPENROUTER_API_KEY not set");
  test.setTimeout(180_000);
  await page.goto("/login");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await page.getByLabel("อีเมล").fill(`e2e-ai3-${run}@example.test`);
  await page.getByLabel("รหัสผ่าน").fill("e2e-password-123");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/products/new");
  await page.getByLabel(/ชื่อสินค้า/).fill(`หูฟัง AI3 ${run}`);
  await page.getByLabel("ราคา (บาท)").fill("990");
  await page.getByLabel("วันที่ได้ข้อมูลราคา/ค่าคอม").fill(today);
  await page.getByText("รายละเอียดเพิ่มเติม").click();
  await page.getByLabel(/^ลิงก์รูปภาพ/).fill("https://example.test/earbuds.jpg");
  await page.getByRole("button", { name: "บันทึกสินค้า" }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/);
  await page.getByRole("link", { name: "สร้างคอนเทนต์" }).first().click();
  await page.getByRole("radio", { name: "รีวิวสั้น" }).check();
  await page.getByRole("button", { name: "สร้างฉบับร่าง" }).click();
  await expect(page).toHaveURL(/\/studio\/[0-9a-f-]{36}$/);
  const storyboardId = page.url().split("/").pop()!;

  // Approving through the UI needs every claim checked (covered by M3); approve directly here.
  const admin = createClient<Database>(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  expect((await admin.from("storyboards").update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", storyboardId)).error).toBeNull();

  await page.goto(`/videos/${storyboardId}`);
  const clips = page.getByRole("region", { name: "คลิป AI ต่อฉาก" });
  await expect(clips.getByRole("button", { name: "ให้ AI วางแผนภาพทุกฉาก" })).toBeVisible();
  const first = clips.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "ฉากที่ 1" }) });
  await first.getByLabel("ภาพของฉากนี้").selectOption("ai_video");
  await first.getByLabel("Prompt (ภาษาอังกฤษ)").fill("Slow rotation of the earbuds on a white surface, soft studio light");
  await first.getByRole("button", { name: "บันทึกแผนภาพ" }).click();
  await expect(page.getByText("บันทึกแผนภาพแล้ว")).toBeVisible();

  await page.reload();
  const again = page.getByRole("region", { name: "คลิป AI ต่อฉาก" }).getByRole("listitem").filter({ has: page.getByRole("heading", { name: "ฉากที่ 1" }) });
  await expect(again.getByLabel("ภาพของฉากนี้")).toHaveValue("ai_video");
  await expect(again.getByLabel("Prompt (ภาษาอังกฤษ)")).toHaveValue(/Slow rotation/);
  await expect(again.getByText(/kwaivgi\/kling-v3\.0-std · 5 วิ · ประมาณ ฿\d/)).toBeVisible();
  await expect(again.getByRole("button", { name: "สร้างคลิป AI" })).toBeVisible();

  // The model can be picked right here (default: Settings); the estimate follows the pick.
  const model = again.getByLabel("โมเดลวิดีโอ");
  await expect(model).toHaveValue("");
  await expect(model.locator("option").first()).toHaveText("ตามหน้าตั้งค่า (kwaivgi/kling-v3.0-std)");
  await model.selectOption("google/veo-3.1-lite");
  await again.getByRole("button", { name: "บันทึกแผนภาพ" }).click();
  await expect(page.getByText("บันทึกแผนภาพแล้ว").first()).toBeVisible();
  await page.reload();
  const picked = page.getByRole("region", { name: "คลิป AI ต่อฉาก" }).getByRole("listitem").filter({ has: page.getByRole("heading", { name: "ฉากที่ 1" }) });
  await expect(picked.getByLabel("โมเดลวิดีโอ")).toHaveValue("google/veo-3.1-lite");
  await expect(picked.getByText(/google\/veo-3\.1-lite · 4 วิ · ประมาณ ฿\d/)).toBeVisible();

  // AI-4: rendering waits for an approved clip in every AI scene.
  await page.getByRole("button", { name: "Render วิดีโอ" }).click();
  await expect(page.getByText(/ฉากที่ 1 ตั้งเป็นคลิป AI แต่ยังไม่มีคลิปที่อนุมัติ/)).toBeVisible();

  // A finished, approved clip — seeded here as a test MP4 (tests/rls/ai-clips.test.ts covers how the
  // worker gets one from OpenRouter).
  const { data: sb } = await admin.from("storyboards").select("owner_id").eq("id", storyboardId).single();
  const sceneId = (await admin.from("storyboard_scenes").select("id").eq("storyboard_id", storyboardId).eq("position", 0).single()).data!.id;
  const assetId = randomUUID();
  const key = `${sb!.owner_id}/${assetId}/original.mp4`;
  const file = path.join(path.resolve(env("RENDER_STORAGE_DIR") || "storage/renders"), ...key.split("/"));
  mkdirSync(path.dirname(file), { recursive: true });
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=s=720x1280:d=3:r=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", file]);
  const bytes = readFileSync(file);
  expect(
    (
      await admin.from("assets").insert({
        id: assetId,
        owner_id: sb!.owner_id,
        kind: "video",
        storage_key: key,
        name: "คลิป AI ทดสอบ",
        mime: "video/mp4",
        size_bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        width: 720,
        height: 1280,
        duration_s: 3,
        source: "ai_generated",
        license: "unknown",
        ai_generated: true,
      })
    ).error,
  ).toBeNull();
  expect(
    (
      await admin.from("scene_generations").insert({
        owner_id: sb!.owner_id,
        scene_id: sceneId,
        storyboard_id: storyboardId,
        video_task: "video_product",
        model: "kwaivgi/kling-v3.0-std",
        prompt: "test",
        duration_s: 3,
        est_cost_thb: 0,
        status: "succeeded",
        asset_id: assetId,
      })
    ).error,
  ).toBeNull();
  await page.reload();
  const panel = page.getByRole("region", { name: "คลิป AI ต่อฉาก" }).getByRole("listitem").filter({ has: page.getByRole("heading", { name: "ฉากที่ 1" }) });
  await expect(panel.getByText("คลิป AI — สินค้าอาจไม่ตรงของจริง 100%")).toBeVisible();
  await panel.getByRole("button", { name: "ใช้คลิปนี้" }).click();
  await expect(panel.getByText("ใช้คลิป AI ที่อนุมัติแล้ว")).toBeVisible();

  await page.getByRole("button", { name: "Render วิดีโอ" }).click();
  await runWorker();
  await expect(page.locator('video[src*="/api/renders/"]')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("1 ฉากใช้คลิป AI ที่อนุมัติแล้ว (ตั้งไว้ 1 ฉาก)")).toBeVisible();

  // The caption says the video contains AI imagery.
  await page.getByRole("button", { name: "เตรียมเผยแพร่" }).click();
  await expect(page).toHaveURL(/\/publishing\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("textbox", { name: "แคปชัน" })).toHaveValue(/มีภาพบางส่วนในคลิปนี้สร้างด้วย AI/);
});

function runWorker(): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", "worker/render-worker.ts", "--drain"], { env: process.env, shell: process.platform === "win32" });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`worker exited ${code}\n${out}`))));
  });
}
