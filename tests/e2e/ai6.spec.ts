import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";

/*
 * AI-6 (docs/AI_VIDEO_PLAN.md): "สร้างหลายวิดีโอ" drafts one script per product, each waits for
 * review in Script Studio, approved ones are queued for render together, and Analytics has the
 * real-cost-per-video section. The AI-writing branch is paid and runs only with E2E_PAID=1.
 */

function env(name: string): string {
  if (process.env[name]) return process.env[name]!;
  const m = new RegExp(`^${name}=(.*)$`, "m").exec(readFileSync(".env.local", "utf8"));
  return m?.[1].trim() ?? "";
}
const run = Date.now();
const today = new Date().toISOString().slice(0, 10);

async function addProduct(page: Page, name: string) {
  await page.goto("/products/new");
  await page.getByLabel(/ชื่อสินค้า/).fill(name);
  await page.getByLabel("ราคา (บาท)").fill("990");
  await page.getByLabel("วันที่ได้ข้อมูลราคา/ค่าคอม").fill(today);
  await page.getByRole("button", { name: "บันทึกสินค้า" }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/);
}

test("batch: draft several scripts, review each, render the approved ones", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/login");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await page.getByLabel("อีเมล").fill(`e2e-ai6-${run}@example.test`);
  await page.getByLabel("รหัสผ่าน").fill("e2e-password-123");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await addProduct(page, `ลำโพง AI6 ${run}`);
  await addProduct(page, `หูฟัง AI6 ${run}`);

  await page.goto("/content");
  await page.getByRole("link", { name: "สร้างหลายวิดีโอ" }).click();
  await expect(page.getByText("ยังไม่มีชุดงาน")).toBeVisible();
  await page.getByRole("link", { name: "ชุดใหม่" }).first().click();
  const products = page.getByRole("list", { name: "สินค้า" });
  await products.getByLabel(new RegExp(`ลำโพง AI6 ${run}`)).check();
  await products.getByLabel(new RegExp(`หูฟัง AI6 ${run}`)).check();
  await page.getByLabel("รูปแบบคอนเทนต์").selectOption({ label: "รีวิวสั้น" });
  const ai = page.getByRole("checkbox", { name: /ให้ AI เขียนสคริปต์ทุกงาน/ });
  if (await ai.isChecked()) await ai.uncheck();
  await page.getByRole("button", { name: "สร้าง 2 วิดีโอ" }).click();
  await expect(page).toHaveURL(/\/content\/batch\/[0-9a-f-]{36}\?start=1$/);
  const batchUrl = page.url().replace(/\?start=1$/, "");

  // Both are drafted from the template, one after the other, and wait for review.
  const items = page.getByRole("list", { name: "งานในชุด" }).getByRole("listitem");
  await expect(items).toHaveCount(2);
  await expect(items.filter({ hasText: "ร่างจาก template แล้ว" })).toHaveCount(2, { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "ทำครบทุกงานแล้ว" })).toBeDisabled();
  await expect(items.getByRole("link", { name: "ตรวจใน Studio" })).toHaveCount(2);
  await expect(page.getByRole("button", { name: /Render \(0 งานที่อนุมัติ\)/ })).toBeDisabled();

  // Approve one (claim review is covered by M3), then render the approved ones together.
  const href = await items.first().getByRole("link", { name: "ตรวจใน Studio" }).getAttribute("href");
  const storyboardId = href!.split("/").pop()!;
  const admin = createClient<Database>(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  expect((await admin.from("storyboards").update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", storyboardId)).error).toBeNull();
  await page.goto(batchUrl);
  await expect(page.getByText("อนุมัติแล้ว 1/2")).toBeVisible();
  await expect(items.first().getByRole("link", { name: "Video Studio" })).toBeVisible();
  await page.getByRole("button", { name: /Render \(1 งานที่อนุมัติ\)/ }).click();
  await expect(page.getByText("เข้าคิว render 1 วิดีโอ")).toBeVisible();
  await expect(items.first().getByText(/รอ render/)).toBeVisible();
  // Already queued → not queued twice.
  await page.getByRole("button", { name: /Render \(1 งานที่อนุมัติ\)/ }).click();
  await expect(page.getByText("ยังไม่มีสคริปต์ที่อนุมัติแล้วและยังไม่ได้ render")).toBeVisible();
  await admin.from("render_jobs").update({ status: "canceled" }).eq("storyboard_id", storyboardId);

  await page.goto("/content/batch");
  await expect(page.getByRole("table", { name: "ชุดงาน" }).getByText("1/2")).toBeVisible();

  await page.goto("/analytics");
  await expect(page.getByRole("heading", { name: "ค่าใช้จ่ายจริงต่อวิดีโอ" })).toBeVisible();
});

test("batch with AI writes each script (paid, E2E_PAID=1)", async ({ page }) => {
  test.skip(process.env.E2E_PAID !== "1" || !env("OPENROUTER_API_KEY"), "paid: set E2E_PAID=1");
  test.setTimeout(240_000);
  await page.goto("/login");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await page.getByLabel("อีเมล").fill(`e2e-ai6p-${run}@example.test`);
  await page.getByLabel("รหัสผ่าน").fill("e2e-password-123");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await addProduct(page, `พัดลม AI6 ${run}`);
  await page.goto("/content/batch/new");
  await page.getByRole("list", { name: "สินค้า" }).getByLabel(new RegExp(`พัดลม AI6 ${run}`)).check();
  await page.getByLabel("รูปแบบคอนเทนต์").selectOption({ label: "รีวิวสั้น" });
  await page.getByLabel(/งบ AI ของชุดนี้/).fill("2");
  await page.getByRole("button", { name: "สร้าง 1 วิดีโอ" }).click();
  const item = page.getByRole("list", { name: "งานในชุด" }).getByRole("listitem");
  await expect(item.getByText("AI เขียนแล้ว")).toBeVisible({ timeout: 180_000 });
  await expect(item.getByText(/฿0\.\d+/)).toBeVisible();
});
