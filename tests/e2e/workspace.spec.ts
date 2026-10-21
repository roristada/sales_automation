import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";

/*
 * Video workspace: one page per video. New content opens here; product photos, this video's
 * AI picks, facts, the script with each scene's visual under it and render are all on it, the
 * step rail shows each step's state and the bottom bar names the next thing to do. Nothing paid
 * is clicked.
 */

function env(name: string): string {
  if (process.env[name]) return process.env[name]!;
  const m = new RegExp(`^${name}=(.*)$`, "m").exec(readFileSync(".env.local", "utf8"));
  return m?.[1].trim() ?? "";
}
const run = Date.now();
const today = new Date().toISOString().slice(0, 10);

test("one page per video: photos, settings, facts, script + visuals, render", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/login");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await page.getByLabel("อีเมล").fill(`e2e-ws-${run}@example.test`);
  await page.getByLabel("รหัสผ่าน").fill("e2e-password-123");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/products/new");
  await page.getByLabel(/ชื่อสินค้า/).fill(`ลำโพง WS ${run}`);
  await page.getByLabel("ราคา (บาท)").fill("890");
  await page.getByLabel("วันที่ได้ข้อมูลราคา/ค่าคอม").fill(today);
  await page.getByRole("button", { name: "บันทึกสินค้า" }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/);
  await page.getByRole("link", { name: "สร้างคอนเทนต์" }).first().click();
  await page.getByRole("radio", { name: "รีวิวสั้น" }).check();
  await page.getByRole("button", { name: "สร้างฉบับร่าง" }).click();

  // New content opens in the workspace.
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]{36}$/);
  const storyboardId = page.url().split("/").pop()!;
  const steps = page.getByRole("navigation", { name: "ขั้นตอน" });
  await expect(steps.getByRole("link")).toHaveCount(5);
  await expect(steps.getByText("ยังไม่มีรูปหลัก — คลิป AI แบบสินค้าเคลื่อนไหวต้องใช้")).toBeVisible();
  await expect(page.getByText(/ขั้นถัดไป:/)).toBeVisible();
  await expect(page.getByText("เพิ่มข้อเท็จจริงของสินค้า (ให้ AI ดึงจากคำอธิบายได้)")).toBeVisible();

  // 1. Photos, with the thumbnail-link fix.
  await page.getByLabel("ลิงก์รูปหลัก").fill("https://down-th.img.susercontent.com/file/abc@resize_w450_nl.webp");
  await expect(page.getByText(/บางลิงก์เป็นรูปย่อ/)).toBeVisible();
  await page.getByRole("button", { name: "ใช้รูปขนาดเต็ม" }).click();
  await expect(page.getByLabel("ลิงก์รูปหลัก")).toHaveValue("https://down-th.img.susercontent.com/file/abc");
  await page.getByRole("button", { name: "บันทึกรูป" }).click();
  await expect(page.getByText("บันทึกรูปสินค้าแล้ว")).toBeVisible();
  await expect(steps.getByText("มีรูปหลัก")).toBeVisible();

  // 2. This video's AI picks (default from Settings), saved and kept.
  if (env("OPENROUTER_API_KEY")) {
    const clipModel = page.getByLabel("คลิปสินค้าเคลื่อนไหว");
    await expect(clipModel).toHaveValue("");
    await expect(clipModel.locator("option").first()).toHaveText("ค่าเริ่มต้น (kwaivgi/kling-v3.0-std)");
    await clipModel.selectOption("google/veo-3.1-lite");
    await page.getByRole("button", { name: "บันทึกการตั้งค่าของวิดีโอนี้" }).click();
    await expect(page.getByText("บันทึกการตั้งค่าของวิดีโอนี้แล้ว")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("คลิปสินค้าเคลื่อนไหว")).toHaveValue("google/veo-3.1-lite");
  }

  // 3. Facts on the same page.
  await expect(page.getByRole("region", { name: "3. ข้อเท็จจริง" }).getByRole("button", { name: /เพิ่มข้อเท็จจริง/ }).first()).toBeVisible();

  // 4. Each scene card: script on top, its visual underneath.
  const sceneCards = page.getByRole("region", { name: "4. สคริปต์ & ภาพต่อฉาก" }).locator("li[id^='scene-']");
  await expect(sceneCards).toHaveCount(3);
  const card = sceneCards.first();
  await expect(card.getByRole("heading", { name: "ฉากที่ 1" })).toBeVisible();
  await expect(card.getByLabel("คำพูด (เสียงพากย์)")).toBeVisible();
  await expect(card.getByRole("heading", { name: "คลิป AI & ทรานซิชัน" })).toBeVisible();
  // One summary line; the details sit behind "ปรับเอง".
  await expect(card.getByText("รูปสินค้า + motion graphics (ฟรี)")).toBeVisible();
  await expect(card.getByLabel("ภาพของฉากนี้")).toBeHidden();
  await card.getByRole("button", { name: "ใช้คลิป AI ในฉากนี้" }).click();
  await expect(card.getByLabel("ภาพของฉากนี้")).toHaveValue("ai_video");
  // The create button is always there, with the reason it can't be pressed yet.
  await expect(card.getByRole("button", { name: "สร้างคลิป AI" })).toBeDisabled();
  await expect(card.getByText("อนุมัติสคริปต์ก่อน จึงจะสร้างคลิปได้")).toBeVisible();
  if (env("OPENROUTER_API_KEY")) await expect(card.getByLabel("โมเดลวิดีโอ").locator("option").first()).toHaveText("ตามหน้าตั้งค่า (google/veo-3.1-lite)");

  // The cost card is on the page from the start.
  const costCard = page.getByRole("region", { name: "ค่าใช้จ่ายวิดีโอนี้" });
  await expect(costCard.getByText("จ่ายแล้ว")).toBeVisible();
  await expect(costCard.getByText("ฟรี", { exact: true })).toBeVisible();

  // 5. After approval: one click arranges the visuals ("ประหยัด" = no AI clips, free) and the
  // render controls are here too.
  const admin = createClient<Database>(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  expect((await admin.from("storyboards").update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", storyboardId)).error).toBeNull();
  await page.reload();
  if (env("OPENROUTER_API_KEY")) {
    await page.getByRole("radio", { name: /ประหยัด/ }).check();
    await page.getByRole("button", { name: "บันทึกการตั้งค่าของวิดีโอนี้" }).click();
    await expect(page.getByText("บันทึกการตั้งค่าของวิดีโอนี้แล้ว")).toBeVisible();
    await expect(page.getByText(/ระดับภาพ: ประหยัด/)).toBeVisible();
    await page.getByRole("button", { name: "จัดภาพให้อัตโนมัติ" }).click();
    await expect(page.getByText("จัดภาพแล้ว — ทุกฉากใช้รูปสินค้า (ฟรี)")).toBeVisible();
    const { data: plans } = await admin.from("scene_visual_plans").select("mode").eq("storyboard_id", storyboardId);
    expect(plans?.map((p) => p.mode)).toEqual(["product_motion", "product_motion", "product_motion"]);
  }
  await expect(page.getByRole("region", { name: "5. Render & เผยแพร่" }).getByRole("button", { name: "Render วิดีโอ" })).toBeVisible();
  await expect(page.getByRole("link", { name: "ไปที่ Render" })).toHaveAttribute("href", "#render");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: "test-results/workspace.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/workspace-mobile.png", fullPage: false });
  // Phone width: nothing pushes the page sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
