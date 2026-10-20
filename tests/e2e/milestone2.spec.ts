import { expect, test } from "@playwright/test";

/*
 * Milestone 2 acceptance: Opportunity Score is computed from real fields only, shown with
 * confidence, sortable on /research, and explained (components, missing data, limitations).
 */

const run = Date.now();
const email = `e2e-m2-${run}@example.test`;
const password = "e2e-password-123";

async function addProduct(page: import("@playwright/test").Page, fields: [RegExp | string, string][]) {
  await page.goto("/products/new");
  for (const [label, value] of fields) await page.getByLabel(label).fill(value);
  await page.getByRole("button", { name: "บันทึกสินค้า" }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/);
}

test("opportunity score", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await page.getByLabel("อีเมล").fill(email);
  await page.getByLabel("รหัสผ่าน").fill(password);
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // price ฿500 × 10% → ฿50/sale (68), rate 75, price fit 80, readiness 50 (affiliate link only) → 68
  await addProduct(page, [
    [/ชื่อสินค้า/, `ไฟฉาย E2E ${run}`],
    ["ราคา (บาท)", "500"],
    ["อัตราค่าคอม (%)", "10"],
    ["ลิงก์ Affiliate", `https://s.shopee.co.th/e2e${run}`],
  ]);
  await addProduct(page, [
    [/ชื่อสินค้า/, `กระติก E2E ${run}`],
    ["ราคา (บาท)", "300"],
  ]);

  await page.goto("/research?sort=score");
  const rows = page.locator("tbody tr");
  await expect(rows.first()).toContainText(`ไฟฉาย E2E ${run}`);
  await expect(rows.first().locator("td").nth(1)).toContainText(/^68/);
  await expect(rows.first()).toContainText("ความเชื่อมั่นสูง");
  // No commission data → no score, never a guessed number.
  await expect(rows.filter({ hasText: `กระติก E2E ${run}` })).toContainText("ข้อมูลไม่พอ");
  await expect(page.getByText(/ยังไม่มีคะแนน/)).toHaveCount(0);

  // Explanation on the product page.
  await rows.first().getByTitle("ดูที่มาของคะแนน").click();
  await expect(page).toHaveURL(/tab=score/);
  await expect(page.getByRole("heading", { name: "องค์ประกอบของคะแนน" })).toBeVisible();
  await expect(page.getByText("คำนวณจากราคา ฿500 × 10%")).toBeVisible();
  await expect(page.getByText(/ยังไม่มีรูปภาพ, รายละเอียดสินค้า/)).toBeVisible();
  await expect(page.getByText(/ไม่ใช่การคาดการณ์ยอดขาย/)).toBeVisible();

  // Editing updates the score: adding image + description makes readiness 100 → 78.
  await page.getByRole("link", { name: "แก้ไขข้อมูล" }).click();
  await page.getByText("รายละเอียดเพิ่มเติม").click();
  await page.getByLabel("ลิงก์รูปภาพ").fill("https://example.com/torch.jpg");
  await page.getByLabel("รายละเอียดสินค้า").fill("ไฟฉาย LED ชาร์จได้");
  await page.getByRole("button", { name: "บันทึกการแก้ไข" }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/);
  await page.goto("/research?sort=score");
  await expect(page.locator("tbody tr").first().locator("td").nth(1)).toContainText(/^78/);
});

test("freshness export → re-import, and trend signals", async ({ page }) => {
  const r = Date.now();
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  await page.goto("/login");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await page.getByLabel("อีเมล").fill(`e2e-m2b-${r}@example.test`);
  await page.getByLabel("รหัสผ่าน").fill(password);
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // A manual product (no URL) with 30-day-old price data → stale.
  await addProduct(page, [
    [/ชื่อสินค้า/, `หม้อทอด E2E ${r}`],
    ["ราคา (บาท)", "1290"],
    ["อัตราค่าคอม (%)", "6"],
    ["วันที่ได้ข้อมูลราคา/ค่าคอม", day(-30)],
  ]);
  const productUrl = page.url();

  await page.goto("/research/sources");
  await expect(page.getByText("ยังไม่รองรับ").first()).toBeVisible(); // Shopee/TikTok honest status
  const staleRow = page.getByRole("row").filter({ hasText: "กรอกเอง" });
  await expect(staleRow.getByRole("cell").nth(3)).toHaveText("1");

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "ส่งออก CSV" }).click()]);
  const exported = (await (await download.createReadStream()).toArray()).join("");
  expect(exported).toContain("System ID");
  expect(exported).toContain(`หม้อทอด E2E ${r}`);

  // Edit price + Retrieved in the "spreadsheet", then re-import in update mode.
  const lines = exported.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const header = lines[0].split(",");
  const cells = lines[1].split(",");
  cells[header.indexOf("Price")] = "1190";
  cells[header.indexOf("Retrieved")] = day(0);
  const edited = [lines[0], cells.join(",")].join("\n");
  await page.goto("/products/import?mode=update");
  await page.getByLabel(/ไฟล์ CSV/).setInputFiles({ name: "refresh.csv", mimeType: "text/csv", buffer: Buffer.from(edited) });
  await expect(page.getByLabel(/รหัสในระบบ/)).toHaveValue("System ID");
  await page.getByRole("button", { name: /นำเข้า 1 แถว/ }).click();
  await expect(page.getByText("นำเข้าเสร็จแล้ว")).toBeVisible();
  await expect(page.locator("dl > div").filter({ has: page.getByText("อัปเดต", { exact: true }) }).locator("dd")).toHaveText("1");
  await expect(page.locator("dl > div").filter({ has: page.getByText("เพิ่มใหม่", { exact: true }) }).locator("dd")).toHaveText("0");

  await page.goto(productUrl);
  await expect(page.locator("dl > div").filter({ hasText: /^ราคา/ })).toContainText("1,190");
  await expect(page.getByText(/เก่ากว่า 14 วัน/)).toHaveCount(0);

  // Trends: import a Google Trends export, then link it to the product.
  const weeks = Array.from({ length: 10 }, (_, i) => day(-7 * (10 - i) - 7));
  const values = [20, 22, 21, 20, 30, 33, 35, 36, 38, 40];
  const trendsCsv = `Category: All categories\n\nWeek,หม้อทอดไร้น้ำมัน ${r}: (Thailand)\n${weeks.map((w, i) => `${w},${values[i]}`).join("\n")}\n`;
  await page.goto("/research/trends");
  await expect(page.getByText("ยังไม่มีข้อมูลเทรนด์")).toBeVisible();
  await page.locator("#trend-file").setInputFiles({ name: "multiTimeline.csv", mimeType: "text/csv", buffer: Buffer.from(trendsCsv) });
  const trendRow = page.getByRole("row").filter({ hasText: `หม้อทอดไร้น้ำมัน ${r}` });
  await expect(trendRow).toContainText("กำลังขึ้น");
  await expect(trendRow).toContainText("40");

  // A bad file is rejected with reasons, nothing stored.
  await page.locator("#trend-file").setInputFiles({ name: "bad.csv", mimeType: "text/csv", buffer: Buffer.from("Week,x\n2026-01-01,abc\n") });
  await expect(page.getByText("ไฟล์นี้ไม่ใช่ไฟล์ Google Trends ที่อ่านได้")).toBeVisible();

  await page.goto(`${productUrl}?tab=trends`);
  await page.getByLabel("คีย์เวิร์ดเทรนด์ของสินค้านี้").selectOption(`หม้อทอดไร้น้ำมัน ${r}`);
  await page.getByRole("button", { name: "บันทึก" }).click();
  await expect(page.getByRole("heading", { name: `หม้อทอดไร้น้ำมัน ${r}` })).toBeVisible();
  await expect(page.getByRole("img", { name: /ความสนใจตามช่วงเวลา 10 ช่วง/ })).toBeVisible();
  // Hover layer: crosshair tooltip on pointer and on keyboard focus.
  const chart = page.getByRole("img", { name: /ความสนใจตามช่วงเวลา/ });
  await chart.scrollIntoViewIfNeeded();
  await chart.hover({ position: { x: 200, y: 60 } });
  await expect(page.getByRole("status").filter({ hasText: "/ 100" })).toBeVisible();
  await page.mouse.move(0, 0);
  await chart.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("status").filter({ hasText: "/ 100" })).toContainText("38");
  await page.getByText("ดูเป็นตาราง").click();
  await expect(page.getByRole("table", { name: /ความสนใจตามช่วงเวลา/ }).locator("tbody tr")).toHaveCount(10);
});
