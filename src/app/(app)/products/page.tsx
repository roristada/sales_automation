import { FileUp, Pencil, Plus, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, Td, Th, Tr } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { Chip } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/features/products/data-value";
import { ProductFilterBar, Pagination } from "@/features/products/filter-bar";
import { applyProductFilters, filtersToQuery, hasActiveFilters, parseProductFilters } from "@/features/products/filters";
import { SOURCE_LABEL } from "@/features/products/schema";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "สินค้า" };

const PAGE_SIZE = 50;

/** Catalogue management: find, add, edit. Evaluation lives in /research. */
export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseProductFilters(await searchParams);
  const { supabase } = await getCurrentUser();

  const base = supabase!
    .from("products")
    .select("id, name, source, marketplace, category, updated_at", { count: "exact" })
    .range((filters.page - 1) * PAGE_SIZE, filters.page * PAGE_SIZE - 1);
  const { data: products, count, error } = await applyProductFilters(base, filters);
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="สินค้า"
        description="รายการสินค้าทั้งหมดของคุณ เพิ่ม แก้ไข หรือนำเข้าจากไฟล์"
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/products/import">
                <FileUp aria-hidden /> นำเข้า CSV
              </Link>
            </Button>
            <Button asChild>
              <Link href="/products/new">
                <Plus aria-hidden /> เพิ่มสินค้า
              </Link>
            </Button>
          </>
        }
      />

      <ProductFilterBar basePath="/products" filters={filters} categories={[]} show={{ sort: false }} />

      {error ? (
        <ErrorState title="โหลดสินค้าไม่สำเร็จ" description={error.message} />
      ) : !products?.length ? (
        hasActiveFilters(filters) ? (
          <EmptyState
            icon={SearchX}
            title="ไม่พบสินค้าที่ตรงกับเงื่อนไข"
            action={
              <Button asChild variant="outline">
                <Link href="/products">ล้างตัวกรอง</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="ยังไม่มีสินค้า"
            description="เพิ่มสินค้าทีละรายการ หรือนำเข้าหลายรายการจากไฟล์ CSV"
            action={
              <Button asChild>
                <Link href="/products/new">
                  <Plus aria-hidden /> เพิ่มสินค้า
                </Link>
              </Button>
            }
          />
        )
      ) : (
        <>
          <p className="mb-2 text-[13px] text-muted-foreground" aria-live="polite">
            {count?.toLocaleString("th-TH")} รายการ
          </p>
          <DataTable caption="รายการสินค้า">
            <thead>
              <tr>
                <Th>ชื่อสินค้า</Th>
                <Th hideBelow="sm">แหล่งข้อมูล</Th>
                <Th hideBelow="md">หมวดหมู่</Th>
                <Th hideBelow="lg">อัปเดต</Th>
                <Th className="w-0">
                  <span className="sr-only">การทำงาน</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <Tr key={p.id}>
                  <Td className="max-w-[420px]">
                    <Link href={`/products/${p.id}`} className="line-clamp-2 font-medium hover:underline">
                      {p.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground sm:hidden">
                      {SOURCE_LABEL[p.source]}
                      {p.category && ` · ${p.category}`}
                    </p>
                  </Td>
                  <Td hideBelow="sm">
                    <Chip>{SOURCE_LABEL[p.source]}</Chip>
                    {p.marketplace && <span className="ml-1.5 text-xs text-muted-foreground">{p.marketplace}</span>}
                  </Td>
                  <Td hideBelow="md">{p.category ?? <span className="text-muted-foreground">—</span>}</Td>
                  <Td hideBelow="lg" className="text-[13px] whitespace-nowrap text-muted-foreground">
                    {formatDateTime(p.updated_at)}
                  </Td>
                  <Td>
                    <Button asChild variant="ghost" size="icon-sm">
                      <Link href={`/products/${p.id}/edit`} aria-label={`แก้ไข ${p.name}`}>
                        <Pencil aria-hidden />
                      </Link>
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
          <Pagination page={filters.page} totalPages={totalPages} hrefFor={(page) => `/products${filtersToQuery({ ...filters, page })}`} />
        </>
      )}
    </>
  );
}
