import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";

/*
 * AI-5 (docs/AI_VIDEO_PLAN.md): Settings picks the TTS model from the live speech catalog and a
 * voice; a music file uploads into the library; Video Studio offers "ใส่เสียงพากย์ AI" with an
 * estimate and a music picker, and a render with music (no paid voice) passes QA. The paid voice
 * path is covered against a fake OpenRouter in tests/rls/ai-voice.test.ts.
 */

function env(name: string): string {
  if (process.env[name]) return process.env[name]!;
  const m = new RegExp(`^${name}=(.*)$`, "m").exec(readFileSync(".env.local", "utf8"));
  return m?.[1].trim() ?? "";
}
const run = Date.now();
const today = new Date().toISOString().slice(0, 10);

test("voice settings, music upload, render with music", async ({ page }) => {
  test.skip(!env("OPENROUTER_API_KEY"), "OPENROUTER_API_KEY not set");
  test.setTimeout(180_000);
  await page.goto("/login");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await page.getByLabel("อีเมล").fill(`e2e-ai5-${run}@example.test`);
  await page.getByLabel("รหัสผ่าน").fill("e2e-password-123");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // Settings: TTS model from the speech catalog, voice name validated and saved.
  await page.goto("/settings");
  const ai = page.getByRole("region", { name: "AI (OpenRouter)" });
  const tts = ai.getByLabel("เสียงพากย์", { exact: true });
  await expect(tts).toHaveValue("google/gemini-3.8-flash-tts");
  await expect(tts.locator("option", { hasText: /ElevenLabs|Eleven/ }).first()).toBeAttached();
  await ai.getByLabel(/เสียงพากย์ \(ชื่อเสียง\)/).fill("Kore; drop");
  await ai.getByRole("button", { name: "บันทึกการตั้งค่า AI" }).click();
  await expect(ai.getByText(/ใช้ได้เฉพาะตัวอักษรอังกฤษ/)).toBeVisible();
  await ai.getByLabel(/เสียงพากย์ \(ชื่อเสียง\)/).fill("Puck");
  await ai.getByRole("button", { name: "บันทึกการตั้งค่า AI" }).click();
  await expect(ai.getByText("บันทึกการตั้งค่า AI แล้ว")).toBeVisible();
  await page.reload();
  await expect(ai.getByLabel(/เสียงพากย์ \(ชื่อเสียง\)/)).toHaveValue("Puck");

  // A music file (own work) through the upload route.
  const dir = mkdtempSync(path.join(os.tmpdir(), "e2e-music-"));
  const mp3 = path.join(dir, "music.mp3");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `sine=frequency=330:duration=4`, "-metadata", `title=${run}`, "-c:a", "libmp3lame", "-b:a", "64k", "-y", mp3]);
  const upload = await page.request.post("/api/assets", {
    multipart: { file: { name: "music.mp3", mimeType: "audio/mpeg", buffer: readFileSync(mp3) }, name: "เพลงทดสอบ", source: "own", license: "own_work" },
  });
  rmSync(dir, { recursive: true, force: true });
  expect(upload.ok(), await upload.text()).toBe(true);
  await page.goto("/assets?kind=audio");
  await expect(page.getByText("เพลงทดสอบ")).toBeVisible();
  await expect(page.getByLabel("เพลง", { exact: true })).toBeVisible();

  // A script to render.
  await page.goto("/products/new");
  await page.getByLabel(/ชื่อสินค้า/).fill(`หูฟัง AI5 ${run}`);
  await page.getByLabel("ราคา (บาท)").fill("990");
  await page.getByLabel("วันที่ได้ข้อมูลราคา/ค่าคอม").fill(today);
  await page.getByRole("button", { name: "บันทึกสินค้า" }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/);
  await page.getByRole("link", { name: "สร้างคอนเทนต์" }).first().click();
  await page.getByRole("radio", { name: "รีวิวสั้น" }).check();
  await page.getByRole("button", { name: "สร้างฉบับร่าง" }).click();
  await expect(page).toHaveURL(/\/studio\/[0-9a-f-]{36}$/);
  const storyboardId = page.url().split("/").pop()!;
  const admin = createClient<Database>(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  expect((await admin.from("storyboards").update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", storyboardId)).error).toBeNull();

  // Video Studio: voice option with model, voice and estimate; music picker.
  await page.goto(`/videos/${storyboardId}`);
  const voice = page.getByRole("checkbox", { name: /ใส่เสียงพากย์ AI/ });
  await expect(voice).not.toBeChecked();
  await expect(page.getByText(/google\/gemini-3\.8-flash-tts · เสียง Puck · ประมาณ ฿[\d.]+/)).toBeVisible();
  await page.getByLabel("เพลงประกอบ").selectOption({ label: "เพลงทดสอบ (4 วิ)" });
  await page.getByRole("button", { name: "Render วิดีโอ" }).click();
  await runWorker();
  await expect(page.locator('video[src*="/api/renders/"]')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/เพลงทดสอบ — ใช้ได้/)).toBeVisible();
  await expect(page.getByText(/ไม่ได้เลือกเสียงพากย์/)).toBeVisible();
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
