import { productInputSchema, type ProductSource, SOURCE_LABEL } from "@/features/products/schema";
import { type NormalizedPage, type ProductSourceAdapter, SourceNotConnectedError, type SourceProductQuery } from "./types";

const manual: ProductSourceAdapter = {
  key: "manual",
  label: SOURCE_LABEL.manual,
  mode: "manual",
  provenance: "user_provided",
  connection: () => ({ state: "available", note: "กรอกข้อมูลสินค้าเองในแบบฟอร์ม" }),
};

const csv: ProductSourceAdapter = {
  key: "csv",
  label: SOURCE_LABEL.csv,
  mode: "file",
  provenance: "imported_csv",
  connection: () => ({ state: "available", note: "นำเข้าไฟล์ CSV เช่น export จาก Shopee Affiliate" }),
};

// API sources: no fetchProducts until access is confirmed — no mock data that looks real (PLAN.md §2).
const shopeeAffiliate: ProductSourceAdapter = {
  key: "shopee_affiliate",
  label: SOURCE_LABEL.shopee_affiliate,
  mode: "api",
  provenance: "verified_source",
  connection: () => ({ state: "not_available", note: "ยังไม่ได้ยืนยันสิทธิ์ Open API ของบัญชีไทย — ใช้การนำเข้า CSV แทน" }),
};

const tiktokShop: ProductSourceAdapter = {
  key: "tiktok_shop",
  label: SOURCE_LABEL.tiktok_shop,
  mode: "api",
  provenance: "verified_source",
  connection: () => ({ state: "not_available", note: "ยังไม่รองรับ — รอยืนยันสิทธิ์การเข้าถึง API" }),
};

/** One adapter per product_source enum value; the type makes a missing adapter a compile error. */
export const SOURCE_ADAPTERS: Record<ProductSource, ProductSourceAdapter> = {
  manual,
  csv,
  shopee_affiliate: shopeeAffiliate,
  tiktok_shop: tiktokShop,
};

export const getSourceAdapter = (key: ProductSource) => SOURCE_ADAPTERS[key];
export const listSourceAdapters = () => Object.values(SOURCE_ADAPTERS);

/**
 * Pulls one page from an API source and validates every product with the shared schema.
 * Throws SourceNotConnectedError when the source cannot be used — callers show that state
 * instead of falling back to fake data.
 */
export async function fetchSourcePage(adapter: ProductSourceAdapter, query: SourceProductQuery): Promise<NormalizedPage> {
  const connection = adapter.connection();
  if (connection.state !== "available" || !adapter.fetchProducts) throw new SourceNotConnectedError(adapter.key, connection);

  const page = await adapter.fetchProducts(query);
  const out: NormalizedPage = { valid: [], invalid: [], nextCursor: page.nextCursor };
  page.products.forEach((raw, index) => {
    const parsed = productInputSchema.safeParse(raw);
    if (!parsed.success) {
      out.invalid.push({ index, errors: parsed.error.issues.map((i) => ({ field: String(i.path[0] ?? ""), message: i.message })) });
      return;
    }
    // The source's own timestamp wins; otherwise the page time.
    out.valid.push({ ...parsed.data, retrieved_at: parsed.data.retrieved_at ?? page.retrievedAt });
  });
  return out;
}
