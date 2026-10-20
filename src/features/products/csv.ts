import { z } from "zod";
import { type ProductInput, productInputSchema } from "./schema";

/** System fields a CSV column can be mapped to. */
export const CSV_FIELDS = [
  // Our own product id (from an export). Matches an existing product so it is updated in place.
  { key: "id", label: "รหัสในระบบ (System ID) — ใช้อัปเดตสินค้าเดิม" },
  { key: "name", label: "ชื่อสินค้า (Product name)", required: true },
  { key: "source_product_id", label: "รหัสสินค้าที่แหล่งข้อมูล (Item ID)" },
  { key: "product_url", label: "ลิงก์สินค้า (Product URL)" },
  { key: "affiliate_url", label: "ลิงก์ Affiliate" },
  { key: "marketplace", label: "แหล่งที่มา/Marketplace (Source)" },
  { key: "category", label: "หมวดหมู่ (Category)" },
  { key: "price", label: "ราคา (Price)" },
  { key: "commission_rate", label: "อัตราค่าคอม % (Commission rate)" },
  { key: "commission_amount", label: "ค่าคอม บาท (Commission amount)" },
  { key: "image_url", label: "ลิงก์รูป (Image URL)" },
  { key: "description", label: "รายละเอียด (Description)" },
  { key: "retrieved_at", label: "วันที่ดึง/อัปเดตข้อมูล (Retrieved date)" },
  { key: "notes", label: "หมายเหตุ (Notes)" },
] as const satisfies readonly { key: keyof ProductInput | "id"; label: string; required?: boolean }[];

export type CsvFieldKey = (typeof CSV_FIELDS)[number]["key"];

/** field key → CSV header (or undefined when not mapped). */
export type ColumnMapping = Partial<Record<CsvFieldKey, string>>;

export const MAX_IMPORT_ROWS = 20_000;
export const IMPORT_CHUNK_SIZE = 500;

const HEADER_HINTS: Record<CsvFieldKey, string[]> = {
  id: ["system id", "รหัสในระบบ"],
  name: ["product name", "name", "title", "item name", "ชื่อสินค้า", "ชื่อ"],
  source_product_id: ["item id", "itemid", "product id", "productid", "sku", "รหัสสินค้า"],
  product_url: ["product url", "product link", "url", "link", "ลิงก์สินค้า", "ลิงค์สินค้า"],
  affiliate_url: ["affiliate url", "affiliate link", "offer link", "short link", "ลิงก์ affiliate", "ลิงก์แอฟฟิลิเอต"],
  marketplace: ["source", "marketplace", "shop platform", "platform", "แหล่งที่มา"],
  category: ["category", "หมวดหมู่"],
  price: ["price", "item price", "ราคา"],
  commission_rate: ["commission rate", "commission %", "rate", "อัตราค่าคอม", "ค่าคอม %"],
  commission_amount: ["commission", "commission amount", "ค่าคอมมิชชัน", "ค่าคอม"],
  image_url: ["image url", "image", "image link", "รูป", "ลิงก์รูป"],
  description: ["description", "product description", "รายละเอียด"],
  retrieved_at: ["retrieved", "retrieved at", "updated", "updated at", "date", "วันที่"],
  notes: ["notes", "note", "หมายเหตุ"],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ");

/** Guesses a mapping from CSV headers. Exact matches win; each header is used at most once. */
export function guessMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<string>();
  for (const pass of ["exact", "contains"] as const) {
    for (const { key } of CSV_FIELDS) {
      if (mapping[key]) continue;
      const hit = headers.find((h) => {
        if (used.has(h)) return false;
        const n = norm(h);
        return HEADER_HINTS[key].some((hint) => (pass === "exact" ? n === hint : n.includes(hint)));
      });
      if (hit) {
        mapping[key] = hit;
        used.add(hit);
      }
    }
  }
  return mapping;
}

export interface RowError {
  field: string;
  message: string;
}

export type MappedRow =
  | { ok: true; value: ProductInput; id: string | null }
  | { ok: false; errors: RowError[] };

/** Undoes the `'` our export adds before =, +, -, @ so spreadsheets don't run cell text as a formula. */
const unescapeFormula = (v: unknown) => (typeof v === "string" && /^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v);

const systemId = z.preprocess((v) => (typeof v === "string" ? v.trim() || null : (v ?? null)), z.uuid({ error: "รหัสในระบบไม่ถูกต้อง" }).nullable());

/** Applies the mapping to one raw CSV row and validates it with the shared product schema. */
export function mapRow(raw: Record<string, unknown>, mapping: ColumnMapping): MappedRow {
  const candidate: Record<string, unknown> = {};
  for (const { key } of CSV_FIELDS) {
    const header = mapping[key];
    if (header !== undefined && key !== "id") candidate[key] = unescapeFormula(raw[header]);
  }
  const parsed = productInputSchema.safeParse(candidate);
  const id = systemId.safeParse(mapping.id === undefined ? null : raw[mapping.id]);
  const errors: RowError[] = [];
  if (!id.success) errors.push({ field: "id", message: id.error.issues[0].message });
  if (!parsed.success) errors.push(...parsed.error.issues.map((i) => ({ field: String(i.path[0] ?? ""), message: i.message })));
  if (errors.length || !parsed.success || !id.success) return { ok: false, errors };
  return { ok: true, value: parsed.data, id: id.data };
}

export function validateMapping(mapping: ColumnMapping): string | null {
  if (!mapping.name) return "ต้องเลือกคอลัมน์สำหรับ ชื่อสินค้า";
  const headers = Object.values(mapping).filter(Boolean);
  if (new Set(headers).size !== headers.length) return "คอลัมน์ CSV หนึ่งคอลัมน์ map ได้กับฟิลด์เดียว";
  return null;
}
