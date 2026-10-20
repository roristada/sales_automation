import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";

/*
 * Milestone 8 acceptance: security headers on every response; /api/health is public, says only
 * up/down and follows the worker heartbeat; Settings shows worker, queue and disk status.
 */

function env(name: string): string {
  if (process.env[name]) return process.env[name]!;
  const m = new RegExp(`^${name}=(.*)$`, "m").exec(readFileSync(".env.local", "utf8"));
  if (!m) throw new Error(`${name} missing in .env.local`);
  return m[1].trim();
}

test("security headers, health check and system status", async ({ page, request }) => {
  const res = await request.get("/login");
  const h = res.headers();
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["x-powered-by"]).toBeUndefined();

  // Other API routes still need a session; health doesn't, and leaks nothing but up/down.
  expect((await request.get("/api/assets")).status()).toBe(401);
  const admin = createClient<Database>(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const workerId = `e2e-m8-${Date.now()}`;
  // Other specs may run a real worker in parallel, so "offline" can't be forced: check that the
  // answer is consistent, then that a live heartbeat turns it online.
  let health = await request.get("/api/health?worker=required");
  let body = await health.json();
  expect(Object.keys(body).sort()).toEqual(["db", "status", "worker"]);
  expect(body.db).toBe("up");
  expect(["online", "offline"]).toContain(body.worker);
  expect(health.status()).toBe(body.worker === "online" ? 200 : 503);
  expect((await request.get("/api/health")).status()).toBe(200);

  await page.goto("/login");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await page.getByLabel("อีเมล").fill(`e2e-m8-${Date.now()}@example.test`);
  await page.getByLabel("รหัสผ่าน").fill("e2e-password-123");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/settings");
  const status = page.getByRole("region", { name: "สถานะระบบ" });
  await expect(status).toContainText(/ทำงานอยู่|npm run worker/);
  await expect(status).toContainText("รอคิว 0 · กำลังทำ 0");
  await expect(status).toContainText(/ว่าง [\d.,]+ (GB|TB)/);

  // A live heartbeat flips both to online.
  await admin.from("worker_heartbeats").insert({ worker_id: workerId, busy: false });
  try {
    health = await request.get("/api/health?worker=required");
    body = await health.json();
    expect(health.status()).toBe(200);
    expect(body).toEqual({ status: "ok", db: "up", worker: "online" });
    await page.reload();
    await expect(status).toContainText(/ทำงานอยู่ · (ว่าง|กำลัง render)/);
    await expect(status).toContainText(/ส่งสัญญาณล่าสุด \d+ วินาทีที่แล้ว/);
  } finally {
    await admin.from("worker_heartbeats").delete().eq("worker_id", workerId);
  }
});
