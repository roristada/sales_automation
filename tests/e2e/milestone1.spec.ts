import { expect, test } from "@playwright/test";

/*
 * Milestone 1 acceptance flow against local Supabase:
 * login → manual product → duplicate detection → CSV import (skip, then update) → edit → delete → logout.
 */

const run = Date.now();
const email = `e2e-${run}@example.test`;
const password = "e2e-password-123";
const productUrl = `https://shopee.co.th/product/1/${run}`;

const csv = [
  "Product Name,Item ID,Price,Commission Rate,Product Link,Source,Retrieved",
  `เคสโทรศัพท์ E2E,${run}01,"฿199",8,https://shopee.co.th/product/2/${run},shopee,2026-10-19`,
  `สายชาร์จ E2E,${run}02,,,https://shopee.co.th/product/3/${run},shopee,`,
  `ราคาผิด E2E,${run}03,abc,5,https://shopee.co.th/product/4/${run},shopee,`,
  `ซ้ำกับสินค้าที่กรอกเอง,${run}04,500,10,${productUrl}?utm_source=x,shopee,`,
].join("\n");

async function importCsv(page: import("@playwright/test").Page, mode: "skip" | "update") {
  await page.goto("/products/import");
  await page.getByLabel(/ไฟล์ CSV/).setInputFiles({ name: `e2e-${mode}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByText("4 แถว, 7 คอลัมน์")).toBeVisible();
  // Auto-mapping should have picked the obvious columns.
  await expect(page.getByLabel(/ชื่อสินค้า \(Product name\)/)).toHaveValue("Product Name");
  await expect(page.getByLabel(/ราคา \(Price\)/)).toHaveValue("Price");
  if (mode === "update") await page.getByLabel(/อัปเดตด้วยค่าจากไฟล์/).check();
  await page.getByRole("button", { name: /นำเข้า 4 แถว/ }).click();
  await expect(page.getByText("นำเข้าเสร็จแล้ว")).toBeVisible();
}

const stat = (page: import("@playwright/test").Page, label: string) =>
  page.locator("dl > div").filter({ has: page.getByText(label, { exact: true }) }).locator("dd");

test("milestone 1 flow", async ({ page }) => {
  // Protected route redirects to login.
  await page.goto("/products");
  await expect(page).toHaveURL(/\/login\?next=%2Fproducts/);

  // Sign up (local Supabase has email confirmation off).
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await page.getByLabel("อีเมล").fill(email);
  await page.getByLabel("รหัสผ่าน").fill(password);
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText("เริ่มจากเพิ่มสินค้าชุดแรก")).toBeVisible();

  // Manual product with unknown price: stored as unavailable, not 0.
  await page.goto("/products/new");
  await page.getByLabel(/ชื่อสินค้า/).fill("หูฟังไร้สาย E2E");
  await page.getByLabel("ลิงก์สินค้า").fill(productUrl);
  await page.getByLabel("อัตราค่าคอม (%)").fill("12");
  await page.getByRole("button", { name: "บันทึกสินค้า" }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/);
  const priceRow = page.locator("dl > div").filter({ hasText: /^ราคา/ });
  await expect(priceRow).toContainText("ไม่มีข้อมูล");
  await expect(page.locator("dl > div").filter({ hasText: "อัตราค่าคอม" })).toContainText("12%");

  // Validation error and duplicate detection on manual entry.
  await page.goto("/products/new");
  await page.getByLabel(/ชื่อสินค้า/).fill("ซ้ำ");
  await page.getByLabel("ลิงก์สินค้า").fill(`${productUrl}/?ref=dup`);
  await page.getByLabel("ราคา (บาท)").fill("-1");
  await page.getByRole("button", { name: "บันทึกสินค้า" }).click();
  await expect(page.getByText("ราคา ต้องไม่ติดลบ")).toBeVisible();
  await page.getByLabel("ราคา (บาท)").fill("");
  await page.getByRole("button", { name: "บันทึกสินค้า" }).click();
  await expect(page.getByText("มีสินค้าที่ใช้ลิงก์สินค้านี้อยู่แล้ว")).toBeVisible();

  // CSV import, duplicates skipped.
  await importCsv(page, "skip");
  await expect(stat(page, "เพิ่มใหม่")).toHaveText("2");
  await expect(stat(page, "ซ้ำ (ข้าม)")).toHaveText("1");
  await expect(stat(page, "ผิดพลาด")).toHaveText("1");
  await page.getByRole("link", { name: /ดูรายละเอียด/ }).click();
  await expect(page.getByText("ราคา ต้องเป็นตัวเลข")).toBeVisible();

  // Re-import with update mode: existing rows are updated, invalid row still rejected.
  await importCsv(page, "update");
  await expect(stat(page, "อัปเดต")).toHaveText("3");
  await expect(stat(page, "เพิ่มใหม่")).toHaveText("0");
  await expect(stat(page, "ผิดพลาด")).toHaveText("1");

  // Product research shows source and data-status labels; filters work.
  await page.goto("/research?source=csv");
  await expect(page.getByRole("link", { name: "เคสโทรศัพท์ E2E" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "สายชาร์จ E2E" })).toContainText("ไม่มีข้อมูล");
  await page.goto("/research?missing=price");
  await expect(page.getByRole("link", { name: "สายชาร์จ E2E" })).toBeVisible();
  await expect(page.getByRole("link", { name: "เคสโทรศัพท์ E2E" })).toHaveCount(0);

  // The manual product was updated from CSV (update mode overwrites with file values, incl. name).
  await page.goto("/products");
  await page.getByRole("link", { name: "ซ้ำกับสินค้าที่กรอกเอง", exact: true }).click();
  const priceFact = page.locator("dl > div").filter({ hasText: /^ราคา/ });
  await expect(priceFact).toContainText("นำเข้า CSV");
  await page.getByRole("link", { name: "แหล่งข้อมูลและประวัติ" }).click();
  await expect(page.getByRole("heading", { name: "ประวัติราคาและค่าคอม" })).toBeVisible();
  await expect(page.locator("table").filter({ has: page.locator("caption", { hasText: "ประวัติราคาและค่าคอม" }) }).locator("tbody tr")).toHaveCount(2);

  // Edit marks the changed field as user-provided.
  await page.getByRole("link", { name: "แก้ไขข้อมูล" }).click();
  await page.getByLabel("ราคา (บาท)").fill("450");
  await page.getByRole("button", { name: "บันทึกการแก้ไข" }).click();
  await expect(priceFact).toContainText("450");
  await expect(priceFact).toContainText("ผู้ใช้กรอก");

  // Dashboard reflects the data.
  await page.goto("/dashboard");
  await expect(page.getByText("สินค้าทั้งหมด")).toBeVisible();
  await expect(page.getByText(/e2e-update\.csv/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "สินค้าที่ต้องอัปเดตข้อมูล" })).toBeVisible();

  // Delete through the confirmation dialog (cancel first, then confirm).
  await page.goto("/products");
  await page.getByRole("link", { name: "สายชาร์จ E2E", exact: true }).click();
  await page.getByRole("button", { name: "ลบ" }).click();
  await page.getByRole("button", { name: "ยกเลิก" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await page.getByRole("button", { name: "ลบ" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "ลบสินค้า" }).click();
  await expect(page).toHaveURL(/\/products$/);
  await expect(page.getByRole("link", { name: "สายชาร์จ E2E" })).toHaveCount(0);

  // Settings shows provider status without secrets.
  await page.goto("/settings");
  await expect(page.getByText("เสียงพากย์ (TTS)")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("eyJhbGci");

  // Sign out.
  await page.getByRole("button", { name: "ออกจากระบบ" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});
