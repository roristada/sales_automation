import { formatTHB } from "@/features/products/data-value";
import { type DataStatus, fieldStatus, type Provenance, type StoredStatus } from "@/features/products/schema";

/**
 * Facts a script may state about a product. Two kinds:
 * - built-in product fields (name, price, …), referenced as "field:<name>"
 * - user-entered product_facts rows, referenced as "fact:<uuid>"
 * Commission is deliberately not a fact: it is not something to tell viewers.
 */

export const PRODUCT_FIELD_FACTS = ["name", "price", "category", "marketplace", "description"] as const;
export type ProductFieldFact = (typeof PRODUCT_FIELD_FACTS)[number];

export const FIELD_FACT_LABEL: Record<ProductFieldFact, string> = {
  name: "ชื่อสินค้า",
  price: "ราคา",
  category: "หมวดหมู่",
  marketplace: "ร้าน/Marketplace",
  description: "รายละเอียดสินค้า",
};

export interface Fact {
  /** "field:price" or "fact:<uuid>" */
  key: string;
  label: string;
  /** Display value; null when the product has no value (status "unavailable"). */
  value: string | null;
  status: DataStatus;
}

export interface FactProduct {
  name: string;
  price: number | null;
  category: string | null;
  marketplace: string | null;
  description: string | null;
  provenance: Provenance;
  retrieved_at: string | null;
  updated_at: string;
}

export interface ProductFactRow {
  id: string;
  label: string;
  value: string;
  status: StoredStatus | string;
}

export const fieldKey = (f: ProductFieldFact) => `field:${f}`;
export const factKey = (id: string) => `fact:${id}`;

/** Key of the fact a claim cites, or null when it cites nothing. */
export function claimFactKey(c: { fact_id: string | null; product_field: string | null }): string | null {
  if (c.fact_id) return factKey(c.fact_id);
  if (c.product_field) return `field:${c.product_field}`;
  return null;
}

/** Parses a fact key back into the two claim columns. */
export function parseFactKey(key: string | null | undefined): { fact_id: string | null; product_field: ProductFieldFact | null } {
  if (key?.startsWith("fact:")) return { fact_id: key.slice(5), product_field: null };
  if (key?.startsWith("field:") && (PRODUCT_FIELD_FACTS as readonly string[]).includes(key.slice(6))) {
    return { fact_id: null, product_field: key.slice(6) as ProductFieldFact };
  }
  return { fact_id: null, product_field: null };
}

export function buildFacts(product: FactProduct, rows: ProductFactRow[], now: Date = new Date()): Fact[] {
  const fields: Fact[] = PRODUCT_FIELD_FACTS.map((f) => {
    const raw = product[f];
    return {
      key: fieldKey(f),
      label: FIELD_FACT_LABEL[f],
      value: raw === null || raw === "" ? null : f === "price" ? formatTHB(raw as number) : String(raw),
      status: fieldStatus(product, f, now),
    };
  });
  const custom: Fact[] = rows.map((r) => ({ key: factKey(r.id), label: r.label, value: r.value, status: r.status as StoredStatus }));
  return [...custom, ...fields];
}
