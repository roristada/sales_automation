import { describe, expect, it } from "vitest";
import { guessMapping, mapRow, validateMapping } from "./csv";
import { fieldStatus, parseDateCell, parseNumberCell, productInputSchema, provenanceFor, urlKey } from "./schema";

describe("parseNumberCell", () => {
  it("parses currency formats", () => {
    expect(parseNumberCell("฿1,299.00")).toBe(1299);
    expect(parseNumberCell("1 299 บาท")).toBe(1299);
    expect(parseNumberCell("12.5%")).toBe(12.5);
    expect(parseNumberCell(42)).toBe(42);
  });
  it("keeps unknown as null, never 0", () => {
    expect(parseNumberCell("")).toBeNull();
    expect(parseNumberCell("  ")).toBeNull();
    expect(parseNumberCell("N/A")).toBeNull();
    expect(parseNumberCell(undefined)).toBeNull();
  });
  it("flags garbage as NaN", () => {
    expect(parseNumberCell("abc")).toBeNaN();
  });
});

describe("parseDateCell", () => {
  it("parses ISO and Thai DD/MM/YYYY including Buddhist era", () => {
    expect(parseDateCell("2026-10-20")).toBe("2026-10-20T00:00:00.000Z");
    expect(parseDateCell("20/10/2026")).toBe("2026-10-20T00:00:00.000Z");
    expect(parseDateCell("20/10/2569")).toBe("2026-10-20T00:00:00.000Z");
  });
  it("rejects impossible dates", () => {
    expect(parseDateCell("31/02/2026")).toBe("invalid");
    expect(parseDateCell("not a date")).toBe("invalid");
  });
});

describe("productInputSchema", () => {
  it("requires a name and fills missing fields with null", () => {
    const r = productInputSchema.parse({ name: "  หูฟังไร้สาย  " });
    expect(r.name).toBe("หูฟังไร้สาย");
    expect(r.price).toBeNull();
    expect(r.commission_rate).toBeNull();
  });
  it("rejects bad URLs, negative prices and rates over 100", () => {
    const r = productInputSchema.safeParse({ name: "x", product_url: "javascript:alert(1)", price: "-5", commission_rate: "150" });
    expect(r.success).toBe(false);
    const fields = r.error!.issues.map((i) => i.path[0]);
    expect(fields).toEqual(expect.arrayContaining(["product_url", "price", "commission_rate"]));
  });
});

describe("urlKey", () => {
  it("normalises for duplicate detection", () => {
    expect(urlKey("https://WWW.Shopee.co.th/product/1/2/?utm=x#a")).toBe("shopee.co.th/product/1/2");
    expect(urlKey("https://shopee.co.th/product/1/2")).toBe("shopee.co.th/product/1/2");
    expect(urlKey(null)).toBeNull();
  });
});

describe("csv mapping", () => {
  const headers = ["Product Name", "Item ID", "Price", "Commission Rate", "Commission", "Product Link", "Offer Link", "Source"];

  it("guesses columns from English headers", () => {
    const m = guessMapping(headers);
    expect(m).toMatchObject({
      name: "Product Name",
      source_product_id: "Item ID",
      price: "Price",
      commission_rate: "Commission Rate",
      commission_amount: "Commission",
      product_url: "Product Link",
      affiliate_url: "Offer Link",
      marketplace: "Source",
    });
  });

  it("guesses columns from Thai headers", () => {
    expect(guessMapping(["ชื่อสินค้า", "ราคา", "หมวดหมู่"])).toEqual({ name: "ชื่อสินค้า", price: "ราคา", category: "หมวดหมู่" });
  });

  it("validates the mapping", () => {
    expect(validateMapping({})).toMatch(/ชื่อสินค้า/);
    expect(validateMapping({ name: "A", category: "A" })).toMatch(/ฟิลด์เดียว/);
    expect(validateMapping({ name: "A" })).toBeNull();
  });

  it("maps and validates a row, reporting field errors", () => {
    const ok = mapRow({ "Product Name": "กระเป๋า", Price: "฿590" }, { name: "Product Name", price: "Price" });
    expect(ok).toEqual({ ok: true, id: null, value: expect.objectContaining({ name: "กระเป๋า", price: 590 }) });
    const bad = mapRow({ "Product Name": "", Price: "abc" }, { name: "Product Name", price: "Price" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.map((e) => e.field).sort()).toEqual(["name", "price"]);
  });

  it("reads back cells our export escaped against spreadsheet formulas", () => {
    const row = mapRow({ "Product Name": "'=HYPERLINK(1)", Notes: "'-50% วันนี้", Description: "'ok" }, { name: "Product Name", notes: "Notes", description: "Description" });
    expect(row).toEqual({ ok: true, id: null, value: expect.objectContaining({ name: "=HYPERLINK(1)", notes: "-50% วันนี้", description: "'ok" }) });
  });
});

describe("System ID column", () => {
  const id = "3f1c2b8e-5d7a-4c1e-9b2a-1234567890ab";
  it("is auto-mapped from an export header", () => {
    expect(guessMapping(["System ID", "Product Name", "Item ID"])).toMatchObject({ id: "System ID", name: "Product Name", source_product_id: "Item ID" });
  });
  it("returns the id separately and never puts it into the product fields", () => {
    const r = mapRow({ "System ID": ` ${id} `, Name: "a" }, { id: "System ID", name: "Name" });
    expect(r.ok && r.id).toBe(id);
    expect(r.ok && "id" in r.value).toBe(false);
    const blank = mapRow({ "System ID": "", Name: "a" }, { id: "System ID", name: "Name" });
    expect(blank.ok && blank.id).toBeNull();
  });
  it("rejects a malformed id", () => {
    const r = mapRow({ "System ID": "abc", Name: "a" }, { id: "System ID", name: "Name" });
    expect(!r.ok && r.errors.map((e) => e.field)).toEqual(["id"]);
  });
});

describe("data status", () => {
  const now = new Date("2026-10-20T00:00:00Z");
  const base = {
    name: "x",
    price: 100,
    commission_rate: null,
    image_url: "https://x/y.jpg",
    provenance: { name: "imported_csv", price: "imported_csv", image_url: "imported_csv" } as const,
    retrieved_at: "2026-10-18T00:00:00Z",
    updated_at: "2026-10-18T00:00:00Z",
  };

  it("reports unavailable for null values and the stored status otherwise", () => {
    expect(fieldStatus(base, "commission_rate", now)).toBe("unavailable");
    expect(fieldStatus(base, "price", now)).toBe("imported_csv");
  });

  it("marks old price data as stale but not static fields", () => {
    const old = { ...base, retrieved_at: "2026-09-01T00:00:00Z" };
    expect(fieldStatus(old, "price", now)).toBe("stale");
    expect(fieldStatus(old, "image_url", now)).toBe("imported_csv");
  });

  it("builds provenance only for present fields", () => {
    const input = productInputSchema.parse({ name: "x", price: "10" });
    expect(provenanceFor(input, "user_provided")).toEqual({ name: "user_provided", price: "user_provided" });
  });
});
