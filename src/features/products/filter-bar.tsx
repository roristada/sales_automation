import { Search, X } from "lucide-react";
import Link from "next/link";
import { NativeSelect } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FRESHNESS_LABEL, MISSING_LABEL, type ProductFilters, SORTS } from "./filters";
import { PRODUCT_SOURCES, SOURCE_LABEL } from "./schema";

/**
 * Search, filters and sort grouped together (design.md §7). A plain GET form: works without
 * JavaScript, keeps state in the URL, and "ล้างตัวกรอง" resets to the base path.
 */
export function ProductFilterBar({
  basePath,
  filters,
  categories,
  show = { category: true, freshness: true, missing: true, sort: true },
}: {
  basePath: string;
  filters: ProductFilters;
  categories: string[];
  show?: { category?: boolean; freshness?: boolean; missing?: boolean; sort?: boolean };
}) {
  const active = filters.q || filters.source || filters.category || filters.freshness || filters.missing || filters.sort !== "updated";
  return (
    <form role="search" action={basePath} className="mb-4 flex flex-wrap items-end gap-2">
      <div className="relative w-full sm:w-64">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input name="q" defaultValue={filters.q} placeholder="ค้นหาชื่อสินค้า" aria-label="ค้นหาชื่อสินค้า" className="pl-9" />
      </div>
      <NativeSelect name="source" defaultValue={filters.source ?? ""} aria-label="แหล่งข้อมูล" className="w-[calc(50%-4px)] sm:w-auto">
        <option value="">ทุกแหล่งข้อมูล</option>
        {PRODUCT_SOURCES.map((s) => (
          <option key={s} value={s}>
            {SOURCE_LABEL[s]}
          </option>
        ))}
      </NativeSelect>
      {show.category && (
        <NativeSelect name="category" defaultValue={filters.category ?? ""} aria-label="หมวดหมู่" className="w-[calc(50%-4px)] sm:w-auto" disabled={!categories.length}>
          <option value="">{categories.length ? "ทุกหมวดหมู่" : "ยังไม่มีหมวดหมู่"}</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </NativeSelect>
      )}
      {show.freshness && (
        <NativeSelect name="freshness" defaultValue={filters.freshness ?? ""} aria-label="ความใหม่ของข้อมูล" className="w-[calc(50%-4px)] sm:w-auto">
          <option value="">ทุกช่วงเวลา</option>
          {Object.entries(FRESHNESS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </NativeSelect>
      )}
      {show.missing && (
        <NativeSelect name="missing" defaultValue={filters.missing ?? ""} aria-label="ข้อมูลที่ขาด" className="w-[calc(50%-4px)] sm:w-auto">
          <option value="">ข้อมูลครบหรือไม่ครบ</option>
          {Object.entries(MISSING_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </NativeSelect>
      )}
      {show.sort && (
        <NativeSelect name="sort" defaultValue={filters.sort} aria-label="เรียงตาม" className="w-full sm:w-auto">
          {Object.entries(SORTS).map(([k, v]) => (
            <option key={k} value={k}>
              เรียง: {v.label}
            </option>
          ))}
        </NativeSelect>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="secondary" className="h-10">
          ใช้ตัวกรอง
        </Button>
        {active && (
          <Button asChild variant="ghost" className="h-10">
            <Link href={basePath}>
              <X aria-hidden /> ล้างตัวกรอง
            </Link>
          </Button>
        )}
      </div>
    </form>
  );
}

export function Pagination({ page, totalPages, hrefFor }: { page: number; totalPages: number; hrefFor: (p: number) => string }) {
  if (totalPages <= 1) return null;
  return (
    <nav className="mt-4 flex items-center justify-between text-[13px]" aria-label="แบ่งหน้า">
      <span className="text-muted-foreground">
        หน้า {page} จาก {totalPages}
      </span>
      <div className="flex gap-2">
        {page > 1 && (
          <Button asChild variant="outline" size="sm">
            <Link href={hrefFor(page - 1)}>ก่อนหน้า</Link>
          </Button>
        )}
        {page < totalPages && (
          <Button asChild variant="outline" size="sm">
            <Link href={hrefFor(page + 1)}>ถัดไป</Link>
          </Button>
        )}
      </div>
    </nav>
  );
}
