/*
 * Backs up the local database and stored files (docs/DEPLOY.md → Backup).
 *
 *   npm run backup                 # → backups/<time>/ : db.dump, files/, manifest.json
 *   npm run backup -- --keep 7     # also deletes all but the 7 newest backups
 *
 * Every backup is test-restored into a scratch database before it is reported as good.
 * BACKUP_DIR changes where backups go — put them on another drive, or copy them off this machine.
 */
import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { storageRoot } from "@/features/video/storage";
import { DB_NAME, DUMP_TABLES, dbContainer, latestMigration, type Manifest, psql, run, tableCounts } from "./lib/local-db";

const BACKUP_ROOT = path.resolve(process.env.BACKUP_DIR || "backups");
const STAMP = /^\d{8}-\d{6}$/;
const VERIFY_DB = "backup_verify";

async function folderSize(dir: string): Promise<{ count: number; bytes: number }> {
  let count = 0;
  let bytes = 0;
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    count++;
    bytes += (await stat(path.join(e.parentPath, e.name))).size;
  }
  return { count, bytes };
}

/** Restores the dump into an empty copy of the schema and returns the row counts it produced. */
function verify(container: string, dumpInContainer: string): Record<string, number> {
  psql(container, "postgres", `drop database if exists ${VERIFY_DB}`);
  psql(container, "postgres", `create database ${VERIFY_DB}`);
  try {
    // Schema only, from the live database: "schema public already exists" is the expected noise.
    run("docker", ["exec", container, "sh", "-c", `pg_dump -U supabase_admin -d ${DB_NAME} --schema-only -n public -n auth -n extensions | psql -q -U supabase_admin -d ${VERIFY_DB} >/dev/null 2>&1`]);
    run("docker", ["exec", container, "pg_restore", "-U", "supabase_admin", "-d", VERIFY_DB, "--data-only", "--disable-triggers", "--single-transaction", "--exit-on-error", dumpInContainer]);
    return tableCounts(container, VERIFY_DB);
  } finally {
    psql(container, "postgres", `drop database if exists ${VERIFY_DB}`);
  }
}

async function prune(keep: number) {
  const dirs = (await readdir(BACKUP_ROOT)).filter((d) => STAMP.test(d) && existsSync(path.join(BACKUP_ROOT, d, "manifest.json"))).sort();
  for (const d of dirs.slice(0, Math.max(0, dirs.length - keep))) {
    await rm(path.join(BACKUP_ROOT, d), { recursive: true, force: true });
    console.log(`ลบ backup เก่า ${d}`);
  }
}

async function main() {
  const keepArg = process.argv.indexOf("--keep");
  const keep = keepArg > -1 ? Number(process.argv[keepArg + 1]) : null;
  if (keep !== null && !(Number.isInteger(keep) && keep >= 1)) throw new Error("--keep ต้องเป็นจำนวนเต็มตั้งแต่ 1");

  const container = dbContainer();
  const now = new Date();
  // Local time, so the folder name matches the clock on this machine.
  const p2 = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`;
  const dir = path.join(BACKUP_ROOT, stamp);
  await mkdir(dir, { recursive: true });
  const tmp = `/tmp/backup-${stamp}.dump`;

  try {
    console.log(`สำรองฐานข้อมูล (${container})…`);
    const migration = latestMigration(container);
    run("docker", ["exec", container, "pg_dump", "-U", "supabase_admin", "-d", DB_NAME, "--data-only", "-Fc", ...DUMP_TABLES, "-f", tmp]);
    run("docker", ["cp", `${container}:${tmp}`, path.join(dir, "db.dump")]);

    console.log("ทดสอบกู้คืนลงฐานข้อมูลชั่วคราว…");
    const tables = verify(container, tmp);

    const files = storageRoot();
    if (existsSync(files)) {
      console.log(`คัดลอกไฟล์จาก ${files}…`);
      await cp(files, path.join(dir, "files"), { recursive: true });
    }
    const filesInfo = existsSync(files) ? await folderSize(path.join(dir, "files")) : { count: 0, bytes: 0 };

    const manifest: Manifest = { created_at: now.toISOString(), migration, tables, files: filesInfo };
    await writeFile(path.join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const rows = Object.values(tables).reduce((a, b) => a + b, 0);
    console.log(`เสร็จ: ${dir}`);
    console.log(`  ${Object.keys(tables).length} ตาราง ${rows.toLocaleString()} แถว (กู้คืนทดสอบผ่าน) · บัญชี ${tables["auth.users"] ?? 0} · ไฟล์ ${filesInfo.count} ไฟล์ ${(filesInfo.bytes / 1024 ** 2).toFixed(1)} MB`);
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    throw e;
  } finally {
    removeInContainer(container, tmp);
  }

  if (keep !== null) await prune(keep);
}

function removeInContainer(container: string, file: string) {
  try {
    run("docker", ["exec", container, "rm", "-f", file]);
  } catch {
    // container gone: nothing to clean
  }
}

main().catch((e) => {
  console.error(`สำรองข้อมูลไม่สำเร็จ: ${(e as Error).message}`);
  process.exit(1);
});
