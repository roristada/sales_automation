import { FileUp, Plus, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, Td, Th, Tr } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, Notice } from "@/components/shared/states";
import { Chip, TrustBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { DataValue, formatAge, formatPercent, formatTHB } from "@/features/products/data-value";
import { ProductFilterBar, Pagination } from "@/features/products/filter-bar";
import { applyProductFilters, filtersToQuery, hasActiveFilters, parseProductFilters } from "@/features/products/filters";
import { listCategories } from "@/features/products/queries";
import { fieldStatus, type Provenance, SOURCE_LABEL } from "@/features/products/schema";
import { type Confidence, effectiveConfidence } from "@/features/research/opportunity-score";
import { RecomputeScoresButton } from "@/features/research/recompute-button";
import { ResearchNav } from "@/features/research/research-nav";
import { ScoreCell } from "@/features/research/score-view";
import { countOutdatedScores } from "@/features/research/scores";
import type { Tables } from "@/lib/supabase/database.types";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "ค้นหาสินค้า" };

const PAGE_SIZE = 50;

/** research_products view row: view columns are typed nullable, but come from non-null product columns. */
type ResearchRow = Pick<
  Tables<"products">,
  "id" | "name" | "source" | "marketplace" | "category" | "price" | "commission_rate" | "commission_amount" | "provenance" | "retrieved_at" | "updated_at"
> & { opportunity_score: number | null; opportunity_confidence: Confidence | null; score_version: number | null };

export default async function ResearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseProductFilters(await searchParams, "research");
  const { supabase } = await getCurrentUser();
  const db = supabase!;

  const base = db
    .from("research_products")
    .select(
      "id, name, source, marketplace, category, price, commission_rate, commission_amount, provenance, retrieved_at, updated_at, opportunity_score, opportunity_confidence, score_version",
      { count: "exact" },
    )
    .range((filters.page - 1) * PAGE_SIZE, filters.page * PAGE_SIZE - 1);
  const [{ data, count, error }, categories, outdated] = await Promise.all([applyProductFilters(base, filters), listCategories(db), countOutdatedScores(db)]);
  const products = data as ResearchRow[] | null;

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const filtered = hasActiveFilters(filters);

  return (
    <>
      <PageHeader
        title="ค้นหาสินค้า"
        description="เปรียบเทียบสินค้าจากข้อมูลที่มีจริง ดูความใหม่ของราคาและค่าคอม และข้อมูลที่ยังขาด"
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/products/new">
                <Plus aria-hidden /> เพิ่มสินค้า
              </Link>
            </Button>
            <Button asChild>
              <Link href="/products/import">
                <FileUp aria-hidden /> นำเข้า CSV
              </Link>
            </Button>
          </>
        }
      />

      <ResearchNav current="/research" />

      <ProductFilterBar basePath="/research" filters={filters} categories={categories} />

      <Notice tone="info" className="mb-4">
        คะแนนโอกาส (0–100) คำนวณจากค่าคอม ราคา และความพร้อมของข้อมูลที่มีจริงเท่านั้น ข้อมูลที่ขาดจะลดความเชื่อมั่นแทนการเดาค่า ยังไม่รวมข้อมูลเทรนด์ และไม่ใช่การรับประกันยอดขาย — ดูที่มาของคะแนนได้ในหน้าสินค้า
      </Notice>

      {outdated > 0 && (
        <Notice tone="warning" className="mb-4">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span>มีสินค้า {outdated.toLocaleString("th-TH")} รายการที่ยังไม่มีคะแนน หรือคะแนนคำนวณด้วยสูตรเก่า</span>
            <RecomputeScoresButton />
          </span>
        </Notice>
      )}

      {error ? (
        <ErrorState title="โหลดสินค้าไม่สำเร็จ" description={error.message} />
      ) : !products?.length ? (
        filtered ? (
          <EmptyState
            icon={SearchX}
            title="ไม่พบสินค้าที่ตรงกับตัวกรอง"
            action={
              <Button asChild variant="outline">
                <Link href="/research">ล้างตัวกรอง</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="ยังไม่มีสินค้าให้วิเคราะห์"
            description="นำเข้าสินค้าจากไฟล์ CSV (เช่น export จาก Shopee Affiliate) เพื่อเริ่มเปรียบเทียบ"
            action={
              <Button asChild>
                <Link href="/products/import">
                  <FileUp aria-hidden /> นำเข้า CSV
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
          <DataTable caption="สินค้าสำหรับวิเคราะห์">
            <thead>
              <tr>
                <Th>สินค้า</Th>
                <Th numeric>คะแนนโอกาส</Th>
                <Th hideBelow="md">แหล่งข้อมูล</Th>
                <Th numeric hideBelow="sm">
                  ราคา
                </Th>
                <Th numeric hideBelow="sm">
                  ค่าคอม
                </Th>
                <Th hideBelow="lg">ความใหม่ของข้อมูล</Th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const row = { ...p, provenance: p.provenance as Provenance };
                const priceStatus = fieldStatus(row, "price");
                const useRate = p.commission_rate !== null || p.commission_amount === null;
                const commission = useRate ? (
                  <DataValue value={formatPercent(p.commission_rate)} status={fieldStatus(row, "commission_rate")} />
                ) : (
                  <DataValue value={formatTHB(p.commission_amount)} status={fieldStatus(row, "commission_amount")} />
                );
                const asOf = p.retrieved_at ?? p.updated_at;
                const stale = priceStatus === "stale" || fieldStatus(row, "commission_rate") === "stale" || fieldStatus(row, "commission_amount") === "stale";
                return (
                  <Tr key={p.id}>
                    <Td className="max-w-[420px]">
                      <Link href={`/products/${p.id}`} className="line-clamp-2 font-medium hover:underline">
                        {p.name}
                      </Link>
                      <p className="mt-0.5 text-xs text-muted-foreground">{[p.category, p.marketplace].filter(Boolean).join(" · ") || "ไม่ระบุหมวดหมู่"}</p>
                      {/* Stacked facts on small screens (columns hidden there). */}
                      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs sm:hidden">
                        <dt className="text-muted-foreground">ราคา</dt>
                        <dd className="tabular-nums">
                          <DataValue value={formatTHB(p.price)} status={priceStatus} />
                        </dd>
                        <dt className="text-muted-foreground">ค่าคอม</dt>
                        <dd className="tabular-nums">{commission}</dd>
                        <dt className="text-muted-foreground">ข้อมูล</dt>
                        <dd>{formatAge(asOf)}</dd>
                      </dl>
                    </Td>
                    <Td numeric>
                      <Link href={`/products/${p.id}?tab=score`} className="inline-block rounded-sm hover:underline" title="ดูที่มาของคะแนน">
                        <ScoreCell
                          computed={p.score_version !== null}
                          score={p.opportunity_score}
                          confidence={effectiveConfidence(p.opportunity_confidence, stale)}
                        />
                      </Link>
                    </Td>
                    <Td hideBelow="md">
                      <Chip>{SOURCE_LABEL[p.source]}</Chip>
                    </Td>
                    <Td numeric hideBelow="sm">
                      <DataValue value={formatTHB(p.price)} status={priceStatus} />
                    </Td>
                    <Td numeric hideBelow="sm">
                      {commission}
                    </Td>
                    <Td hideBelow="lg" className="whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-muted-foreground">{formatAge(asOf)}</span>
                        {priceStatus === "stale" && <TrustBadge status="stale" />}
                      </span>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </DataTable>
          <Pagination page={filters.page} totalPages={totalPages} hrefFor={(page) => `/research${filtersToQuery({ ...filters, page })}`} />
        </>
      )}
    </>
  );
}
