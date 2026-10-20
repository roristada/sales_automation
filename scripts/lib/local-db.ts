/*
 * Shared by backup.ts / restore.ts: talks to the local Supabase Postgres through its Docker
 * container (pg_dump/pg_restore of the same version as the server live there).
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export function dbContainer(): string {
  if (process.env.SUPABASE_DB_CONTAINER) return process.env.SUPABASE_DB_CONTAINER;
  const id = /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync("supabase/config.toml", "utf8"))?.[1];
  if (!id) throw new Error("หา project_id ใน supabase/config.toml ไม่เจอ — ตั้ง SUPABASE_DB_CONTAINER");
  return `supabase_db_${id}`;
}

/** The app's database inside the container; another name only for trying a restore on a copy. */
export const DB_NAME = process.env.SUPABASE_DB_NAME || "postgres";

/** Runs a command and returns stdout; throws with stderr on failure. */
export function run(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`${cmd}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 4).join(" ")} … ล้มเหลว (exit ${r.status})\n${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

/** psql as the local superuser; returns unaligned, tuples-only output. */
export function psql(container: string, database: string, sql: string): string {
  return run("docker", ["exec", container, "psql", "-U", "supabase_admin", "-d", database, "-v", "ON_ERROR_STOP=1", "-Atc", sql]);
}

/** What a backup holds: every public table plus the accounts that own the rows. */
export const DUMP_TABLES = ["--table=public.*", "--table=auth.users", "--table=auth.identities"];

/** Exact row count of each backed-up table, as { "public.products": 12, … }. */
export function tableCounts(container: string, database: string): Record<string, number> {
  const out = psql(
    container,
    database,
    `select table_schema || '.' || table_name || '|' ||
            (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
       from information_schema.tables
      where table_type = 'BASE TABLE'
        and (table_schema = 'public' or (table_schema = 'auth' and table_name in ('users', 'identities')))
      order by 1`,
  );
  return Object.fromEntries(
    out
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => {
        const [t, n] = l.split("|");
        return [t, Number(n)];
      }),
  );
}

/** Latest migration applied to the local database (e.g. "20261028000000"). */
export function latestMigration(container: string): string {
  return psql(container, DB_NAME, "select max(version) from supabase_migrations.schema_migrations").trim();
}

export interface Manifest {
  created_at: string;
  migration: string;
  tables: Record<string, number>;
  files: { count: number; bytes: number };
}
