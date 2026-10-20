import { spawn } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";

/*
 * Milestone 5 acceptance: asset library with honest licensing, assets in scenes (license gate),
 * usage logged per render, spending cap stops paid work with a message.
 */

const run = Date.now();
const today = new Date().toISOString().slice(0, 10);
const fixture = (f: string) => path.join(__dirname, "fixtures", f);

function runWorker(): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", "worker/render-worker.ts", "--drain"], { env: process.env, shell: process.platform === "win32" });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`worker exited ${code}\n${out}`))));
  });
}

async function upload(page: import("@playwright/test").Page, file: string, name: string, source: string, license: string) {
  await page.locator("#asset-file").setInputFiles(fixture(file));
  await page.getByLabel(/^ชื่อ/).first().fill(name);
  await page.getByLabel(/^แหล่งที่มา/).selectOption(source);
  await page.getByLabel(/^สิทธิ์การใช้งาน/).selectOption(license);
  await page.getByRole("button", { name: "อัปโหลด" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: name })).toBeVisible();
}

test("assets, usage and spending cap", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/login");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await page.getByLabel("อีเมล").fill(`e2e-m5-${run}@example.test`);
  await page.getByLabel("รหัสผ่าน").fill("e2e-password-123");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // Asset library: uploads with licensing.
  await page.goto("/assets");
  await upload(page, "clip.mp4", "คลิปเดโม", "own", "own_work");
  await upload(page, "photo.png", "รูปสต็อก", "stock", "cc_by");
  await upload(page, "nc.png", "รูปห้ามขาย", "stock", "non_commercial");
  const clipCard = page.getByRole("listitem").filter({ hasText: "คลิปเดโม" });
  await expect(clipCard).toContainText("720×1280");
  await expect(clipCard).toContainText("2.0 วิ");
  await expect(page.getByRole("listitem").filter({ hasText: "รูปสต็อก" })).toContainText("CC BY ต้องให้เครดิต");
  await expect(page.getByRole("listitem").filter({ hasText: "รูปห้ามขาย" })).toContainText("ใช้ในวิดีโอ affiliate ไม่ได้");
  // Same file again is not stored twice.
  await page.locator("#asset-file").setInputFiles(fixture("clip.mp4"));
  await page.getByRole("button", { name: "อัปโหลด" }).click();
  await expect(page.getByText(/ไฟล์นี้มีอยู่แล้ว/)).toBeVisible();
  // Add the credit → warning gone.
  await page.getByRole("button", { name: "แก้ไข รูปสต็อก" }).click();
  await page.getByRole("dialog").getByLabel(/^เครดิต/).fill("ภาพโดย ช่างภาพ จาก stock");
  await page.getByRole("dialog").getByRole("button", { name: "บันทึก" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ hasText: "รูปสต็อก" })).not.toContainText("CC BY ต้องให้เครดิต —");

  // Script with assets in scenes.
  await page.goto("/products/new");
  await page.getByLabel(/ชื่อสินค้า/).fill(`กระติกน้ำ M5 ${run}`);
  await page.getByLabel("ราคา (บาท)").fill("390");
  await page.getByLabel("วันที่ได้ข้อมูลราคา/ค่าคอม").fill(today);
  await page.getByRole("button", { name: "บันทึกสินค้า" }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/);
  await page.getByRole("link", { name: "ข้อเท็จจริง", exact: true }).click();
  await page.getByLabel(/^หัวข้อ/).fill("เก็บความเย็น");
  await page.getByLabel(/^รายละเอียด/).fill("นาน 12 ชั่วโมง");
  await page.getByRole("button", { name: "เพิ่มข้อเท็จจริง" }).click();
  await expect(page.getByText("นาน 12 ชั่วโมง")).toBeVisible();
  await page.getByRole("link", { name: "สร้างคอนเทนต์" }).first().click();
  await page.getByRole("radio", { name: "แจ้งราคา" }).check();
  await page.getByLabel("ความยาวเป้าหมาย").selectOption("15");
  await page.getByRole("button", { name: "สร้างฉบับร่าง" }).click();
  await expect(page).toHaveURL(/\/studio\//);

  const pick = async (scene: number, name: string) => {
    await page.getByRole("button", { name: `เลือกภาพสำหรับฉากที่ ${scene}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: new RegExp(name) }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  };
  await pick(1, "คลิปเดโม");
  await pick(2, "รูปห้ามขาย");
  await expect(page.getByText(/ไฟล์ “รูปห้ามขาย” สิทธิ์ห้ามใช้เชิงพาณิชย์/)).toBeVisible();
  await pick(2, "รูปสต็อก");
  await expect(page.getByText(/ไฟล์ “รูปห้ามขาย”/)).toHaveCount(0);

  const confirm = page.getByRole("button", { name: "ตรงกับข้อเท็จจริง" });
  const n = await confirm.count();
  for (let i = 0; i < n; i++) {
    await confirm.and(page.locator(":enabled")).first().click();
    await expect(page.getByText("ตรวจแล้ว", { exact: true })).toHaveCount(i + 1);
  }
  await page.getByRole("button", { name: "อนุมัติสคริปต์" }).click();
  await expect(page.getByText("อนุมัติแล้ว", { exact: true }).first()).toBeVisible();
  const videoUrl = (await page.getByRole("link", { name: "ไปทำวิดีโอ" }).getAttribute("href"))!;

  // An asset used in a scene can't be deleted.
  await page.goto("/assets");
  await page.getByRole("button", { name: "ลบ คลิปเดโม" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "ลบไฟล์" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("ถูกใช้อยู่ในฉาก");
  await page.getByRole("button", { name: "ยกเลิก" }).click();

  // Spending cap stops paid work with a message.
  await page.goto("/settings");
  await page.getByLabel("เพดานรายเดือน (บาท)").fill("0.1");
  await page.getByRole("button", { name: "บันทึกเพดาน" }).click();
  await expect(page.getByText("บันทึกเพดานค่าใช้จ่ายแล้ว")).toBeVisible();
  await page.goto(videoUrl);
  await page.getByRole("button", { name: "Render วิดีโอ" }).click();
  await expect(page.getByText(/เกินงบรายเดือน ฿0\.10/)).toBeVisible();

  // Raise the cap → render with the clip and image → usage logged.
  await page.goto("/settings");
  await page.getByLabel("เพดานรายเดือน (บาท)").fill("100");
  await page.getByRole("button", { name: "บันทึกเพดาน" }).click();
  await expect(page.getByText("บันทึกเพดานค่าใช้จ่ายแล้ว")).toBeVisible();
  await page.goto(videoUrl);
  await page.getByRole("button", { name: "Render วิดีโอ" }).click();
  await expect(page.getByText("รอคิว").first()).toBeVisible();
  // Tests run in parallel against one queue: another test's worker may take this job, so wait
  // for the result rather than for this worker's log.
  await runWorker();
  await expect(page.locator('video[src*="/api/renders/"]')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("codec วิดีโอ")).toBeVisible();

  await page.goto("/settings");
  const usage = page.getByRole("listitem").filter({ hasText: "Render วิดีโอ (บนเครื่องนี้)" });
  await expect(usage).toContainText("1 ครั้ง");
  await expect(usage).not.toContainText("฿0.00");

  if (process.env.SHOT_DIR) {
    await page.goto(videoUrl);
    await page.screenshot({ path: `${process.env.SHOT_DIR}/m5-video.png`, fullPage: true });
    await page.goto("/assets");
    await page.screenshot({ path: `${process.env.SHOT_DIR}/m5-assets.png`, fullPage: true });
  }
});
