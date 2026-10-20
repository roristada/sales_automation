import { expect, test } from "@playwright/test";

/* Mobile shell + no horizontal page scroll on core screens (design.md §12). */

test.use({ viewport: { width: 390, height: 844 } });

test("mobile navigation and layout", async ({ page }) => {
  const email = `e2e-mobile-${Date.now()}@example.test`;
  await page.goto("/login");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await page.getByLabel("อีเมล").fill(email);
  await page.getByLabel("รหัสผ่าน").fill("e2e-password-123");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // Desktop sidebar hidden; drawer opens and navigates.
  await page.getByRole("button", { name: "เปิดเมนู" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("เร็วๆ นี้").first()).toBeVisible();
  await drawer.getByRole("link", { name: "ค้นหาสินค้า" }).click();
  await expect(page).toHaveURL(/\/research/);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  for (const path of ["/dashboard", "/research", "/research/sources", "/research/trends", "/content", "/content/new", "/studio", "/videos", "/assets", "/products", "/products/new", "/products/import", "/settings"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} scrolls horizontally`).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `test-results/mobile${path.replace(/\//g, "_")}.png`, fullPage: true });
  }
});
