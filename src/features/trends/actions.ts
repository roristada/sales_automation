"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/features/products/actions";
import { getCurrentUser } from "@/lib/supabase/server";
import { parseGoogleTrendsCsv } from "./google-trends-csv";

async function requireUser() {
  const { supabase, user } = await getCurrentUser();
  if (!supabase || !user) throw new Error("ยังไม่ได้เข้าสู่ระบบ");
  return { supabase, user };
}

/** Trend exports are a few KB; this keeps well under the server action body limit. */
const MAX_TEXT = 500_000;

const importSchema = z.object({
  fileName: z.string().min(1).max(255),
  text: z.string().min(1).max(MAX_TEXT, "ไฟล์ใหญ่เกินไปสำหรับไฟล์เทรนด์"),
  // File's last-modified time ≈ when it was downloaded from Google Trends.
  fileDate: z.iso.datetime(),
});

export async function importTrendCsv(input: z.input<typeof importSchema>): Promise<ActionResult<{ importId: string; keywords: string[] }> | { ok: false; error: string; details: string[] }> {
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const result = parseGoogleTrendsCsv(parsed.data.text);
  if (!result.ok) return { ok: false, error: "ไฟล์นี้ไม่ใช่ไฟล์ Google Trends ที่อ่านได้", details: result.errors };

  const { supabase, user } = await requireUser();
  const t = result.data;
  // A file date in the future (clock skew) is clamped to now.
  const retrievedAt = new Date(Math.min(Date.parse(parsed.data.fileDate), Date.now())).toISOString();
  const { data: imp, error } = await supabase
    .from("trend_imports")
    .insert({
      owner_id: user.id,
      source: "google_trends_csv",
      file_name: parsed.data.fileName,
      category: t.category,
      granularity: t.granularity,
      period_start: t.periodStart,
      period_end: t.periodEnd,
      keywords: t.series.map((s) => s.keyword),
      point_count: t.series[0].points.length,
      retrieved_at: retrievedAt,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: `บันทึกไม่สำเร็จ: ${error.message}` };

  const rows = t.series.flatMap((s) =>
    s.points.map((p) => ({ import_id: imp.id, owner_id: user.id, keyword: s.keyword, region: s.region, period_start: p.periodStart, value: p.value, below_one: p.belowOne })),
  );
  const { error: obsError } = await supabase.from("trend_observations").insert(rows);
  if (obsError) {
    // Don't leave an import without its data.
    await supabase.from("trend_imports").delete().eq("id", imp.id);
    return { ok: false, error: `บันทึกข้อมูลเทรนด์ไม่สำเร็จ: ${obsError.message}` };
  }
  revalidatePath("/research/trends");
  return { ok: true, data: { importId: imp.id, keywords: t.series.map((s) => s.keyword) } };
}

export async function deleteTrendImport(id: string): Promise<ActionResult<null>> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "รหัสไม่ถูกต้อง" };
  const { supabase } = await requireUser();
  const { error, count } = await supabase.from("trend_imports").delete({ count: "exact" }).eq("id", id);
  if (error) return { ok: false, error: `ลบไม่สำเร็จ: ${error.message}` };
  if (!count) return { ok: false, error: "ไม่พบข้อมูล หรือไม่มีสิทธิ์ลบ" };
  revalidatePath("/research/trends");
  return { ok: true, data: null };
}

/** Links a product to a trend keyword (empty keyword unlinks). */
export async function setProductTrendKeyword(productId: string, keyword: string): Promise<ActionResult<null>> {
  if (!z.uuid().safeParse(productId).success) return { ok: false, error: "รหัสสินค้าไม่ถูกต้อง" };
  const kw = keyword.trim().slice(0, 200);
  const { supabase, user } = await requireUser();
  const { error } = kw
    ? await supabase.from("product_trend_links").upsert({ product_id: productId, owner_id: user.id, keyword: kw }, { onConflict: "product_id" })
    : await supabase.from("product_trend_links").delete().eq("product_id", productId);
  if (error) return { ok: false, error: `บันทึกไม่สำเร็จ: ${error.message}` };
  revalidatePath(`/products/${productId}`);
  return { ok: true, data: null };
}
