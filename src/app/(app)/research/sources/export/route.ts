import Papa from "papaparse";
import { MAX_IMPORT_ROWS } from "@/features/products/csv";
import { applyProductFilters, parseProductFilters } from "@/features/products/filters";
import { getCurrentUser } from "@/lib/supabase/server";

/*
 * Exports the user's products as a CSV that the importer maps automatically (headers match its
 * hints). "System ID" lets the re-import update each product in place — the bulk refresh path
 * for sources without an API.
 */

const COLUMNS = [
  ["System ID", "id"],
  ["Product Name", "name"],
  ["Item ID", "source_product_id"],
  ["Product URL", "product_url"],
  ["Affiliate URL", "affiliate_url"],
  ["Marketplace", "marketplace"],
  ["Category", "category"],
  ["Price", "price"],
  ["Commission Rate", "commission_rate"],
  ["Commission Amount", "commission_amount"],
  ["Image URL", "image_url"],
  ["Description", "description"],
  ["Retrieved", "retrieved_at"],
  ["Notes", "notes"],
] as const;

const PAGE = 1000;

export async function GET(request: Request) {
  const { supabase, user } = await getCurrentUser();
  if (!supabase || !user) return new Response("ยังไม่ได้เข้าสู่ระบบ", { status: 401 });

  const filters = parseProductFilters(Object.fromEntries(new URL(request.url).searchParams));
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from < MAX_IMPORT_ROWS; from += PAGE) {
    const query = supabase
      .from("products")
      .select(COLUMNS.map(([, c]) => c).join(", "))
      .range(from, Math.min(from + PAGE, MAX_IMPORT_ROWS) - 1);
    const { data, error } = await applyProductFilters(query, { ...filters, sort: "name" });
    if (error) return new Response(`ส่งออกไม่สำเร็จ: ${error.message}`, { status: 500 });
    rows.push(...(data as unknown as Record<string, unknown>[]));
    if (data.length < PAGE) break;
  }

  const csv = Papa.unparse({
    fields: COLUMNS.map(([h]) => h),
    // Dates as YYYY-MM-DD so spreadsheets and the importer both read them.
    data: rows.map((r) => COLUMNS.map(([, c]) => (c === "retrieved_at" && r[c] ? String(r[c]).slice(0, 10) : (r[c] ?? "")))),
  });
  const name = `products-${filters.freshness ?? "all"}${filters.source ? `-${filters.source}` : ""}-${new Date().toISOString().slice(0, 10)}.csv`;
  // BOM so Excel opens Thai text as UTF-8.
  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
