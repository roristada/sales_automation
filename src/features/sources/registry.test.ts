import { describe, expect, it } from "vitest";
import { PRODUCT_SOURCES } from "@/features/products/schema";
import { fetchSourcePage, getSourceAdapter, listSourceAdapters } from "./registry";
import { type ProductSourceAdapter, SourceNotConnectedError } from "./types";

describe("source registry", () => {
  it("has exactly one adapter per product source", () => {
    expect(listSourceAdapters().map((a) => a.key).sort()).toEqual([...PRODUCT_SOURCES].sort());
    for (const s of PRODUCT_SOURCES) expect(getSourceAdapter(s).key).toBe(s);
  });

  it("maps sources to the provenance they record", () => {
    expect(getSourceAdapter("manual").provenance).toBe("user_provided");
    expect(getSourceAdapter("csv").provenance).toBe("imported_csv");
    expect(getSourceAdapter("shopee_affiliate").provenance).toBe("verified_source");
  });

  it("reports API sources without confirmed access honestly and never returns data", async () => {
    for (const key of ["shopee_affiliate", "tiktok_shop"] as const) {
      const a = getSourceAdapter(key);
      expect(a.connection().state).toBe("not_available");
      expect(a.fetchProducts).toBeUndefined();
      await expect(fetchSourcePage(a, { limit: 10 })).rejects.toBeInstanceOf(SourceNotConnectedError);
    }
  });
});

describe("fetchSourcePage", () => {
  const fake = (products: unknown[]): ProductSourceAdapter => ({
    key: "shopee_affiliate",
    label: "test",
    mode: "api",
    provenance: "verified_source",
    connection: () => ({ state: "available", note: "" }),
    fetchProducts: async () => ({ products: products as never, nextCursor: "next", retrievedAt: "2026-10-20T00:00:00.000Z" }),
  });

  it("validates with the shared schema and separates invalid rows", async () => {
    const page = await fetchSourcePage(fake([{ name: "หูฟัง", price: "฿299", commission_rate: "8%" }, { name: "", price: "abc" }]), { limit: 2 });
    expect(page.valid).toHaveLength(1);
    expect(page.valid[0]).toMatchObject({ name: "หูฟัง", price: 299, commission_rate: 8, commission_amount: null, retrieved_at: "2026-10-20T00:00:00.000Z" });
    expect(page.invalid).toHaveLength(1);
    expect(page.invalid[0].index).toBe(1);
    expect(page.invalid[0].errors.map((e) => e.field)).toEqual(expect.arrayContaining(["name", "price"]));
    expect(page.nextCursor).toBe("next");
  });

  it("keeps the product's own retrieved date over the page time", async () => {
    const page = await fetchSourcePage(fake([{ name: "a", retrieved_at: "2026-10-01" }]), { limit: 1 });
    expect(page.valid[0].retrieved_at).toBe("2026-10-01T00:00:00.000Z");
  });

  it("refuses adapters that are not connected even if they implement fetch", async () => {
    const a = { ...fake([]), connection: () => ({ state: "not_connected" as const, note: "ยังไม่ได้ตั้งค่า" }) };
    await expect(fetchSourcePage(a, { limit: 1 })).rejects.toThrow("ยังไม่ได้ตั้งค่า");
  });
});
