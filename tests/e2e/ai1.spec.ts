import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

/*
 * AI-1 acceptance (docs/AI_VIDEO_PLAN.md): Settings shows the real OpenRouter status, lets you pick
 * a model per task from the live catalog, and saves the per-video cap. Doesn't press the paid
 * "ทดสอบเรียก AI จริง" button — that one is run by hand.
 */

test("AI settings: status, model per task from the catalog, per-video cap", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await page.getByLabel("อีเมล").fill(`e2e-ai1-${Date.now()}@example.test`);
  await page.getByLabel("รหัสผ่าน").fill("e2e-password-123");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/settings");
  const ai = page.getByRole("region", { name: "AI (OpenRouter)" });
  const configured = !!process.env.OPENROUTER_API_KEY || /^OPENROUTER_API_KEY=.+/m.test(readFileSync(".env.local", "utf8"));
  await expect(ai.getByText(configured ? /เชื่อมต่อแล้ว|เชื่อมต่อไม่ได้/ : "ยังไม่ได้ตั้งค่า").first()).toBeVisible();
  await expect(ai.getByRole("button", { name: /ทดสอบเรียก AI จริง/ })).toBeEnabled({ enabled: configured });
  await expect(ai.getByText("ยังไม่มีการเรียก AI")).toBeVisible();

  // Defaults are preselected; the catalog lists real alternatives.
  const script = ai.getByLabel("เขียนสคริปต์");
  await expect(script).toHaveValue("deepseek/deepseek-v4.1-flash");
  expect(await script.locator("option").count()).toBeGreaterThan(5);
  await expect(ai.getByLabel("คลิปสินค้าเคลื่อนไหว")).toHaveValue("kwaivgi/kling-v3.0-std");

  await script.selectOption("anthropic/claude-haiku-5.5");
  await ai.getByLabel("เพดานต่อวิดีโอ (บาท)").fill("120");
  await ai.getByRole("button", { name: "บันทึกการตั้งค่า AI" }).click();
  await expect(ai.getByText("บันทึกการตั้งค่า AI แล้ว")).toBeVisible();

  await page.reload();
  await expect(ai.getByLabel("เขียนสคริปต์")).toHaveValue("anthropic/claude-haiku-5.5");
  await expect(ai.getByLabel("เพดานต่อวิดีโอ (บาท)")).toHaveValue("120");

  // Bad threshold → field error, nothing saved.
  await ai.getByLabel("ยืนยันก่อนเมื่องานเดียวเกิน (บาท)").fill("-1");
  await ai.getByRole("button", { name: "บันทึกการตั้งค่า AI" }).click();
  await expect(ai.getByText("ต้องไม่ติดลบ")).toBeVisible();
});
