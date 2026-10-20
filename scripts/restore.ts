/*
 * Restores a backup made by `npm run backup` (docs/DEPLOY.md → Restore).
 *
 *   npm run restore -- backups/20261021-120000
 *
 * Only into a database with no accounts yet (a fresh local Supabase with the same migrations
 * applied) — it never overwrites or merges into existing data. Stored files are copied back
 * without replacing files that already exist.
 */
import { cp, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { storageRoot } from "@/features/video/storage";
import { DB_NAME, dbContainer, latestMigration, type Manifest, psql, run, tableCounts } from "./lib/local-db";

async function main() {
  const dir = process.argv[2] ? path.resolve(process.argv[2]) : null;
  if (!dir || !existsSync(path.join(dir, "manifest.json"))) throw new Error("ระบุโฟลเดอร์ backup ที่มี manifest.json เช่น npm run restore -- backups/20261021-120000");
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as Manifest;
  const container = dbContainer();

  const users = Number(psql(container, DB_NAME, "select count(*) from auth.users").trim());
  if (users > 0) {
    throw new Error(
      `ฐานข้อมูลปลายทางมีบัญชีอยู่แล้ว ${users} บัญชี — restore ใช้กับฐานข้อมูลว่างเท่านั้นเพื่อไม่ให้ข้อมูลปัจจุบันปนหรือหาย ` +
        "(ดูขั้นตอนใน docs/DEPLOY.md: สำรองข้อมูลปัจจุบันก่อน แล้วจึงล้างฐานข้อมูล)",
    );
  }
  const migration = latestMigration(container);
  if (migration !== manifest.migration) {
    throw new Error(`โครงสร้างฐานข้อมูลไม่ตรงกับ backup (backup: ${manifest.migration}, ปลายทาง: ${migration}) — ใช้ migration ชุดเดียวกับตอนสำรอง`);
  }

  const tmp = "/tmp/restore.dump";
  run("docker", ["cp", path.join(dir, "db.dump"), `${container}:${tmp}`]);
  try {
    console.log("กู้คืนฐานข้อมูล…");
    run("docker", ["exec", container, "pg_restore", "-U", "supabase_admin", "-d", DB_NAME, "--data-only", "--disable-triggers", "--single-transaction", "--exit-on-error", tmp]);
  } finally {
    run("docker", ["exec", container, "rm", "-f", tmp]);
  }

  const counts = tableCounts(container, DB_NAME);
  const diff = Object.entries(manifest.tables).filter(([t, n]) => counts[t] !== n);
  if (diff.length) console.warn(`จำนวนแถวไม่ตรงกับ manifest: ${diff.map(([t, n]) => `${t} ${counts[t]}/${n}`).join(", ")}`);

  if (existsSync(path.join(dir, "files"))) {
    console.log(`คัดลอกไฟล์กลับไปที่ ${storageRoot()}…`);
    await cp(path.join(dir, "files"), storageRoot(), { recursive: true, force: false, errorOnExist: false });
  }
  console.log(`เสร็จ: กู้คืน backup วันที่ ${manifest.created_at} (${manifest.tables["auth.users"] ?? 0} บัญชี)`);
}

main().catch((e) => {
  console.error(`กู้คืนไม่สำเร็จ: ${(e as Error).message}`);
  process.exit(1);
});
