"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/features/products/actions";
import type { Database } from "@/lib/supabase/database.types";
import { getCurrentUser } from "@/lib/supabase/server";
import { type LineError, parseConversionsCsv, parsePostMetricsCsv } from "./csv";
import { publicationKeys } from "./post-key";

type Db = SupabaseClient<Database>;

/** Under the 3 MB server action limit (next.config.ts). */
const MAX_TEXT = 2_500_000;
const CHUNK = 500;

const fileSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  text: z.string().min(1, "ไฟล์ว่าง").max(MAX_TEXT, "ไฟล์ใหญ่เกิน 2.5 MB — แบ่งเป็นหลายไฟล์"),
  // File's last-modified time ≈ the day the numbers were exported.
  fileDate: z.iso.datetime().optional(),
});

export type ImportSummary = { importId: string; total: number; saved: number; matched: number; failed: number; errors: LineError[] };

async function requireUser() {
  const { supabase, user } = await getCurrentUser();
  if (!supabase || !user) throw new Error("ยังไม่ได้เข้าสู่ระบบ");
  return { supabase, user };
}

function withoutLine<T extends { line: number }>(r: T): Omit<T, "line"> {
  const copy: Partial<T> = { ...r };
  delete copy.line;
  return copy as Omit<T, "line">;
}

/** Bangkok calendar day of an instant. */
const bangkokDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(iso));

async function publicationIndex(db: Db) {
  const { data } = await db.from("publications").select("id, external_url, external_id, tracking_code");
  const byKey = new Map<string, string>();
  const byCode = new Map<string, string>();
  for (const p of data ?? []) {
    for (const k of publicationKeys(p)) byKey.set(k, p.id);
    byCode.set(p.tracking_code.toLowerCase(), p.id);
  }
  return { byKey, byCode };
}

async function finishImport(db: Db, importId: string, s: Omit<ImportSummary, "importId">) {
  await db
    .from("performance_imports")
    .update({ total_rows: s.total, saved_rows: s.saved, matched_rows: s.matched, failed_rows: s.failed, errors: s.errors.slice(0, 50) as unknown as Database["public"]["Tables"]["performance_imports"]["Update"]["errors"] })
    .eq("id", importId);
  revalidatePath("/analytics");
  return { importId, ...s };
}

export async function importPostMetrics(input: z.input<typeof fileSchema>): Promise<ActionResult<ImportSummary>> {
  const parsed = fileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const fileDay = bangkokDay(new Date(Math.min(Date.parse(parsed.data.fileDate ?? new Date().toISOString()), Date.now())).toISOString());
  const file = parsePostMetricsCsv(parsed.data.text, fileDay);
  if (!file.ok) return { ok: false, error: file.error };
  if (!file.rows.length) return { ok: false, error: `ไม่มีแถวที่ใช้ได้ — ${file.errors[0] ? `บรรทัด ${file.errors[0].line}: ${file.errors[0].message}` : "ไฟล์ไม่มีข้อมูล"}` };

  const { supabase, user } = await requireUser();
  const { data: imp, error } = await supabase.from("performance_imports").insert({ owner_id: user.id, kind: "post_metrics", file_name: parsed.data.fileName }).select("id").single();
  if (error) return { ok: false, error: `บันทึกไม่สำเร็จ: ${error.message}` };

  const { byKey } = await publicationIndex(supabase);
  let saved = 0;
  let matched = 0;
  const errors = [...file.errors];
  for (let i = 0; i < file.rows.length; i += CHUNK) {
    const chunk = file.rows.slice(i, i + CHUNK);
    const rows = chunk.map((r) => ({ ...withoutLine(r), owner_id: user.id, import_id: imp.id, publication_id: byKey.get(r.post_key) ?? null }));
    const { error: upErr } = await supabase.from("post_metrics").upsert(rows, { onConflict: "owner_id,post_key,captured_on" });
    if (upErr) {
      errors.push({ line: chunk[0].line, message: `บันทึกบรรทัด ${chunk[0].line}–${chunk[chunk.length - 1].line} ไม่สำเร็จ: ${upErr.message}` });
      continue;
    }
    saved += rows.length;
    matched += rows.filter((r) => r.publication_id).length;
  }
  return { ok: true, data: await finishImport(supabase, imp.id, { total: file.total, saved, matched, failed: file.total - saved, errors }) };
}

export async function importConversions(input: z.input<typeof fileSchema>): Promise<ActionResult<ImportSummary>> {
  const parsed = fileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const file = parseConversionsCsv(parsed.data.text);
  if (!file.ok) return { ok: false, error: file.error };
  if (!file.rows.length) return { ok: false, error: `ไม่มีแถวที่ใช้ได้ — ${file.errors[0] ? `บรรทัด ${file.errors[0].line}: ${file.errors[0].message}` : "ไฟล์ไม่มีข้อมูล"}` };

  const { supabase, user } = await requireUser();
  const { data: imp, error } = await supabase.from("performance_imports").insert({ owner_id: user.id, kind: "affiliate_conversions", file_name: parsed.data.fileName }).select("id").single();
  if (error) return { ok: false, error: `บันทึกไม่สำเร็จ: ${error.message}` };

  const { byCode } = await publicationIndex(supabase);
  let saved = 0;
  let matched = 0;
  const errors = [...file.errors];
  for (let i = 0; i < file.rows.length; i += CHUNK) {
    const chunk = file.rows.slice(i, i + CHUNK);
    const rows = chunk.map((r) => ({
      ...withoutLine(r),
      owner_id: user.id,
      import_id: imp.id,
      network: "shopee",
      // Only a tracking code in a Sub_id attributes an order to a video.
      publication_id: r.sub_ids.map((s) => byCode.get(s)).find(Boolean) ?? null,
    }));
    const { error: upErr } = await supabase.from("affiliate_conversions").upsert(rows, { onConflict: "owner_id,network,order_id,item_key" });
    if (upErr) {
      errors.push({ line: chunk[0].line, message: `บันทึกบรรทัด ${chunk[0].line}–${chunk[chunk.length - 1].line} ไม่สำเร็จ: ${upErr.message}` });
      continue;
    }
    saved += rows.length;
    matched += rows.filter((r) => r.publication_id).length;
  }
  return { ok: true, data: await finishImport(supabase, imp.id, { total: file.total, saved, matched, failed: file.total - saved, errors }) };
}

/** Deletes an import and the rows it saved. Rows a later import updated move with that import. */
export async function deletePerformanceImport(id: string): Promise<ActionResult<null>> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "รหัสไม่ถูกต้อง" };
  const { supabase } = await requireUser();
  const { error, count } = await supabase.from("performance_imports").delete({ count: "exact" }).eq("id", id);
  if (error) return { ok: false, error: `ลบไม่สำเร็จ: ${error.message}` };
  if (!count) return { ok: false, error: "ไม่พบข้อมูล หรือไม่มีสิทธิ์ลบ" };
  revalidatePath("/analytics");
  return { ok: true, data: null };
}

/**
 * Matches rows that had no publication yet (e.g. numbers imported before the post URL was
 * recorded). Already-matched rows are left alone.
 */
export async function rematchPerformance(): Promise<ActionResult<{ metrics: number; conversions: number }>> {
  const { supabase } = await requireUser();
  const result = await rematch(supabase);
  revalidatePath("/analytics");
  return { ok: true, data: result };
}

async function rematch(db: Db) {
  const { byKey, byCode } = await publicationIndex(db);
  let metrics = 0;
  let conversions = 0;
  const { data: m } = await db.from("post_metrics").select("id, post_key").is("publication_id", null).limit(20_000);
  const metricGroups = new Map<string, string[]>();
  for (const r of m ?? []) {
    const pub = byKey.get(r.post_key);
    if (pub) metricGroups.set(pub, [...(metricGroups.get(pub) ?? []), r.id]);
  }
  for (const [pub, ids] of metricGroups) {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { error } = await db.from("post_metrics").update({ publication_id: pub }).in("id", ids.slice(i, i + CHUNK));
      if (!error) metrics += Math.min(CHUNK, ids.length - i);
    }
  }
  const { data: c } = await db.from("affiliate_conversions").select("id, sub_ids").is("publication_id", null).limit(20_000);
  const convGroups = new Map<string, string[]>();
  for (const r of c ?? []) {
    const pub = r.sub_ids.map((s) => byCode.get(s.toLowerCase())).find(Boolean);
    if (pub) convGroups.set(pub, [...(convGroups.get(pub) ?? []), r.id]);
  }
  for (const [pub, ids] of convGroups) {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { error } = await db.from("affiliate_conversions").update({ publication_id: pub }).in("id", ids.slice(i, i + CHUNK));
      if (!error) conversions += Math.min(CHUNK, ids.length - i);
    }
  }
  return { metrics, conversions };
}
