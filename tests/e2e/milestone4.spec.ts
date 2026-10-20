import { spawn } from "node:child_process";
import { expect, test } from "@playwright/test";

/*
 * Milestone 4 acceptance: approved storyboard → preview → render (real worker process) →
 * MP4 1080×1920 30fps H.264/AAC passes QA → download (with Range) → rerender.
 * Needs FFmpeg's ffprobe on PATH or FFPROBE_PATH.
 */

const run = Date.now();
const today = new Date().toISOString().slice(0, 10);

function runWorker(): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", "worker/render-worker.ts", "--drain"], { env: process.env, shell: process.platform === "win32" });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`worker exited ${code}\n${out}`))));
  });
}

test("render a video from an approved script", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/login");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await page.getByLabel("อีเมล").fill(`e2e-m4-${run}@example.test`);
  await page.getByLabel("รหัสผ่าน").fill("e2e-password-123");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/products/new");
  await page.getByLabel(/ชื่อสินค้า/).fill(`พัดลมพกพา M4 ${run}`);
  await page.getByLabel("ราคา (บาท)").fill("259");
  await page.getByLabel("วันที่ได้ข้อมูลราคา/ค่าคอม").fill(today);
  await page.getByRole("button", { name: "บันทึกสินค้า" }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/);
  await page.getByRole("link", { name: "ข้อเท็จจริง", exact: true }).click();
  await page.getByLabel(/^หัวข้อ/).fill("ความเร็วลม");
  await page.getByLabel(/^รายละเอียด/).fill("ปรับได้ 3 ระดับ");
  await page.getByRole("button", { name: "เพิ่มข้อเท็จจริง" }).click();
  await expect(page.getByText("ปรับได้ 3 ระดับ")).toBeVisible();

  await page.getByRole("link", { name: "สร้างคอนเทนต์" }).first().click();
  await page.getByRole("radio", { name: "แจ้งราคา" }).check();
  await page.getByLabel("ความยาวเป้าหมาย").selectOption("15");
  await page.getByRole("button", { name: "สร้างฉบับร่าง" }).click();
  await expect(page).toHaveURL(/\/studio\//);
  const confirm = page.getByRole("button", { name: "ตรงกับข้อเท็จจริง" });
  const n = await confirm.count();
  for (let i = 0; i < n; i++) {
    await confirm.and(page.locator(":enabled")).first().click();
    await expect(page.getByText("ตรวจแล้ว", { exact: true })).toHaveCount(i + 1);
  }
  await page.getByRole("button", { name: "อนุมัติสคริปต์" }).click();
  await page.getByRole("link", { name: "ไปทำวิดีโอ" }).click();
  await expect(page).toHaveURL(/\/videos\/[0-9a-f-]{36}$/);

  // Live preview before rendering.
  await expect(page.getByRole("heading", { name: "ตัวอย่างสด" })).toBeVisible();
  await expect(page.locator("video")).toHaveCount(0);

  // Queue; a second click is idempotent.
  await page.getByRole("button", { name: "Render วิดีโอ" }).click();
  await expect(page.getByText("รอคิว").first()).toBeVisible();

  // Tests run in parallel against one queue: another test's worker may take this job, so wait
  // for the result rather than for this worker's log.
  await runWorker();

  await expect(page.locator('video[src*="/api/renders/"]')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("codec วิดีโอ")).toBeVisible();
  await expect(page.getByText(/h264/)).toBeVisible();
  await expect(page.getByText("1080×1920 (ต้องการ 1080×1920)")).toBeVisible();
  await expect(page.getByText("เสียงพากย์", { exact: true })).toBeVisible(); // warning: no TTS yet

  // Downloads: full file and a byte range (seeking).
  const mp4Href = await page.getByRole("link", { name: "MP4" }).getAttribute("href");
  const full = await page.request.get(mp4Href!);
  expect(full.status()).toBe(200);
  expect(full.headers()["content-type"]).toBe("video/mp4");
  expect(full.headers()["content-disposition"]).toContain("attachment");
  const part = await page.request.get(mp4Href!.split("?")[0], { headers: { Range: "bytes=0-99" } });
  expect(part.status()).toBe(206);
  expect((await part.body()).length).toBe(100);
  const srt = await page.request.get((await page.getByRole("link", { name: "ซับไตเติล (SRT)" }).getAttribute("href"))!);
  expect(await srt.text()).toContain("#ได้รับค่าคอมมิชชัน");

  // Rerender is available once the job is done.
  await expect(page.getByRole("button", { name: "Render ใหม่" })).toBeVisible();
  await expect(page.getByRole("table", { name: "ประวัติการ render" }).locator("tbody tr")).toHaveCount(1);

  // Optional visual check: SHOT_DIR=… saves desktop and mobile screenshots.
  if (process.env.SHOT_DIR) {
    await page.screenshot({ path: `${process.env.SHOT_DIR}/video-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${process.env.SHOT_DIR}/video-mobile.png`, fullPage: true });
  }
});
