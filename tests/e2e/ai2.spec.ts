import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

/*
 * AI-2 acceptance (docs/AI_VIDEO_PLAN.md): with OpenRouter configured, fact extraction, each scene
 * and the whole script offer a direct AI call next to copy/paste. By default nothing is clicked
 * that costs money. With E2E_PAID=1 the whole-script call runs for real (≈ ฿0.02): preview →
 * apply → every scene marked AI and every claim pending → the call and its cost appear in Settings.
 */

const configured = !!process.env.OPENROUTER_API_KEY || /^OPENROUTER_API_KEY=.+/m.test(readFileSync(".env.local", "utf8"));
const paid = process.env.E2E_PAID === "1";
const run = Date.now();
const today = new Date().toISOString().slice(0, 10);

test("AI buttons call the API directly; whole-script draft is previewed, applied as AI text with pending claims", async ({ page }) => {
  test.skip(!configured, "OPENROUTER_API_KEY not set");
  test.setTimeout(paid ? 180_000 : 60_000);

  await page.goto("/login");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await page.getByLabel("อีเมล").fill(`e2e-ai2-${run}@example.test`);
  await page.getByLabel("รหัสผ่าน").fill("e2e-password-123");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/products/new");
  await page.getByLabel(/ชื่อสินค้า/).fill(`ลำโพงพกพา AI2 ${run}`);
  await page.getByLabel("ราคา (บาท)").fill("890");
  await page.getByLabel("วันที่ได้ข้อมูลราคา/ค่าคอม").fill(today);
  await page.getByRole("button", { name: "บันทึกสินค้า" }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/);

  await page.getByRole("link", { name: "ข้อเท็จจริง", exact: true }).click();
  for (const [label, value] of [
    ["แบตเตอรี่", "ใช้งานได้ 12 ชั่วโมง"],
    ["กันน้ำ", "มาตรฐาน IPX7"],
  ]) {
    await page.getByLabel(/^หัวข้อ/).fill(label);
    await page.getByLabel(/^รายละเอียด/).fill(value);
    await page.getByRole("button", { name: "เพิ่มข้อเท็จจริง" }).click();
    await expect(page.getByText(value)).toBeVisible();
    if (label === "แบตเตอรี่") await page.getByRole("button", { name: "เพิ่มข้อเท็จจริง" }).click();
  }

  // Fact extraction: direct call offered beside copy/paste.
  await page.getByRole("button", { name: "ดึงจากรายละเอียด" }).click();
  const extract = page.getByRole("dialog");
  await expect(extract.getByRole("button", { name: "ให้ AI ดึงเลย" })).toBeVisible();
  await expect(extract.getByRole("button", { name: "คัดลอกคำสั่ง" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: "สร้างคอนเทนต์" }).first().click();
  await page.getByRole("radio", { name: "รีวิวสั้น" }).check();
  await page.getByRole("button", { name: "สร้างฉบับร่าง" }).click();
  // New content opens in the video workspace; this test drives Script Studio itself.
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]{36}$/);
  await page.goto(page.url().replace("/workspace/", "/studio/"));
  const scenes = page.getByRole("heading", { name: /^ฉากที่ \d/ });
  const sceneCount = await scenes.count();

  // Per-scene help: direct call offered beside copy/paste.
  await page.getByRole("button", { name: "AI ช่วยเขียนฉากที่ 1" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "ให้ AI เขียนเลย" })).toBeVisible();
  await page.keyboard.press("Escape");

  const whole = page.getByRole("button", { name: "ให้ AI เขียนทั้งสคริปต์" });
  await expect(whole).toBeEnabled();
  if (!paid) return;

  // Real call: draft → preview → apply.
  await whole.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "เขียนเลย" }).click();
  const preview = dialog.getByLabel("ตัวอย่างสคริปต์จาก AI");
  await expect(preview).toBeVisible({ timeout: 150_000 });
  await expect(preview.getByText(/^ฉากที่ \d/)).toHaveCount(sceneCount);
  await expect(preview.getByText(/ค่าใช้จ่ายครั้งนี้ ฿/)).toBeVisible();
  await dialog.getByRole("button", { name: "ใช้สคริปต์นี้" }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByText("AI เขียน · ต้องตรวจ")).toHaveCount(sceneCount);
  await expect(page.getByText(/#ได้รับค่าคอมมิชชัน/)).toBeVisible();
  await expect(page.getByRole("button", { name: "อนุมัติสคริปต์" })).toBeDisabled();

  await page.goto("/settings");
  const ai = page.getByRole("region", { name: "AI (OpenRouter)" });
  await expect(ai.getByText(/^เขียนสคริปต์ · /)).toBeVisible();
  await expect(ai.getByText(/^฿0\.\d+/).first()).toBeVisible();
});
