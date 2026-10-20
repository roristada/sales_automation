import { PRODUCT_SOURCES, type ProductSource, STALE_AFTER_DAYS } from "./schema";

/** URL search params for product lists, parsed defensively (unknown values are ignored). */
export interface ProductFilters {
  q: string;
  source: ProductSource | null;
  category: string | null;
  freshness: "fresh" | "stale" | null;
  missing: "price" | "commission" | null;
  sort: ProductSort;
  page: number;
}

export const SORTS = {
  // Only on /research, which reads the research_products view (has opportunity_score).
  score: { label: "คะแนนโอกาสสูงสุด", column: "opportunity_score", ascending: false },
  updated: { label: "อัปเดตล่าสุด", column: "updated_at", ascending: false },
  commission_rate: { label: "อัตราค่าคอมสูงสุด", column: "commission_rate", ascending: false },
  price_asc: { label: "ราคาต่ำ → สูง", column: "price", ascending: true },
  price_desc: { label: "ราคาสูง → ต่ำ", column: "price", ascending: false },
  name: { label: "ชื่อ ก → ฮ", column: "name", ascending: true },
} as const;
export type ProductSort = keyof typeof SORTS;

export const FRESHNESS_LABEL = { fresh: `อัปเดตภายใน ${STALE_AFTER_DAYS} วัน`, stale: `เก่ากว่า ${STALE_AFTER_DAYS} วัน` } as const;
export const MISSING_LABEL = { price: "ไม่มีราคา", commission: "ไม่มีค่าคอม" } as const;

type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || "";

/** Sorts that need the research_products view; ignored elsewhere. */
const RESEARCH_ONLY_SORTS: ProductSort[] = ["score"];

export function parseProductFilters(raw: Raw, scope: "catalogue" | "research" = "catalogue"): ProductFilters {
  const source = one(raw.source);
  const freshness = one(raw.freshness);
  const missing = one(raw.missing);
  const sort = one(raw.sort);
  return {
    q: one(raw.q).slice(0, 200),
    source: PRODUCT_SOURCES.includes(source as ProductSource) ? (source as ProductSource) : null,
    category: one(raw.category).slice(0, 120) || null,
    freshness: freshness === "fresh" || freshness === "stale" ? freshness : null,
    missing: missing === "price" || missing === "commission" ? missing : null,
    sort: sort in SORTS && (scope === "research" || !RESEARCH_ONLY_SORTS.includes(sort as ProductSort)) ? (sort as ProductSort) : "updated",
    page: Math.max(1, Math.floor(Number(one(raw.page))) || 1),
  };
}

export function hasActiveFilters(f: ProductFilters) {
  return !!(f.q || f.source || f.category || f.freshness || f.missing);
}

/** Builds a query string for the given filters, dropping defaults. */
export function filtersToQuery(f: Partial<ProductFilters>): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.source) p.set("source", f.source);
  if (f.category) p.set("category", f.category);
  if (f.freshness) p.set("freshness", f.freshness);
  if (f.missing) p.set("missing", f.missing);
  if (f.sort && f.sort !== "updated") p.set("sort", f.sort);
  if (f.page && f.page > 1) p.set("page", String(f.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Escapes LIKE wildcards in user input. */
export const likeEscape = (s: string) => s.replace(/[%_\\]/g, (c) => `\\${c}`);

/**
 * Applies filters to a Supabase products query. Typed loosely on purpose: it only chains
 * filter methods that exist on every PostgREST filter builder.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyProductFilters<Q extends { ilike: any; eq: any; is: any; or: any; order: any }>(query: Q, f: ProductFilters, now = new Date()): Q {
  let q = query;
  if (f.q) q = q.ilike("name", `%${likeEscape(f.q)}%`);
  if (f.source) q = q.eq("source", f.source);
  if (f.category) q = q.eq("category", f.category);
  const cutoff = new Date(now.getTime() - STALE_AFTER_DAYS * 86_400_000).toISOString();
  if (f.freshness === "stale") q = q.or(`retrieved_at.lt.${cutoff},and(retrieved_at.is.null,updated_at.lt.${cutoff})`);
  if (f.freshness === "fresh") q = q.or(`retrieved_at.gte.${cutoff},and(retrieved_at.is.null,updated_at.gte.${cutoff})`);
  if (f.missing === "price") q = q.is("price", null);
  if (f.missing === "commission") q = q.is("commission_rate", null).is("commission_amount", null);
  const sort = SORTS[f.sort];
  q = q.order(sort.column, { ascending: sort.ascending, nullsFirst: false });
  if (sort.column !== "updated_at") q = q.order("updated_at", { ascending: false });
  return q;
}
