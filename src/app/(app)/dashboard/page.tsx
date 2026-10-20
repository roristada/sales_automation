import { ArrowRight, FileUp, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, SectionHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { StatusBadge, TrustBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { formatAge, formatDateTime } from "@/features/products/data-value";
import { STALE_AFTER_DAYS } from "@/features/products/schema";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "ภาพรวม" };

/** What needs attention + how to continue (design.md §9.1). No decorative KPI cards. */
export default async function DashboardPage() {
  const { supabase, user } = await getCurrentUser();
  const db = supabase!;
  const cutoff = new Date(Date.now() - STALE_AFTER_DAYS * 86_400_000).toISOString();
  const staleOr = `retrieved_at.lt.${cutoff},and(retrieved_at.is.null,updated_at.lt.${cutoff})`;
  const count = () => db.from("products").select("id", { count: "exact", head: true });

  const [total, noPrice, noCommission, stale, attention, batches, profile, toPost] = await Promise.all([
    count(),
    count().is("price", null),
    count().is("commission_rate", null).is("commission_amount", null),
    count().not("price", "is", null).or(staleOr),
    // Products whose numbers can't be trusted yet: missing price or stale price.
    db
      .from("products")
      .select("id, name, price, retrieved_at, updated_at")
      .or(`price.is.null,and(price.not.is.null,or(${staleOr}))`)
      .order("updated_at", { ascending: true })
      .limit(6),
    db.from("import_batches").select("id, file_name, status, total_rows, inserted_count, updated_count, duplicate_count, failed_count, created_at").order("created_at", { ascending: false }).limit(5),
    db.from("profiles").select("display_name").eq("id", user!.id).maybeSingle(),
    db.from("publications").select("id", { count: "exact", head: true }).in("status", ["draft", "scheduled"]),
  ]);

  const failed = [total, noPrice, noCommission, stale, attention, batches].find((r) => r.error);
  const name = profile.data?.display_name || user!.email;
  const header = (
    <PageHeader
      title="ภาพรวม"
      description={`สวัสดี ${name} — สิ่งที่ต้องดูแลและงานล่าสุด`}
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
  );

  if (failed?.error) {
    return (
      <>
        {header}
        <ErrorState title="โหลดข้อมูลภาพรวมไม่สำเร็จ" description={failed.error.message} />
      </>
    );
  }

  if (total.count === 0) {
    return (
      <>
        {header}
        <EmptyState
          title="เริ่มจากเพิ่มสินค้าชุดแรก"
          description="นำเข้าไฟล์ CSV (เช่น export จาก Shopee Affiliate) หรือเพิ่มสินค้าเองทีละรายการ"
          action={
            <Button asChild>
              <Link href="/products/import">
                <FileUp aria-hidden /> นำเข้า CSV
              </Link>
            </Button>
          }
        />
      </>
    );
  }

  const summary = [
    { label: "สินค้าทั้งหมด", value: total.count, href: "/products" },
    { label: "ไม่มีราคา", value: noPrice.count, href: "/research?missing=price" },
    { label: "ไม่มีค่าคอม", value: noCommission.count, href: "/research?missing=commission" },
    { label: `ราคาเก่ากว่า ${STALE_AFTER_DAYS} วัน`, value: stale.count, href: "/research?freshness=stale" },
    { label: "วิดีโอรอโพสต์", value: toPost.count, href: "/publishing" },
  ];

  return (
    <>
      {header}

      <dl className="mb-8 flex flex-wrap gap-x-8 gap-y-3 border-b pb-6">
        {summary.map((s) => (
          <div key={s.label}>
            <dt className="text-[13px] text-muted-foreground">{s.label}</dt>
            <dd>
              <Link href={s.href} className="text-xl font-semibold tabular-nums hover:text-primary hover:underline">
                {(s.value ?? 0).toLocaleString("th-TH")}
              </Link>
            </dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-8 xl:grid-cols-2">
        <section aria-labelledby="attention-h">
          <SectionHeader
            id="attention-h"
            title="สินค้าที่ต้องอัปเดตข้อมูล"
            description="ไม่มีราคา หรือราคาเก่า — ตรวจก่อนนำไปทำคอนเทนต์"
            action={
              <Button asChild variant="ghost" size="sm">
                <Link href="/research">
                  ดูทั้งหมด <ArrowRight aria-hidden />
                </Link>
              </Button>
            }
          />
          {attention.data?.length ? (
            <ul className="divide-y rounded-lg border bg-surface">
              {attention.data.map((p) => (
                <li key={p.id}>
                  <Link href={`/products/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset">
                    <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                    {p.price === null ? <TrustBadge status="unavailable" /> : <TrustBadge status="stale" />}
                    <span className="hidden text-xs whitespace-nowrap text-muted-foreground sm:inline">{formatAge(p.retrieved_at ?? p.updated_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed bg-surface px-4 py-6 text-center text-muted-foreground">ข้อมูลราคาครบและเป็นปัจจุบันทั้งหมด</p>
          )}
        </section>

        <section aria-labelledby="imports-h">
          <SectionHeader id="imports-h" title="การนำเข้าล่าสุด" />
          {batches.data?.length ? (
            <ul className="divide-y rounded-lg border bg-surface">
              {batches.data.map((b) => (
                <li key={b.id}>
                  <Link href={`/imports/${b.id}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-surface-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium">{b.file_name}</span>
                      {b.status === "processing" ? (
                        <StatusBadge status="processing" label="ไม่เสร็จ" />
                      ) : b.status === "failed" ? (
                        <StatusBadge status="failed" />
                      ) : b.failed_count > 0 ? (
                        <StatusBadge status="needs_review" label={`${b.failed_count} แถวผิด`} />
                      ) : (
                        <StatusBadge status="completed" />
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      เพิ่ม {b.inserted_count} · อัปเดต {b.updated_count} · ซ้ำ {b.duplicate_count} · ผิด {b.failed_count} จาก {b.total_rows} แถว · {formatDateTime(b.created_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed bg-surface px-4 py-6 text-center text-muted-foreground">ยังไม่เคยนำเข้า CSV</p>
          )}
        </section>
      </div>
    </>
  );
}
