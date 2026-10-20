import { z } from "zod";

/**
 * One product schema shared by manual entry, CSV import and (later) marketplace adapters.
 * Unknown values are `null`, never 0 or a guessed value.
 */

export const PRODUCT_SOURCES = ["manual", "csv", "shopee_affiliate", "tiktok_shop"] as const;
export type ProductSource = (typeof PRODUCT_SOURCES)[number];

/** Stored per-field statuses. "unavailable" and "stale" are derived, never stored. */
export const STORED_STATUSES = ["verified_source", "user_provided", "imported_csv", "ai_estimate"] as const;
export type StoredStatus = (typeof STORED_STATUSES)[number];
export type DataStatus = StoredStatus | "unavailable" | "stale";

/** Fields whose provenance is tracked. */
export const TRACKED_FIELDS = [
  "name",
  "product_url",
  "affiliate_url",
  "marketplace",
  "category",
  "price",
  "commission_rate",
  "commission_amount",
  "image_url",
  "description",
] as const;
export type TrackedField = (typeof TRACKED_FIELDS)[number];

export type Provenance = Partial<Record<TrackedField, StoredStatus>>;

const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const trimmed = (max: number) =>
  z.preprocess(
    (v) => {
      const e = emptyToNull(v);
      return typeof e === "string" ? e.trim() : e;
    },
    z.string().max(max, `ยาวเกิน ${max} ตัวอักษร`).nullable(),
  );

const httpUrl = z.preprocess(
  (v) => {
    const e = emptyToNull(v);
    return typeof e === "string" ? e.trim() : e;
  },
  z
    .string()
    .max(2000)
    .refine((s) => {
      try {
        const u = new URL(s);
        return u.protocol === "http:" || u.protocol === "https:";
      } catch {
        return false;
      }
    }, "URL ต้องขึ้นต้นด้วย http:// หรือ https://")
    .nullable(),
);

/**
 * Parses a money/number cell: "฿1,299.00", "1 299", "1299" → 1299.
 * Returns null for empty input and NaN for garbage (so validation reports it).
 */
export function parseNumberCell(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (s === "" || s === "-" || /^n\/?a$/i.test(s)) return null;
  const cleaned = s.replace(/[฿$,\s]|บาท|THB/gi, "").replace(/%$/, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return Number.NaN;
  return Number(cleaned);
}

const numberCell = (opts: { max?: number; label: string }) =>
  z.preprocess(
    parseNumberCell,
    z
      .number({ error: `${opts.label} ต้องเป็นตัวเลข` })
      .refine((n) => !Number.isNaN(n), `${opts.label} ต้องเป็นตัวเลข`)
      .refine((n) => n >= 0, `${opts.label} ต้องไม่ติดลบ`)
      .refine((n) => opts.max === undefined || n <= opts.max, `${opts.label} ต้องไม่เกิน ${opts.max}`)
      .nullable(),
  );

/**
 * Parses ISO dates and Thai-style DD/MM/YYYY (Buddhist-era years > 2400 are converted).
 * Returns null for empty input and "invalid" for unparseable input.
 */
export function parseDateCell(v: unknown): string | null {
  const e = emptyToNull(v);
  if (e === null || e === undefined) return null;
  const s = String(e).trim();
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  let d: Date;
  if (dmy) {
    const [day, month, rawYear] = dmy.slice(1).map(Number);
    const year = rawYear > 2400 ? rawYear - 543 : rawYear;
    d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return "invalid";
  } else {
    d = new Date(s);
  }
  return Number.isNaN(d.getTime()) ? "invalid" : d.toISOString();
}

const dateCell = z.preprocess(
  parseDateCell,
  z.iso.datetime({ message: "วันที่ไม่ถูกต้อง (ใช้รูปแบบ YYYY-MM-DD)" }).nullable(),
);

export const productInputSchema = z.object({
  name: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string({ error: "ต้องระบุชื่อสินค้า" }).min(1, "ต้องระบุชื่อสินค้า").max(300, "ชื่อยาวเกิน 300 ตัวอักษร"),
  ),
  source_product_id: trimmed(200).default(null),
  product_url: httpUrl.default(null),
  affiliate_url: httpUrl.default(null),
  marketplace: trimmed(60).default(null),
  category: trimmed(120).default(null),
  price: numberCell({ label: "ราคา" }).default(null),
  commission_rate: numberCell({ label: "อัตราค่าคอมมิชชัน", max: 100 }).default(null),
  commission_amount: numberCell({ label: "ค่าคอมมิชชัน" }).default(null),
  image_url: httpUrl.default(null),
  description: trimmed(5000).default(null),
  notes: trimmed(2000).default(null),
  retrieved_at: dateCell.default(null),
});

export type ProductInput = z.infer<typeof productInputSchema>;

/**
 * Normalises a product URL for duplicate detection: lowercase host, strip "www.",
 * drop query string, fragment and trailing slash. Returns null for missing/invalid URLs.
 */
export function urlKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    return `${host}${path}`;
  } catch {
    return null;
  }
}

/** Builds provenance for every non-null tracked field. */
export function provenanceFor(input: ProductInput, status: StoredStatus, base: Provenance = {}): Provenance {
  const out: Provenance = { ...base };
  for (const f of TRACKED_FIELDS) {
    if (input[f] === null || input[f] === undefined) delete out[f];
    else out[f] = status;
  }
  return out;
}

/** Days after which price/commission data counts as stale. */
export const STALE_AFTER_DAYS = 14;
const TIME_SENSITIVE: TrackedField[] = ["price", "commission_rate", "commission_amount"];

export function fieldStatus(
  product: { provenance: Provenance; retrieved_at: string | null; updated_at: string } & Partial<Record<TrackedField, unknown>>,
  field: TrackedField,
  now: Date = new Date(),
): DataStatus {
  const value = product[field];
  if (value === null || value === undefined || value === "") return "unavailable";
  const stored = product.provenance[field] ?? "user_provided";
  if (TIME_SENSITIVE.includes(field) && stored !== "ai_estimate") {
    const asOf = new Date(product.retrieved_at ?? product.updated_at);
    if (now.getTime() - asOf.getTime() > STALE_AFTER_DAYS * 86_400_000) return "stale";
  }
  return stored;
}

export const SOURCE_LABEL: Record<ProductSource, string> = {
  manual: "กรอกเอง",
  csv: "CSV",
  shopee_affiliate: "Shopee Affiliate",
  tiktok_shop: "TikTok Shop",
};
