import { expect, test } from "@playwright/test";

/*
 * Milestone 3 acceptance: facts → storyboard from a template → every claim cites a fact and is
 * checked → approval (locked) → new version. Affiliate disclosure is always present.
 */

const run = Date.now();
test.use({ permissions: ["clipboard-read", "clipboard-write"] });
const today = new Date().toISOString().slice(0, 10);

test("content planning flow", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await page.getByLabel("อีเมล").fill(`e2e-m3-${run}@example.test`);
  await page.getByLabel("รหัสผ่าน").fill("e2e-password-123");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/products/new");
  await page.getByLabel(/ชื่อสินค้า/).fill(`หูฟังไร้สาย M3 ${run}`);
  await page.getByLabel("ราคา (บาท)").fill("590");
  await page.getByLabel("วันที่ได้ข้อมูลราคา/ค่าคอม").fill(today);
  await page.getByRole("button", { name: "บันทึกสินค้า" }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/);
  const productUrl = page.url();

  // Facts.
  await page.getByRole("link", { name: "ข้อเท็จจริง", exact: true }).click();
  for (const [label, value] of [
    ["แบตเตอรี่", "ใช้งานได้ 20 ชั่วโมง"],
    ["การเชื่อมต่อ", "บลูทูธ 5.3"],
  ]) {
    await page.getByLabel(/^หัวข้อ/).fill(label);
    await page.getByLabel(/^รายละเอียด/).fill(value);
    await page.getByRole("button", { name: "เพิ่มข้อเท็จจริง" }).click();
    await expect(page.getByText(value)).toBeVisible();
    if (label === "แบตเตอรี่") await page.getByRole("button", { name: "เพิ่มข้อเท็จจริง" }).click();
  }

  // New content from the product page.
  await page.getByRole("link", { name: "สร้างคอนเทนต์" }).first().click();
  await expect(page.getByLabel(/^สินค้า/)).toHaveValue(/[0-9a-f-]{36}/);
  await expect(page.getByText("ข้อเท็จจริง 2 ข้อ")).toBeVisible();
  await page.getByRole("radio", { name: "รีวิวสั้น" }).check();
  await page.getByRole("button", { name: "สร้างฉบับร่าง" }).click();
  await expect(page).toHaveURL(/\/studio\/[0-9a-f-]{36}$/);
  const studioUrl = page.url();

  // Draft: intro, 2 features, price, CTA. Disclosure present, approval blocked until claims are checked.
  await expect(page.getByRole("heading", { name: /^ฉากที่ \d/ })).toHaveCount(5);
  await expect(page.getByText(/#ได้รับค่าคอมมิชชัน/)).toBeVisible();
  const approve = page.getByRole("button", { name: "อนุมัติสคริปต์" });
  await expect(approve).toBeDisabled();
  await expect(page.getByText(/ยังไม่ได้ตรวจ/).first()).toBeVisible();
  await expect(page.getByLabel(/ข้อความ claim/).first()).toHaveValue("แบตเตอรี่ ใช้งานได้ 20 ชั่วโมง");

  // An edit with an unbacked number → warning (not a block).
  const narration = page.getByLabel("คำพูด (เสียงพากย์)").nth(1);
  await narration.fill("แบตเตอรี่ ใช้งานได้ 20 ชั่วโมง ชาร์จเต็มใน 2 ชั่วโมง");
  await page.getByRole("button", { name: "บันทึกฉาก" }).click();
  await expect(page.getByText(/ตัวเลข 2 ไม่ตรงกับข้อเท็จจริง/)).toBeVisible();
  await narration.fill("แบตเตอรี่ ใช้งานได้ 20 ชั่วโมง");
  await page.getByRole("button", { name: "บันทึกฉาก" }).click();
  await expect(page.getByText(/ตัวเลข 2 ไม่ตรงกับข้อเท็จจริง/)).toHaveCount(0);

  // Check every claim against its fact.
  const confirm = page.getByRole("button", { name: "ตรงกับข้อเท็จจริง" });
  await expect(confirm).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await confirm.and(page.locator(":enabled")).first().click();
    await expect(page.getByText("ตรวจแล้ว", { exact: true })).toHaveCount(i + 1);
  }
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(page.getByText("อนุมัติแล้ว", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("คำพูด (เสียงพากย์)")).toHaveCount(0); // locked, read-only

  // A fact used by a claim cannot be deleted.
  await page.goto(`${productUrl}?tab=facts`);
  await page.getByRole("button", { name: "ลบ แบตเตอรี่" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "ลบ" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("ถูกอ้างอิงใน claim");
  await page.getByRole("button", { name: "ยกเลิก" }).click();

  // New version: draft again, verified claims stay verified because facts didn't change.
  await page.goto(studioUrl);
  await page.getByRole("button", { name: "สร้างเวอร์ชันใหม่เพื่อแก้ไข" }).click();
  await expect(page).not.toHaveURL(studioUrl);
  await expect(page.getByRole("navigation", { name: "เวอร์ชัน" })).toContainText("2");
  await expect(page.getByText("ตรวจแล้ว", { exact: true })).toHaveCount(3);
  await expect(page.getByRole("button", { name: "อนุมัติสคริปต์" })).toBeEnabled();

  // Manual AI help: copy the prompt, paste a reply back → scene marked AI, claims need checking again.
  await page.getByRole("button", { name: "AI ช่วยเขียนฉากที่ 2" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/ต้องการให้ปรับอย่างไร/).fill("เป็นกันเองขึ้น");
  await dialog.getByRole("button", { name: "คัดลอกคำสั่ง" }).click();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt).toContain("[F1] แบตเตอรี่: ใช้งานได้ 20 ชั่วโมง");
  expect(prompt).toContain("เป็นกันเองขึ้น");
  await dialog
    .getByLabel("คำตอบจาก AI")
    .fill(["คำพูด: ฟังเพลงได้ยาวๆ แบตอยู่ได้ถึง 20 ชั่วโมง", "ข้อความบนจอ: แบต 20 ชม.", "ภาพ: ใส่หูฟังเดินในสวน", "CLAIM: แบตอยู่ได้ถึง 20 ชั่วโมง | F1"].join("\n"));
  await expect(dialog.getByText("→ แบตเตอรี่")).toBeVisible();
  await dialog.getByRole("button", { name: "ใช้ข้อความนี้" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("AI เขียน · ต้องตรวจ")).toBeVisible();
  await expect(page.getByLabel("คำพูด (เสียงพากย์)").nth(1)).toHaveValue("ฟังเพลงได้ยาวๆ แบตอยู่ได้ถึง 20 ชั่วโมง");
  await expect(page.getByText("ตรวจแล้ว", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "อนุมัติสคริปต์" })).toBeDisabled();

  // Listed in Content Planner and Script Studio.
  await page.goto("/content");
  await expect(page.getByRole("link", { name: `รีวิวสั้น: หูฟังไร้สาย M3 ${run}` })).toBeVisible();
  await page.goto("/studio");
  await expect(page.getByRole("heading", { name: "ฉบับร่าง (1)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "อนุมัติแล้ว (1)" })).toBeVisible();
});

test("facts pulled from the description stay unconfirmed until checked", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await page.getByLabel("อีเมล").fill(`e2e-m3x-${run}@example.test`);
  await page.getByLabel("รหัสผ่าน").fill("e2e-password-123");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/products/new");
  await page.getByLabel(/ชื่อสินค้า/).fill(`หูฟัง Open Ear M3x ${run}`);
  await page.getByLabel(/ลิงก์สินค้า/).fill(`https://shopee.co.th/product/7/${run}`);
  await page.getByRole("button", { name: "บันทึกสินค้า" }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/);
  await page.getByRole("link", { name: "ข้อเท็จจริง", exact: true }).click();

  await page.getByRole("button", { name: "ดึงจากรายละเอียด" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("1. คำอธิบายสินค้า").fill("หูฟังแบบหนีบหู\n- Bluetooth 6.1\n- กันน้ำ IP55\n- แบตเตอรี่ 7 ชั่วโมง\nเบสหนักที่สุด!!");
  await dialog.getByRole("button", { name: "คัดลอกคำสั่ง" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("Bluetooth 6.1");
  // What an AI chat might answer, including one invented number.
  await dialog.getByLabel("2. วางคำตอบจาก AI").fill("ได้เลยครับ\nFACT: บลูทูธ | Bluetooth 6.1\nFACT: กันน้ำ | IP55\nFACT: แบตเตอรี่ | ใช้ได้ 10 ชั่วโมง");
  await expect(dialog.getByText("ไม่เพิ่ม — ตัวเลข 10 ไม่มีในคำอธิบาย")).toBeVisible();
  await dialog.getByRole("button", { name: "เพิ่ม 2 ข้อ" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await expect(page.getByText("2 ข้อดึงมาโดย AI ยังไม่ได้ยืนยัน")).toBeVisible();
  await expect(page.getByText("AI ประมาณการ")).toHaveCount(2);
  await expect(page.getByText("ใช้ได้ 10 ชั่วโมง")).toHaveCount(0);
  await page.getByRole("button", { name: "ยืนยัน บลูทูธ" }).click();
  await expect(page.getByText("1 ข้อดึงมาโดย AI ยังไม่ได้ยืนยัน")).toBeVisible();
  await page.getByRole("button", { name: "ยืนยัน กันน้ำ" }).click();
  await expect(page.getByText(/ดึงมาโดย AI ยังไม่ได้ยืนยัน/)).toHaveCount(0);
  await expect(page.getByText("AI ประมาณการ")).toHaveCount(0);
});
