import { spawn } from "node:child_process";
import { expect, test } from "@playwright/test";

/*
 * Milestone 7 acceptance: published video → import post metrics (matched by post URL) and a
 * Shopee conversion report (attributed only by the video's tracking code in Sub_id) →
 * attributed commission is shown apart from totals, cost per video, re-import updates orders.
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

const csv = (name: string, lines: string[]) => ({ name, mimeType: "text/csv", buffer: Buffer.from(`﻿${lines.join("\n")}`, "utf8") });

test("import results and attribute commission to a video", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/login");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await page.getByLabel("อีเมล").fill(`e2e-m7-${run}@example.test`);
  await page.getByLabel("รหัสผ่าน").fill("e2e-password-123");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // Nothing imported: no invented numbers.
  await page.getByRole("link", { name: "Analytics" }).first().click();
  await expect(page).toHaveURL(/\/analytics$/);
  await expect(page.getByText("ยังไม่มีรายงาน Conversion")).toBeVisible();
  await expect(page.getByText("ยังไม่มีวิดีโอที่เผยแพร่")).toBeVisible();

  await page.goto("/products/new");
  await page.getByLabel(/ชื่อสินค้า/).fill(`ร่มพับ M7 ${run}`);
  await page.getByLabel("ราคา (บาท)").fill("149");
  await page.getByLabel("วันที่ได้ข้อมูลราคา/ค่าคอม").fill(today);
  await page.getByRole("button", { name: "บันทึกสินค้า" }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/);
  await page.getByRole("link", { name: "ข้อเท็จจริง", exact: true }).click();
  await page.getByLabel(/^หัวข้อ/).fill("น้ำหนัก");
  await page.getByLabel(/^รายละเอียด/).fill("250 กรัม");
  await page.getByRole("button", { name: "เพิ่มข้อเท็จจริง" }).click();
  await expect(page.getByText("250 กรัม")).toBeVisible();

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
  await page.getByRole("button", { name: "Render วิดีโอ" }).click();
  await runWorker();
  await expect(page.locator('video[src*="/api/renders/"]')).toBeVisible({ timeout: 120_000 });

  await page.getByRole("button", { name: "เตรียมเผยแพร่" }).click();
  await expect(page).toHaveURL(/\/publishing\/[0-9a-f-]{36}$/);
  const code = (await page.locator("code").first().textContent())!.trim();
  expect(code).toMatch(/^sa[0-9a-f]{10}$/);
  await expect(page.getByRole("region", { name: "การติดตามผล" })).toContainText("ไม่มีข้อมูล");
  const postId = `73${run}`;
  await page.getByLabel(/^ลิงก์โพสต์บน TikTok/).fill(`https://www.tiktok.com/@e2e/video/${postId}`);
  await page.getByRole("button", { name: "บันทึกว่าเผยแพร่แล้ว" }).click();
  await expect(page.getByRole("link", { name: "เปิดโพสต์" })).toBeVisible();

  // Post metrics: our post is matched by URL; someone else's post is counted as unmatched.
  await page.goto("/analytics");
  await page.getByLabel(/ไฟล์ CSV ผลโพสต์/).setInputFiles(
    csv("tiktok.csv", [
      "Video link,Video views,Likes,Comments,Shares,Average watch time",
      `https://www.tiktok.com/@e2e/video/${postId}?lang=th,"1,500",120,8,5,0:07`,
      "https://www.tiktok.com/@e2e/video/1,999,1,1,1,0:01",
      "not-a-link,abc,1,1,1,1",
    ]),
  );
  await expect(page.getByText(/บันทึก 2 จาก 3 แถว · จับคู่กับวิดีโอในระบบ 1 แถว · ข้าม 1 แถว/)).toBeVisible();
  const videos = page.getByRole("table", { name: "ผลรายวิดีโอ" });
  await expect(videos).toContainText("1,500");
  await expect(videos).not.toContainText("999");
  await expect(page.getByText("1 โพสต์ในไฟล์ไม่ตรงกับวิดีโอในระบบ")).toBeVisible();

  // Conversions: only the order with our code is attributed; the other counts in totals only.
  await page.getByLabel(/ไฟล์ CSV รายงาน Conversion/).setInputFiles(
    csv("shopee.csv", [
      "Order id,Order Status,Purchase Time,Item id,Item Name,Purchase Value(฿),Net Commission(฿),Sub_id1",
      `A${run},Completed,${today} 10:00:00,1,ร่มพับ,149,12.50,${code.toUpperCase()}`,
      `B${run},Pending,${today} 11:00:00,1,ร่มพับ,149,12.50,${code}`,
      `C${run},Completed,${today} 12:00:00,2,อื่นๆ,300,30.00,`,
    ]),
  );
  await expect(page.getByText(/บันทึก 3 จาก 3 แถว · จับคู่กับวิดีโอในระบบ 2 แถว/)).toBeVisible();
  const stat = (label: string) => page.locator("dl > div").filter({ has: page.getByText(label, { exact: true }) }).locator("dd").first();
  await expect(stat("ค่าคอมยืนยันแล้ว (ทั้งหมดในรายงาน)")).toHaveText("฿42.50");
  await expect(stat("มาจากวิดีโอในระบบ")).toHaveText("฿12.50");
  await expect(stat("ไม่ระบุวิดีโอ")).toHaveText("฿30.00");
  await expect(stat("รอยืนยัน")).toHaveText("฿12.50");
  const row = videos.locator("tbody tr").first();
  await expect(row).toContainText("฿12.50");
  await expect(row).toContainText("1 รายการ · รอ ฿12.50");
  // Render cost (video seconds × 0.05 ฿/s from playwright.config) and net = confirmed − cost.
  const cost = Number((await row.locator("td").nth(7).textContent())!.replace(/[^\d.]/g, ""));
  expect(cost).toBeGreaterThan(0.5);
  await expect(row.locator("td").nth(8)).toHaveText(`฿${(12.5 - cost).toFixed(2)}`);

  // A later report updates the pending order instead of adding a duplicate.
  await page.getByLabel(/ไฟล์ CSV รายงาน Conversion/).setInputFiles(
    csv("shopee-later.csv", ["Order id,Order Status,Item id,Net Commission(฿),Sub_id1", `B${run},Completed,1,12.50,${code}`]),
  );
  await expect(page.getByText(/บันทึก 1 จาก 1 แถว/)).toBeVisible();
  await expect(stat("มาจากวิดีโอในระบบ")).toHaveText("฿25.00");
  await expect(stat("รอยืนยัน")).toHaveText("฿0.00");

  // The publication page shows the same attributed results.
  await row.getByRole("link").first().click();
  const results = page.getByRole("region", { name: "การติดตามผล" });
  await expect(results).toContainText("1,500");
  await expect(results).toContainText("฿25.00");
  await expect(results).toContainText("ยืนยัน 2 · รอ 0 · ยกเลิก 0");

  // Deleting the metrics import removes its numbers.
  await page.goto("/analytics");
  const imports = page.getByRole("table", { name: "ไฟล์ที่นำเข้า" });
  await imports.locator("tr", { hasText: "tiktok.csv" }).getByRole("button", { name: "ลบ" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "ลบ" }).click();
  await expect(imports).not.toContainText("tiktok.csv");
  await expect(videos).not.toContainText("1,500");

  if (process.env.SHOT_DIR) {
    await page.screenshot({ path: `${process.env.SHOT_DIR}/analytics-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${process.env.SHOT_DIR}/analytics-mobile.png`, fullPage: true });
  }
});
