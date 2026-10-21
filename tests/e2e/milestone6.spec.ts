import { spawn } from "node:child_process";
import { expect, test } from "@playwright/test";

/*
 * Milestone 6 acceptance: rendered video → prepare publication (export pack + caption with
 * disclosure) → posted by hand → record post URL → no double posting → withdraw → post again.
 * No platform API is connected, so nothing is posted automatically.
 */

const run = Date.now();
const today = new Date().toISOString().slice(0, 10);
const DISCLOSURE = "#ได้รับค่าคอมมิชชัน";

function runWorker(): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", "worker/render-worker.ts", "--drain"], { env: process.env, shell: process.platform === "win32" });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`worker exited ${code}\n${out}`))));
  });
}

test("prepare, record and withdraw a manual publication", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/login");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await page.getByLabel("อีเมล").fill(`e2e-m6-${run}@example.test`);
  await page.getByLabel("รหัสผ่าน").fill("e2e-password-123");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // Platforms are honestly "not connected"; nothing to publish yet.
  await page.getByRole("link", { name: "เผยแพร่" }).first().click();
  await expect(page).toHaveURL(/\/publishing$/);
  await expect(page.getByText("ยังไม่เชื่อมต่อ")).toHaveCount(3);
  await expect(page.getByText("ยังไม่มีรายการเผยแพร่")).toBeVisible();

  const affiliate = `https://s.shopee.co.th/m6${run}`;
  await page.goto("/products/new");
  await page.getByLabel(/ชื่อสินค้า/).fill(`กระบอกน้ำ M6 ${run}`);
  await page.getByLabel("ลิงก์ Affiliate").fill(affiliate);
  await page.getByLabel("ราคา (บาท)").fill("199");
  await page.getByLabel("วันที่ได้ข้อมูลราคา/ค่าคอม").fill(today);
  await page.getByRole("button", { name: "บันทึกสินค้า" }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/);
  await page.getByRole("link", { name: "ข้อเท็จจริง", exact: true }).click();
  await page.getByLabel(/^หัวข้อ/).fill("ความจุ");
  await page.getByLabel(/^รายละเอียด/).fill("500 มล.");
  await page.getByRole("button", { name: "เพิ่มข้อเท็จจริง" }).click();
  await expect(page.getByText("500 มล.")).toBeVisible();

  await page.getByRole("link", { name: "สร้างคอนเทนต์" }).first().click();
  await page.getByRole("radio", { name: "แจ้งราคา" }).check();
  await page.getByLabel("ความยาวเป้าหมาย").selectOption("15");
  await page.getByRole("button", { name: "สร้างฉบับร่าง" }).click();
  // New content opens in the video workspace; this test drives Script Studio itself.
  await expect(page).toHaveURL(/\/workspace\//);
  await page.goto(page.url().replace("/workspace/", "/studio/"));
  const confirm = page.getByRole("button", { name: "ตรงกับข้อเท็จจริง" });
  const n = await confirm.count();
  for (let i = 0; i < n; i++) {
    await confirm.and(page.locator(":enabled")).first().click();
    await expect(page.getByText("ตรวจแล้ว", { exact: true })).toHaveCount(i + 1);
  }
  await page.getByRole("button", { name: "อนุมัติสคริปต์" }).click();
  await page.getByRole("link", { name: "ไปทำวิดีโอ" }).click();
  await expect(page).toHaveURL(/\/videos\/[0-9a-f-]{36}$/);
  const videoUrl = page.url();
  await expect(page.getByRole("heading", { name: "เผยแพร่" })).toHaveCount(0); // no video yet

  await page.getByRole("button", { name: "Render วิดีโอ" }).click();
  await runWorker();
  await expect(page.locator('video[src*="/api/renders/"]')).toBeVisible({ timeout: 120_000 });

  // Rendered but not prepared → listed as ready.
  await page.goto("/publishing");
  await expect(page.getByRole("table", { name: "วิดีโอที่พร้อมเผยแพร่" })).toContainText(`กระบอกน้ำ M6 ${run}`);

  // Prepare for the project's platform (TikTok).
  await page.goto(videoUrl);
  await expect(page.getByLabel("แพลตฟอร์ม")).toHaveValue("tiktok");
  await page.getByRole("button", { name: "เตรียมเผยแพร่" }).click();
  await expect(page).toHaveURL(/\/publishing\/[0-9a-f-]{36}$/);
  const pubUrl = page.url();
  await expect(page.getByText("เตรียมไว้ ยังไม่โพสต์").first()).toBeVisible();

  // Export pack: video downloads; caption has the disclosure; TikTok caption has no link
  // (not clickable there), the link is offered separately.
  const mp4 = await page.request.get((await page.getByRole("link", { name: "วิดีโอ (MP4)" }).getAttribute("href"))!);
  expect(mp4.status()).toBe(200);
  expect(mp4.headers()["content-disposition"]).toContain("-tiktok.mp4");
  const caption = page.getByRole("textbox", { name: "แคปชัน" });
  await expect(caption).toHaveValue(new RegExp(DISCLOSURE));
  expect(await caption.inputValue()).not.toContain(affiliate);
  await expect(page.getByLabel(/^ลิงก์ affiliate/)).toHaveValue(affiliate);
  await expect(page.getByRole("button", { name: "คัดลอกแคปชัน" })).toBeVisible();

  // The disclosure can't be removed.
  await caption.fill("แคปชันไม่มีการเปิดเผย");
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.getByText("ต้องคงข้อความเปิดเผย affiliate ไว้ในแคปชัน")).toBeVisible();
  await caption.fill(`กระบอกน้ำเก็บความเย็น\n\n${DISCLOSURE} ลิงก์ในคลิปเป็นลิงก์ affiliate ผู้ทำคลิปอาจได้รับค่าคอมมิชชันเมื่อมีการซื้อผ่านลิงก์`);
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.getByText("บันทึกแล้ว")).toBeVisible();

  // Schedule (reminder only).
  await page.getByLabel("วันเวลาที่จะโพสต์").fill("2030-01-01T10:00");
  await page.getByRole("button", { name: "ตั้งเวลา" }).click();
  await expect(page.getByText("ตั้งเวลาไว้ (โพสต์เอง)").first()).toBeVisible();

  // Record the post: a link from another platform is refused, a TikTok link is accepted.
  const postUrl = page.getByLabel(/^ลิงก์โพสต์บน TikTok/);
  await postUrl.fill("https://youtube.com/shorts/abc");
  await page.getByRole("button", { name: "บันทึกว่าเผยแพร่แล้ว" }).click();
  await expect(page.getByText(/ไม่ใช่ลิงก์ของ TikTok/)).toBeVisible();
  await postUrl.fill(`https://www.tiktok.com/@e2e/video/${run}`);
  await page.getByRole("button", { name: "บันทึกว่าเผยแพร่แล้ว" }).click();
  await expect(page.getByText("เผยแพร่แล้ว").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "เปิดโพสต์" })).toHaveAttribute("href", `https://www.tiktok.com/@e2e/video/${run}`);
  await expect(caption).toHaveAttribute("readonly", "");
  await expect(page.getByRole("button", { name: "ลบรายการ" })).toHaveCount(0);

  // No double posting: preparing TikTok again opens the same record; the next free platform is suggested.
  await page.goto(videoUrl);
  await expect(page.getByLabel("แพลตฟอร์ม")).toHaveValue("reels");
  await page.getByLabel("แพลตฟอร์ม").selectOption("tiktok");
  await page.getByRole("button", { name: "เตรียมเผยแพร่" }).click();
  await expect(page).toHaveURL(pubUrl);

  // Withdraw → kept as history; the content can be prepared for TikTok again.
  await page.getByRole("button", { name: "บันทึกว่าลบโพสต์แล้ว" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "บันทึกว่าลบแล้ว" }).click();
  await expect(page.getByText("ลบโพสต์แล้ว").first()).toBeVisible();
  await page.goto(videoUrl);
  await page.getByLabel("แพลตฟอร์ม").selectOption("tiktok");
  await page.getByRole("button", { name: "เตรียมเผยแพร่" }).click();
  await expect(page).toHaveURL(/\/publishing\/[0-9a-f-]{36}$/);
  expect(page.url()).not.toBe(pubUrl);

  // The unposted one can be deleted; the list keeps the withdrawn history.
  await page.getByRole("button", { name: "ลบรายการ" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "ลบรายการ" }).click();
  await expect(page).toHaveURL(/\/publishing$/);
  const list = page.getByRole("table", { name: "รายการเผยแพร่" });
  await expect(list.locator("tbody tr")).toHaveCount(1);
  await expect(list).toContainText("ลบโพสต์แล้ว");

  if (process.env.SHOT_DIR) {
    await page.goto(pubUrl);
    await page.screenshot({ path: `${process.env.SHOT_DIR}/publish-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${process.env.SHOT_DIR}/publish-mobile.png`, fullPage: true });
  }
});
