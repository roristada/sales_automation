"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { refreshOpportunityScores } from "@/features/research/scores";
import { SOURCE_ADAPTERS } from "@/features/sources/registry";
import { getCurrentUser } from "@/lib/supabase/server";
import type { Json, TablesInsert, TablesUpdate } from "@/lib/supabase/database.types";

type JsonValue = NonNullable<Json>;
import { type ColumnMapping, CSV_FIELDS, IMPORT_CHUNK_SIZE, MAX_IMPORT_ROWS, mapRow, type RowError, validateMapping } from "./csv";
import { type ProductInput, productInputSchema, type Provenance, provenanceFor, TRACKED_FIELDS, urlKey } from "./schema";

export interface ProductFormState {
  error?: string;
  fieldErrors?: Partial<Record<keyof ProductInput, string>>;
  duplicateOf?: string;
  /** Submitted values, so the form keeps what the user typed after an error. */
  values?: Record<string, string>;
}

function formToObject(formData: FormData) {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

function fieldErrorsOf(error: z.ZodError): ProductFormState["fieldErrors"] {
  const fe: ProductFormState["fieldErrors"] = {};
  for (const i of error.issues) {
    const k = i.path[0] as keyof ProductInput;
    fe[k] ??= i.message;
  }
  return fe;
}

async function requireUser() {
  const { supabase, user } = await getCurrentUser();
  if (!supabase || !user) throw new Error("ยังไม่ได้เข้าสู่ระบบ");
  return { supabase, user };
}

/** Looks for an existing product with the same normalised URL. */
async function findDuplicateByUrl(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], key: string | null, exceptId?: string) {
  if (!key) return null;
  let q = supabase.from("products").select("id").eq("url_key", key).limit(1);
  if (exceptId) q = q.neq("id", exceptId);
  const { data } = await q.maybeSingle();
  return data?.id ?? null;
}

export async function createProduct(_prev: ProductFormState, formData: FormData): Promise<ProductFormState> {
  const raw = formToObject(formData);
  const parsed = productInputSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values: raw };
  const { supabase, user } = await requireUser();

  const input = parsed.data;
  const key = urlKey(input.product_url);
  const dup = await findDuplicateByUrl(supabase, key);
  if (dup) return { error: "มีสินค้าที่ใช้ลิงก์สินค้านี้อยู่แล้ว", duplicateOf: dup, values: raw };

  const row: TablesInsert<"products"> = {
    ...input,
    owner_id: user.id,
    source: "manual",
    url_key: key,
    provenance: provenanceFor(input, SOURCE_ADAPTERS.manual.provenance) as JsonValue,
  };
  const { data, error } = await supabase.from("products").insert(row).select("id").single();
  if (error) return { error: `บันทึกไม่สำเร็จ: ${error.message}`, values: raw };
  // A failed score write is not fatal: the product is saved and /research offers to recompute.
  await refreshOpportunityScores(supabase, [data.id]);

  revalidatePath("/products");
  redirect(`/products/${data.id}`);
}

export async function updateProduct(id: string, _prev: ProductFormState, formData: FormData): Promise<ProductFormState> {
  const raw = formToObject(formData);
  const parsed = productInputSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values: raw };
  const { supabase } = await requireUser();

  const { data: existing, error: readError } = await supabase.from("products").select("*").eq("id", id).maybeSingle();
  if (readError || !existing) return { error: "ไม่พบสินค้า หรือไม่มีสิทธิ์แก้ไข" };

  const input = parsed.data;
  const key = urlKey(input.product_url);
  const dup = await findDuplicateByUrl(supabase, key, id);
  if (dup) return { error: "มีสินค้าอื่นที่ใช้ลิงก์สินค้านี้อยู่แล้ว", duplicateOf: dup, values: raw };

  // Fields the user changed become user_provided; untouched fields keep their original status.
  const provenance: Provenance = { ...((existing.provenance ?? {}) as Provenance) };
  for (const f of TRACKED_FIELDS) {
    const next = input[f];
    const prev = existing[f];
    if (next === null) delete provenance[f];
    else if (String(next) !== String(prev ?? "")) provenance[f] = "user_provided";
  }

  const patch: TablesUpdate<"products"> = { ...input, url_key: key, provenance: provenance as JsonValue };
  const { error } = await supabase.from("products").update(patch).eq("id", id);
  if (error) return { error: `บันทึกไม่สำเร็จ: ${error.message}`, values: raw };
  await refreshOpportunityScores(supabase, [id]);

  revalidatePath("/products");
  revalidatePath(`/products/${id}`);
  redirect(`/products/${id}`);
}

export async function deleteProduct(id: string): Promise<ActionResult<null>> {
  const { supabase } = await requireUser();
  const { error, count } = await supabase.from("products").delete({ count: "exact" }).eq("id", id);
  if (error) return { ok: false, error: `ลบไม่สำเร็จ: ${error.message}` };
  if (!count) return { ok: false, error: "ไม่พบสินค้า หรือไม่มีสิทธิ์ลบ" };
  revalidatePath("/products");
  revalidatePath("/dashboard");
  return { ok: true, data: null };
}

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------

const mappingSchema = z.partialRecord(z.enum(CSV_FIELDS.map((f) => f.key) as [string, ...string[]]), z.string().min(1));

const startImportSchema = z.object({
  fileName: z.string().min(1).max(255),
  totalRows: z.number().int().min(1).max(MAX_IMPORT_ROWS),
  duplicateMode: z.enum(["skip", "update"]),
  mapping: mappingSchema,
});

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function startImport(input: z.input<typeof startImportSchema>): Promise<ActionResult<{ batchId: string }>> {
  const parsed = startImportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const mappingError = validateMapping(parsed.data.mapping as ColumnMapping);
  if (mappingError) return { ok: false, error: mappingError };

  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("import_batches")
    .insert({
      owner_id: user.id,
      file_name: parsed.data.fileName,
      duplicate_mode: parsed.data.duplicateMode,
      column_mapping: parsed.data.mapping as JsonValue,
      total_rows: parsed.data.totalRows,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: `เริ่มนำเข้าไม่สำเร็จ: ${error.message}` };
  return { ok: true, data: { batchId: data.id } };
}

const chunkSchema = z.object({
  batchId: z.uuid(),
  firstRowNumber: z.number().int().min(1),
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(IMPORT_CHUNK_SIZE),
});

export interface ChunkResult {
  inserted: number;
  updated: number;
  duplicates: number;
  failed: number;
}

type ProductRow = TablesInsert<"products">;

/**
 * Imports one chunk of raw CSV rows into a batch. Duplicates are matched by System ID (from an
 * export) first, then (csv source, source_product_id), then normalised product URL.
 */
export async function importChunk(input: z.input<typeof chunkSchema>): Promise<ActionResult<ChunkResult>> {
  const parsed = chunkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "ข้อมูลชุดนี้ไม่ถูกต้อง" };
  const { batchId, firstRowNumber, rows } = parsed.data;
  const { supabase, user } = await requireUser();

  const { data: batch } = await supabase.from("import_batches").select("*").eq("id", batchId).maybeSingle();
  if (!batch) return { ok: false, error: "ไม่พบรายการนำเข้า" };
  if (batch.status !== "processing") return { ok: false, error: "รายการนำเข้านี้ปิดไปแล้ว" };
  const mapping = batch.column_mapping as ColumnMapping;
  const mode = batch.duplicate_mode as "skip" | "update";

  const result: ChunkResult = { inserted: 0, updated: 0, duplicates: 0, failed: 0 };
  const rowErrors: { row_number: number; raw: JsonValue; errors: JsonValue }[] = [];
  const fail = (rowNumber: number, raw: Record<string, unknown>, errors: RowError[]) => {
    result.failed++;
    rowErrors.push({ row_number: rowNumber, raw: raw as JsonValue, errors: errors as unknown as JsonValue });
  };

  // 1. Validate.
  const valid: { rowNumber: number; raw: Record<string, unknown>; value: ProductInput; id: string | null; key: string | null }[] = [];
  rows.forEach((raw, i) => {
    const mapped = mapRow(raw, mapping);
    if (!mapped.ok) fail(firstRowNumber + i, raw, mapped.errors);
    else valid.push({ rowNumber: firstRowNumber + i, raw, value: mapped.value, id: mapped.id, key: urlKey(mapped.value.product_url) });
  });

  // 2. Look up existing products for this chunk.
  const ids = [...new Set(valid.map((v) => v.id).filter((x): x is string => !!x))];
  const pids = [...new Set(valid.map((v) => v.value.source_product_id).filter((x): x is string => !!x))];
  const keys = [...new Set(valid.map((v) => v.key).filter((x): x is string => !!x))];
  const byId = new Map<string, { id: string; provenance: Json }>();
  const byPid = new Map<string, { id: string; provenance: Json }>();
  const byKey = new Map<string, { id: string; provenance: Json }>();
  if (ids.length) {
    const { data, error } = await supabase.from("products").select("id, provenance").in("id", ids);
    if (error) return { ok: false, error: `ตรวจข้อมูลซ้ำไม่สำเร็จ: ${error.message}` };
    for (const p of data) byId.set(p.id, p);
  }
  if (pids.length) {
    const { data, error } = await supabase.from("products").select("id, source_product_id, provenance").eq("source", "csv").in("source_product_id", pids);
    if (error) return { ok: false, error: `ตรวจข้อมูลซ้ำไม่สำเร็จ: ${error.message}` };
    for (const p of data) if (p.source_product_id) byPid.set(p.source_product_id, p);
  }
  if (keys.length) {
    const { data, error } = await supabase.from("products").select("id, url_key, provenance").in("url_key", keys);
    if (error) return { ok: false, error: `ตรวจข้อมูลซ้ำไม่สำเร็จ: ${error.message}` };
    for (const p of data) if (p.url_key) byKey.set(p.url_key, p);
  }

  // 3. Decide insert / update / skip. Rows repeated inside the chunk are duplicates of the first one.
  const seen = new Set<string>();
  const inserts: ProductRow[] = [];
  const updates: { rowNumber: number; raw: Record<string, unknown>; id: string; patch: TablesUpdate<"products"> }[] = [];
  for (const v of valid) {
    // A System ID must point at one of the user's products; it never creates a new one.
    if (v.id && !byId.has(v.id)) {
      fail(v.rowNumber, v.raw, [{ field: "id", message: "ไม่พบสินค้ารหัสนี้ในระบบ (อาจถูกลบไปแล้ว)" }]);
      continue;
    }
    const sysKey = v.id ? `id:${v.id}` : null;
    const idKey = v.value.source_product_id ? `pid:${v.value.source_product_id}` : null;
    const urlK = v.key ? `url:${v.key}` : null;
    if ((sysKey && seen.has(sysKey)) || (idKey && seen.has(idKey)) || (urlK && seen.has(urlK))) {
      result.duplicates++;
      continue;
    }
    if (sysKey) seen.add(sysKey);
    if (idKey) seen.add(idKey);
    if (urlK) seen.add(urlK);

    const existing =
      (v.id && byId.get(v.id)) || (v.value.source_product_id && byPid.get(v.value.source_product_id)) || (v.key && byKey.get(v.key)) || null;
    if (existing) {
      if (mode === "skip") {
        result.duplicates++;
        continue;
      }
      // Only overwrite with values the CSV actually has; blanks never erase existing data.
      const patch: TablesUpdate<"products"> = { import_batch_id: batchId };
      const provenance = { ...((existing.provenance ?? {}) as Provenance) };
      for (const [k, val] of Object.entries(v.value) as [keyof ProductInput, unknown][]) {
        if (val === null) continue;
        (patch as Record<string, unknown>)[k] = val;
        if ((TRACKED_FIELDS as readonly string[]).includes(k)) provenance[k as keyof Provenance] = "imported_csv";
      }
      if (v.value.product_url) patch.url_key = v.key;
      patch.provenance = provenance as JsonValue;
      updates.push({ rowNumber: v.rowNumber, raw: v.raw, id: existing.id, patch });
      continue;
    }
    inserts.push({
      ...v.value,
      owner_id: user.id,
      source: "csv",
      url_key: v.key,
      provenance: provenanceFor(v.value, SOURCE_ADAPTERS.csv.provenance) as JsonValue,
      import_batch_id: batchId,
    });
  }

  // 4. Write.
  const written: string[] = [];
  if (inserts.length) {
    const { data, error } = await supabase.from("products").insert(inserts).select("id");
    if (error) return { ok: false, error: `บันทึกสินค้าไม่สำเร็จ: ${error.message}` };
    result.inserted = inserts.length;
    written.push(...data.map((d) => d.id));
  }
  for (const u of updates) {
    const { error } = await supabase.from("products").update(u.patch).eq("id", u.id);
    if (error) fail(u.rowNumber, u.raw, [{ field: "", message: `อัปเดตไม่สำเร็จ: ${error.message}` }]);
    else {
      result.updated++;
      written.push(u.id);
    }
  }
  // Not fatal: products are saved; /research shows unscored products and offers to recompute.
  await refreshOpportunityScores(supabase, written);
  if (rowErrors.length) {
    const { error } = await supabase.from("import_row_errors").insert(rowErrors.map((e) => ({ ...e, batch_id: batchId, owner_id: user.id })));
    if (error) return { ok: false, error: `บันทึกแถวที่ผิดพลาดไม่สำเร็จ: ${error.message}` };
  }

  const { error: batchError } = await supabase
    .from("import_batches")
    .update({
      inserted_count: batch.inserted_count + result.inserted,
      updated_count: batch.updated_count + result.updated,
      duplicate_count: batch.duplicate_count + result.duplicates,
      failed_count: batch.failed_count + result.failed,
    })
    .eq("id", batchId);
  if (batchError) return { ok: false, error: `อัปเดตสรุปไม่สำเร็จ: ${batchError.message}` };

  return { ok: true, data: result };
}

export async function finishImport(batchId: string, status: "completed" | "failed"): Promise<ActionResult<null>> {
  if (!z.uuid().safeParse(batchId).success) return { ok: false, error: "รหัสรายการไม่ถูกต้อง" };
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("import_batches")
    .update({ status, completed_at: new Date().toISOString() })
    .eq("id", batchId)
    .eq("status", "processing");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/products");
  revalidatePath("/dashboard");
  return { ok: true, data: null };
}
