import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, Td, Th, Tr } from "@/components/shared/data-table";
import { PageHeader, SectionHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, Notice } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { AnalyticsUpload, DeleteImportButton, RematchButton } from "@/features/analytics/analytics-upload";
import type { ConversionStatus } from "@/features/analytics/csv";
import { summarize } from "@/features/analytics/summary";
import { type Platform, PLATFORM_LABEL } from "@/features/content/templates";
import { formatDate, formatDateTime } from "@/features/products/data-value";
import { PUBLICATION_BADGE, PUBLICATION_STATUS_LABEL, type PublicationStatus } from "@/features/publishing/publishing";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Analytics" };

const thb = (n: number) => new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", minimumFractionDigits: 2 }).format(n);
const int = (n: number | null | undefined) => (n == null ? null : n.toLocaleString("th-TH"));
const NA = <span className="text-muted-foreground">ไม่มีข้อมูล</span>;

export default async function AnalyticsPage() {
  const { supabase } = await getCurrentUser();
  const db = supabase!;
  const [pubs, metrics, conversions, costs, imports] = await Promise.all([
    db
      .from("publications")
      .select("id, project_id, platform, status, published_at, project:content_projects(title, product:products(name))")
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(1000),
    db.from("post_metrics").select("publication_id, post_key, captured_on, views, likes, comments, shares, saves, avg_watch_s").limit(20_000),
    db.from("affiliate_conversions").select("publication_id, status, commission_thb, order_value_thb").limit(20_000),
    db.rpc("project_costs"),
    db.from("performance_imports").select("id, kind, file_name, total_rows, saved_rows, matched_rows, failed_rows, created_at").order("created_at", { ascending: false }).limit(50),
  ]);
  const failed = [pubs, metrics, conversions, costs, imports].find((r) => r.error);

  const header = <PageHeader title="Analytics" description="ผลของวิดีโอจากไฟล์ที่ส่งออกจากแพลตฟอร์มและ Shopee Affiliate — แสดงเฉพาะตัวเลขที่มีในไฟล์" />;
  if (failed?.error) {
    return (
      <>
        {header}
        <ErrorState title="โหลดข้อมูลไม่สำเร็จ" description={failed.error.message} />
      </>
    );
  }

  const { byPublication, totals } = summarize({
    publications: (pubs.data ?? []).map((p) => ({ id: p.id, projectId: p.project_id })),
    metrics: (metrics.data ?? []).map((m) => ({
      publicationId: m.publication_id,
      postKey: m.post_key,
      capturedOn: m.captured_on,
      views: m.views,
      likes: m.likes,
      comments: m.comments,
      shares: m.shares,
      saves: m.saves,
      avgWatchS: m.avg_watch_s,
    })),
    conversions: (conversions.data ?? []).map((c) => ({ publicationId: c.publication_id, status: c.status as ConversionStatus, commission: c.commission_thb, orderValue: c.order_value_thb })),
    projectCosts: new Map((costs.data ?? []).map((c) => [c.project_id, Number(c.cost_thb)])),
  });
  const hasConversions = (conversions.data?.length ?? 0) > 0;
  const hasMetrics = (metrics.data?.length ?? 0) > 0;
  // Videos worth a row: posted, or with any numbers attached.
  const rows = (pubs.data ?? [])
    .map((p) => ({ p, r: byPublication.get(p.id)! }))
    .filter(({ p, r }) => p.status === "published" || p.status === "withdrawn" || r.latest || Object.values(r.commission).some((m) => m.orders > 0))
    .sort((a, b) => b.r.commission.completed.commission - a.r.commission.completed.commission || (b.r.latest?.views ?? -1) - (a.r.latest?.views ?? -1));

  const summary = [
    { label: "ค่าคอมยืนยันแล้ว (ทั้งหมดในรายงาน)", value: hasConversions ? thb(totals.all.completed.commission) : null, hint: hasConversions ? `${int(totals.all.completed.orders)} รายการ` : null },
    { label: "มาจากวิดีโอในระบบ", value: hasConversions ? thb(totals.attributed.completed.commission) : null, hint: hasConversions ? "จับคู่ด้วยรหัสติดตามใน Sub_id" : null },
    { label: "ไม่ระบุวิดีโอ", value: hasConversions ? thb(totals.unattributed.completed.commission) : null, hint: hasConversions ? "นับในยอดรวม ไม่นับให้วิดีโอใด" : null },
    { label: "รอยืนยัน", value: hasConversions ? thb(totals.all.pending.commission) : null, hint: hasConversions ? `${int(totals.all.pending.orders)} รายการ · อาจถูกยกเลิก` : null },
    { label: "ค่าใช้จ่าย render (ประมาณ)", value: thb(totals.cost), hint: "จากบันทึกการใช้งาน" },
  ];

  return (
    <>
      {header}

      <dl className="mb-8 flex flex-wrap gap-x-8 gap-y-4 border-b pb-6">
        {summary.map((s) => (
          <div key={s.label}>
            <dt className="text-[13px] text-muted-foreground">{s.label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{s.value ?? <span className="text-base font-normal text-muted-foreground">ไม่มีข้อมูล</span>}</dd>
            {s.hint && <dd className="text-xs text-muted-foreground">{s.hint}</dd>}
          </div>
        ))}
      </dl>
      {!hasConversions && (
        <Notice tone="info" className="-mt-4 mb-8">
          ยังไม่มีรายงาน Conversion — นำเข้า CSV จาก Shopee Affiliate ด้านล่าง ค่าคอมจะนับให้วิดีโอเมื่อคำสั่งซื้อมีรหัสติดตามของวิดีโอนั้นใน Sub_id (ดูรหัสได้ในหน้าเผยแพร่ของแต่ละวิดีโอ)
        </Notice>
      )}

      <section aria-labelledby="videos-h" className="mb-10">
        <SectionHeader
          id="videos-h"
          title="ผลรายวิดีโอ"
          description={`ตัวเลขโพสต์เป็นยอดสะสม ณ วันที่ในไฟล์ล่าสุด${totals.unmatchedPosts ? ` · ${int(totals.unmatchedPosts)} โพสต์ในไฟล์ไม่ตรงกับวิดีโอในระบบ (ไม่นับ)` : ""}`}
          action={hasMetrics || hasConversions ? <RematchButton /> : undefined}
        />
        {!rows.length ? (
          <EmptyState title="ยังไม่มีวิดีโอที่เผยแพร่" description="บันทึกลิงก์โพสต์ในหน้าเผยแพร่ก่อน แล้วนำเข้าไฟล์ผลโพสต์ ระบบจะจับคู่จากลิงก์หรือรหัสวิดีโอ" />
        ) : (
          <DataTable caption="ผลรายวิดีโอ">
            <thead>
              <tr>
                <Th>วิดีโอ</Th>
                <Th numeric>ยอดดู</Th>
                <Th hideBelow="lg" numeric>
                  ถูกใจ
                </Th>
                <Th hideBelow="lg" numeric>
                  ความคิดเห็น
                </Th>
                <Th hideBelow="lg" numeric>
                  แชร์
                </Th>
                <Th hideBelow="md" numeric>
                  ดูเฉลี่ย
                </Th>
                <Th numeric>ค่าคอมยืนยัน</Th>
                <Th hideBelow="md" numeric>
                  ค่าใช้จ่าย
                </Th>
                <Th hideBelow="sm" numeric>
                  สุทธิ
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, r }) => {
                const status = p.status as PublicationStatus;
                const c = r.commission;
                return (
                  <Tr key={p.id}>
                    <Td className="max-w-[320px]">
                      <Link href={`/publishing/${p.id}`} className="line-clamp-2 font-medium hover:underline">
                        {p.project?.title}
                      </Link>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        {PLATFORM_LABEL[p.platform as Platform]}
                        {status !== "published" && <StatusBadge status={PUBLICATION_BADGE[status]} label={PUBLICATION_STATUS_LABEL[status]} />}
                      </span>
                    </Td>
                    <Td numeric>
                      {r.latest?.views != null ? (
                        <>
                          {int(r.latest.views)}
                          <span className="block text-xs text-muted-foreground">ณ {formatDate(r.latest.capturedOn)}</span>
                        </>
                      ) : (
                        NA
                      )}
                    </Td>
                    <Td hideBelow="lg" numeric>
                      {int(r.latest?.likes) ?? NA}
                    </Td>
                    <Td hideBelow="lg" numeric>
                      {int(r.latest?.comments) ?? NA}
                    </Td>
                    <Td hideBelow="lg" numeric>
                      {int(r.latest?.shares) ?? NA}
                    </Td>
                    <Td hideBelow="md" numeric>
                      {r.latest?.avgWatchS != null ? `${r.latest.avgWatchS.toFixed(1)} วิ` : NA}
                    </Td>
                    <Td numeric>
                      {hasConversions ? (
                        <>
                          {thb(c.completed.commission)}
                          <span className="block text-xs text-muted-foreground">
                            {c.completed.orders} รายการ{c.pending.orders ? ` · รอ ${thb(c.pending.commission)}` : ""}
                          </span>
                        </>
                      ) : (
                        NA
                      )}
                    </Td>
                    <Td hideBelow="md" numeric>
                      {r.cost != null ? (
                        <>
                          {thb(r.cost)}
                          {r.costShared && <span className="block text-xs text-muted-foreground">รวมทุกแพลตฟอร์มของคอนเทนต์นี้</span>}
                        </>
                      ) : (
                        NA
                      )}
                    </Td>
                    <Td hideBelow="sm" numeric>
                      {r.net != null ? <span className={r.net < 0 ? "text-destructive" : undefined}>{thb(r.net)}</span> : <span className="text-muted-foreground">—</span>}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          สุทธิ = ค่าคอมยืนยันแล้ว − ค่าใช้จ่าย render ของคอนเทนต์ แสดงเมื่อคอนเทนต์โพสต์แพลตฟอร์มเดียวและมีคำสั่งซื้อที่จับคู่ได้ · ยอดดูไม่ได้แปลว่ามีคนซื้อ และค่าคอมที่ “ไม่ระบุวิดีโอ”
          อาจมาจากวิดีโอเหล่านี้ก็ได้
        </p>
      </section>

      <section aria-labelledby="imports-h">
        <SectionHeader id="imports-h" title="นำเข้าข้อมูล" description="ไฟล์เดิมนำเข้าซ้ำได้: ผลโพสต์วันเดียวกันจะแทนที่ค่าเดิม คำสั่งซื้อเดิมจะอัปเดตสถานะ" />
        <div className="mb-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border bg-surface p-4 text-[13px]">
            <h3 className="mb-1 font-semibold">ผลโพสต์</h3>
            <p className="mb-3 text-muted-foreground">
              CSV ที่มีคอลัมน์ลิงก์โพสต์หรือรหัสวิดีโอ และตัวเลขอย่างยอดดู/ถูกใจ — จาก TikTok Studio, YouTube Studio, Instagram หรือทำเองใน Sheets ถ้าไม่มีคอลัมน์วันที่ จะใช้วันที่ของไฟล์
            </p>
            <AnalyticsUpload kind="post_metrics" />
          </div>
          <div className="rounded-lg border bg-surface p-4 text-[13px]">
            <h3 className="mb-1 font-semibold">คำสั่งซื้อและค่าคอม</h3>
            <p className="mb-3 text-muted-foreground">
              รายงาน Conversion จาก Shopee Affiliate (ต้องมี Order ID และ Commission) ใส่รหัสติดตามของวิดีโอใน Sub_id ตอนสร้างลิงก์ เพื่อให้นับค่าคอมให้วิดีโอนั้น
            </p>
            <AnalyticsUpload kind="affiliate_conversions" />
          </div>
        </div>
        {imports.data && imports.data.length > 0 && (
          <DataTable caption="ไฟล์ที่นำเข้า">
            <thead>
              <tr>
                <Th>ไฟล์</Th>
                <Th hideBelow="sm">ประเภท</Th>
                <Th numeric>บันทึก</Th>
                <Th hideBelow="md" numeric>
                  จับคู่ได้
                </Th>
                <Th hideBelow="md" numeric>
                  ข้าม
                </Th>
                <Th hideBelow="sm">นำเข้าเมื่อ</Th>
                <Th>
                  <span className="sr-only">การทำงาน</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {imports.data.map((i) => (
                <Tr key={i.id}>
                  <Td className="max-w-[260px] truncate">{i.file_name}</Td>
                  <Td hideBelow="sm">{i.kind === "post_metrics" ? "ผลโพสต์" : "Conversion"}</Td>
                  <Td numeric>{int(i.saved_rows)}</Td>
                  <Td hideBelow="md" numeric>
                    {int(i.matched_rows)}
                  </Td>
                  <Td hideBelow="md" numeric>
                    {int(i.failed_rows)}
                  </Td>
                  <Td hideBelow="sm" className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(i.created_at)}
                  </Td>
                  <Td className="text-right">
                    <DeleteImportButton id={i.id} label={i.file_name} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>
    </>
  );
}
