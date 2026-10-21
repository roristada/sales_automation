import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";

/*
 * AI-3 (docs/AI_VIDEO_PLAN.md): Video Studio shows "คลิป AI ต่อฉาก" — each scene's visual plan can be
 * switched to an AI clip with a prompt and saved, with the model and estimated cost from the live
 * catalog. Nothing paid is clicked; the worker pipeline is covered by tests/rls/ai-clips.test.ts.
 */

function env(name: string): string {
  if (process.env[name]) return process.env[name]!;
  const m = new RegExp(`^${name}=(.*)$`, "m").exec(readFileSync(".env.local", "utf8"));
  return m?.[1].trim() ?? "";
}
const run = Date.now();
const today = new Date().toISOString().slice(0, 10);

test("plan an AI clip for a scene in Video Studio", async ({ page }) => {
  test.skip(!env("OPENROUTER_API_KEY"), "OPENROUTER_API_KEY not set");
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
});
