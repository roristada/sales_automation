import { Clapperboard, ExternalLink, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyButton } from "@/components/shared/copy-button";
import { DataTable, Td, Th, Tr } from "@/components/shared/data-table";
import { PageHeader, SectionHeader } from "@/components/shared/page-header";
import { EmptyState, Notice } from "@/components/shared/states";
import { Chip, StatusBadge, TrustBadge } from "@/components/shared/status-badge";
import { FactsEditor } from "@/features/content/facts-editor";
import { getTemplate } from "@/features/content/templates";
import { Button } from "@/components/ui/button";
import { DataValue, formatAge, formatDate, formatDateTime, formatPercent, formatTHB } from "@/features/products/data-value";
import { DeleteProductButton } from "@/features/products/delete-button";
import { fieldStatus, type Provenance, SOURCE_LABEL, STALE_AFTER_DAYS, type TrackedField } from "@/features/products/schema";
import { CONFIDENCE_LABEL, computeOpportunityScore, effectiveConfidence } from "@/features/research/opportunity-score";
import { ScoreBar } from "@/features/research/score-view";
import { TrendChart } from "@/features/trends/charts";
import { TrendKeywordPicker } from "@/features/trends/keyword-picker";
import { listLatestSeries } from "@/features/trends/queries";
import { DIRECTION_LABEL, GRANULARITY_LABEL, summarizeTrend, windowLabel } from "@/features/trends/summary";
import type { Tables } from "@/lib/supabase/database.types";
import { getCurrentUser } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "รายละเอียดสินค้า" };

const TABS = [
  { key: "overview", label: "ภาพรวม" },
  { key: "facts", label: "ข้อเท็จจริง" },
  { key: "content", label: "คอนเทนต์" },
  { key: "score", label: "คะแนนโอกาส" },
  { key: "trends", label: "สัญญาณเทรนด์" },
  { key: "source", label: "แหล่งข้อมูลและประวัติ" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const FIELD_LABEL: Record<TrackedField, string> = {
  name: "ชื่อสินค้า",
  product_url: "ลิงก์สินค้า",
  affiliate_url: "ลิงก์ Affiliate",
  marketplace: "Marketplace",
  category: "หมวดหมู่",
  price: "ราคา",
  commission_rate: "อัตราค่าคอม",
  commission_amount: "ค่าคอมต่อชิ้น",
  image_url: "รูปภาพ",
  description: "รายละเอียด",
};

function ExternalUrl({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-w-0 items-center gap-1 text-primary hover:underline">
      <span className="truncate">{href}</span>
      <ExternalLink className="size-3.5 shrink-0" aria-hidden />
      <span className="sr-only">(เปิดในแท็บใหม่)</span>
    </a>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 tabular-nums">{children}</dd>
    </div>
  );
}

export default async function ProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ id }, { tab: rawTab }] = await Promise.all([params, searchParams]);
  const tab: TabKey = TABS.some((t) => t.key === rawTab) ? (rawTab as TabKey) : "overview";
  const { supabase } = await getCurrentUser();
  const { data: p } = await supabase!.from("products").select("*").eq("id", id).maybeSingle();
  if (!p) notFound();

  const row = { ...p, provenance: p.provenance as Provenance };
  const status = (f: TrackedField) => fieldStatus(row, f);
  const asOf = p.retrieved_at ?? p.updated_at;
  const priceStale = status("price") === "stale" || status("commission_rate") === "stale" || status("commission_amount") === "stale";

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "สินค้า", href: "/products" }, { label: p.name }]}
        title={p.name}
        meta={
          <>
            <Chip>{SOURCE_LABEL[p.source]}</Chip>
            {p.marketplace && <span>{p.marketplace}</span>}
            {p.source_product_id && <span>รหัส {p.source_product_id}</span>}
          </>
        }
        actions={
          <>
            <DeleteProductButton id={id} name={p.name} />
            <Button asChild variant="outline">
              <Link href={`/content/new?product=${id}`}>
                <Clapperboard aria-hidden /> สร้างคอนเทนต์
              </Link>
            </Button>
            <Button asChild>
              <Link href={`/products/${id}/edit`}>
                <Pencil aria-hidden /> แก้ไขข้อมูล
              </Link>
            </Button>
          </>
        }
      />

      {/* Summary: key facts with source and freshness next to them (design.md §9.3). */}
      <section aria-label="สรุปสินค้า" className="mb-6 grid gap-6 rounded-lg border bg-surface p-4 sm:grid-cols-[120px_1fr] sm:p-5">
        <div className="w-24 overflow-hidden rounded-md border bg-surface-muted sm:w-auto">
          {p.image_url ? (
            // External marketplace images: plain <img> avoids configuring remote hosts for next/image.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.image_url} alt={p.name} className="aspect-square w-full object-contain" referrerPolicy="no-referrer" />
          ) : (
            <div className="flex aspect-square items-center justify-center text-xs text-muted-foreground">ไม่มีรูปภาพ</div>
          )}
        </div>
        <div className="min-w-0">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
            <Fact label="ราคา">
              <DataValue value={formatTHB(p.price)} status={status("price")} alwaysTag />
            </Fact>
            <Fact label="อัตราค่าคอม">
              <DataValue value={formatPercent(p.commission_rate)} status={status("commission_rate")} alwaysTag />
            </Fact>
            <Fact label="ค่าคอมต่อชิ้น">
              <DataValue value={formatTHB(p.commission_amount)} status={status("commission_amount")} alwaysTag />
            </Fact>
            <Fact label="ข้อมูล ณ">
              <span title={formatDateTime(asOf)}>{formatAge(asOf)}</span>
              {!p.retrieved_at && <span className="block text-xs text-muted-foreground">ไม่ทราบวันที่ดึงข้อมูล ใช้วันที่แก้ไขล่าสุด</span>}
            </Fact>
          </dl>
          <div className="mt-5 flex flex-col gap-1.5">
            <p className="text-xs text-muted-foreground">ลิงก์ Affiliate</p>
            {p.affiliate_url ? (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <ExternalUrl href={p.affiliate_url} />
                <CopyButton value={p.affiliate_url} label="คัดลอกลิงก์" />
              </div>
            ) : (
              <p className="flex items-center gap-2 text-muted-foreground">
                — <TrustBadge status="unavailable" />
                <Link href={`/products/${id}/edit`} className="text-[13px] text-primary hover:underline">
                  เพิ่มลิงก์
                </Link>
              </p>
            )}
          </div>
        </div>
      </section>

      {priceStale && (
        <Notice tone="warning" className="mb-6">
          ราคาหรือค่าคอมเก่ากว่า {STALE_AFTER_DAYS} วัน ตรวจสอบกับแหล่งข้อมูลก่อนนำไปใช้ในคอนเทนต์ —{" "}
          <Link href={`/products/${id}/edit`} className="font-medium text-primary hover:underline">
            อัปเดตข้อมูล
          </Link>{" "}
          หรือนำเข้า CSV รอบใหม่
        </Notice>
      )}

      <nav aria-label="ส่วนของหน้า" className="mb-5 flex gap-1 border-b">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "overview" ? `/products/${id}` : `/products/${id}?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            scroll={false}
            className={cn(
              "-mb-px border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              tab === t.key && "border-primary text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "overview" ? (
        <OverviewTab p={p} status={status} />
      ) : tab === "score" ? (
        <ScoreTab p={row} stale={priceStale} />
      ) : tab === "trends" ? (
        <TrendsTab id={id} />
      ) : tab === "facts" ? (
        <FactsTab id={id} />
      ) : tab === "content" ? (
        <ContentTab id={id} />
      ) : (
        <SourceTab id={id} p={p} status={status} />
      )}
    </>
  );
}

type Product = Tables<"products">;

function OverviewTab({ p, status }: { p: Product; status: (f: TrackedField) => ReturnType<typeof fieldStatus> }) {
  return (
    <dl className="max-w-3xl divide-y rounded-lg border bg-surface">
      {[
        { label: "ลิงก์สินค้า", node: p.product_url ? <ExternalUrl href={p.product_url} /> : null, field: "product_url" as const },
        { label: "หมวดหมู่", node: p.category, field: "category" as const },
        { label: "รายละเอียด", node: p.description ? <span className="whitespace-pre-wrap">{p.description}</span> : null, field: "description" as const },
      ].map((r) => (
        <div key={r.label} className="grid gap-1 px-4 py-3 sm:grid-cols-[160px_1fr]">
          <dt className="text-muted-foreground">{r.label}</dt>
          <dd className="min-w-0">
            <DataValue value={r.node} status={status(r.field)} />
          </dd>
        </div>
      ))}
      <div className="grid gap-1 px-4 py-3 sm:grid-cols-[160px_1fr]">
        <dt className="text-muted-foreground">หมายเหตุ</dt>
        <dd className="whitespace-pre-wrap">{p.notes || <span className="text-muted-foreground">—</span>}</dd>
      </div>
    </dl>
  );
}

/** Opportunity Score breakdown, recomputed live from the product (design.md §9.2). */
function ScoreTab({ p, stale }: { p: Product & { provenance: Provenance }; stale: boolean }) {
  const r = computeOpportunityScore(p);
  const confidence = effectiveConfidence(r.confidence, stale);
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <section aria-labelledby="score-h" className="rounded-lg border bg-surface p-4 sm:p-5">
        <h2 id="score-h" className="text-xs text-muted-foreground">
          คะแนนโอกาส
        </h2>
        {r.score === null ? (
          <>
            <p className="mt-1 text-lg font-semibold">ข้อมูลไม่พอ</p>
            <p className="mt-1 text-muted-foreground">
              ต้องมีอัตราค่าคอมหรือค่าคอมต่อชิ้นอย่างน้อยหนึ่งค่า —{" "}
              <Link href={`/products/${p.id}/edit`} className="text-primary hover:underline">
                เพิ่มข้อมูล
              </Link>
            </p>
          </>
        ) : (
          <>
            <p className="mt-1 flex items-baseline gap-2">
              <span className="text-3xl font-semibold tabular-nums">{r.score}</span>
              <span className="text-muted-foreground">/ 100</span>
            </p>
            <p className="mt-1 text-[13px]">
              {CONFIDENCE_LABEL[confidence!]}
              {stale && <span className="text-warning"> (ลดลงเพราะราคาหรือค่าคอมเก่ากว่า {STALE_AFTER_DAYS} วัน)</span>}
            </p>
          </>
        )}
        <p className="mt-3 text-[13px] text-muted-foreground">ใช้เปรียบเทียบสินค้าจากข้อมูลที่มีอยู่ ไม่ใช่การรับประกันหรือคาดการณ์ยอดขาย</p>
      </section>

      <section aria-labelledby="components-h">
        <SectionHeader id="components-h" title="องค์ประกอบของคะแนน" description="ส่วนที่ไม่มีข้อมูลจะไม่ถูกนับ และไม่มีการเติมค่าแทน" />
        <ul className="divide-y rounded-lg border bg-surface">
          {r.components.map((c) => (
            <li key={c.key} className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_160px] sm:items-center">
              <div className="min-w-0">
                <p className="font-medium">
                  {c.label} <span className="text-xs font-normal text-muted-foreground">น้ำหนัก {c.weight}%</span>
                </p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">{c.evidence}</p>
              </div>
              {c.score === null ? (
                <span className="justify-self-start sm:justify-self-end">
                  <TrustBadge status="unavailable" />
                </span>
              ) : (
                <div className="flex items-center gap-2">
                  <ScoreBar value={c.score} label={c.label} />
                  <span className="w-8 text-right tabular-nums">{c.score}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {r.missing.length > 0 && (
        <section aria-labelledby="missing-h">
          <SectionHeader id="missing-h" title="ข้อมูลที่ยังขาด" description="เพิ่มข้อมูลเหล่านี้เพื่อให้คะแนนครบและน่าเชื่อถือขึ้น" />
          <ul className="list-disc pl-5 text-[13px]">
            {r.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="limits-h">
        <SectionHeader id="limits-h" title="ข้อจำกัด" />
        <ul className="list-disc pl-5 text-[13px] text-muted-foreground">
          {r.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">สูตรคะแนนเวอร์ชัน {r.version}</p>
      </section>
    </div>
  );
}

/** Facts scripts may state about this product (M3). */
async function FactsTab({ id }: { id: string }) {
  const { supabase } = await getCurrentUser();
  const { data: facts, error } = await supabase!.from("product_facts").select("id, label, value, status, source_url").eq("product_id", id).order("position").order("created_at");
  if (error) return <Notice tone="error">โหลดข้อเท็จจริงไม่สำเร็จ: {error.message}</Notice>;
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-[13px] text-muted-foreground">
        สคริปต์จะพูดถึงคุณสมบัติของสินค้าได้เฉพาะที่อยู่ในรายการนี้ (และราคา ชื่อ หมวดหมู่ของสินค้า) ทุก claim ต้องอ้างอิงข้อเท็จจริงก่อนอนุมัติ — เขียนตามที่ตรวจสอบได้ และใส่ลิงก์แหล่งที่มาถ้ามี
      </p>
      <FactsEditor productId={id} facts={facts ?? []} />
    </div>
  );
}

/** Content projects for this product. */
async function ContentTab({ id }: { id: string }) {
  const { supabase } = await getCurrentUser();
  const { data: projects, error } = await supabase!
    .from("content_projects")
    .select("id, title, updated_at, storyboards(id, version, status, template_id)")
    .eq("product_id", id)
    .order("updated_at", { ascending: false });
  if (error) return <Notice tone="error">โหลดคอนเทนต์ไม่สำเร็จ: {error.message}</Notice>;
  if (!projects.length) {
    return (
      <EmptyState
        title="ยังไม่มีคอนเทนต์ของสินค้านี้"
        description="เพิ่มข้อเท็จจริงของสินค้าก่อน แล้วสร้างสคริปต์จาก template"
        action={
          <Button asChild>
            <Link href={`/content/new?product=${id}`}>
              <Clapperboard aria-hidden /> สร้างคอนเทนต์
            </Link>
          </Button>
        }
      />
    );
  }
  return (
    <ul className="max-w-3xl divide-y rounded-lg border bg-surface">
      {projects.map((pr) => {
        const latest = [...pr.storyboards].sort((a, b) => b.version - a.version)[0];
        return (
          <li key={pr.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              {latest ? (
                <Link href={`/studio/${latest.id}`} className="font-medium hover:underline">
                  {pr.title}
                </Link>
              ) : (
                <span className="font-medium">{pr.title}</span>
              )}
              <p className="text-xs text-muted-foreground">
                {latest ? `${getTemplate(latest.template_id)?.name ?? latest.template_id} · เวอร์ชัน ${latest.version} · ` : ""}แก้ไข {formatAge(pr.updated_at)}
              </p>
            </div>
            {latest && <StatusBadge status={latest.status === "approved" ? "approved" : "draft"} />}
          </li>
        );
      })}
    </ul>
  );
}

/** Trend signal for the keyword the user linked to this product (design.md §9.3). */
async function TrendsTab({ id }: { id: string }) {
  const { supabase } = await getCurrentUser();
  const db = supabase!;
  const { data: link } = await db.from("product_trend_links").select("keyword").eq("product_id", id).maybeSingle();
  const { latest, imports, error } = await listLatestSeries(db, link?.keyword);
  const keywords = [...new Set(imports.flatMap((i) => i.keywords))].sort((a, b) => a.localeCompare(b, "th"));
  const series = link ? latest.find((s) => s.keyword === link.keyword) : undefined;

  if (error) return <Notice tone="error">โหลดข้อมูลเทรนด์ไม่สำเร็จ: {error}</Notice>;
  if (!keywords.length) {
    return (
      <EmptyState
        title="ยังไม่มีข้อมูลเทรนด์"
        description="นำเข้าไฟล์ CSV จาก Google Trends ก่อน แล้วกลับมาเลือกคีย์เวิร์ดที่ตรงกับสินค้านี้"
        action={
          <Button asChild variant="outline">
            <Link href="/research/trends">ไปที่หน้าเทรนด์</Link>
          </Button>
        }
      />
    );
  }

  const sum = series ? summarizeTrend(series.points, series.granularity, new Date(series.retrievedAt)) : null;
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <TrendKeywordPicker productId={id} keywords={keywords} current={link?.keyword ?? null} />
      {!link ? (
        <p className="text-muted-foreground">ยังไม่ได้ผูกคีย์เวิร์ด — สัญญาณเทรนด์ของสินค้านี้จึงเป็น “ไม่มีข้อมูล”</p>
      ) : !series || !sum ? (
        <Notice tone="warning">ไม่พบข้อมูลของคีย์เวิร์ด “{link.keyword}” แล้ว (ไฟล์อาจถูกลบ) — เลือกคีย์เวิร์ดใหม่หรือนำเข้าไฟล์อีกครั้ง</Notice>
      ) : (
        <section aria-labelledby="trend-h" className="rounded-lg border bg-surface p-4 sm:p-5">
          <h2 id="trend-h" className="font-semibold">
            {series.keyword}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[series.region, GRANULARITY_LABEL[series.granularity], series.category, `ข้อมูล ณ ${formatDateTime(series.retrievedAt)}`].filter(Boolean).join(" · ")}
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            <Fact label="ล่าสุด">{sum.latest ? `${sum.latest.belowOne ? "<1" : sum.latest.value} / 100` : "—"}</Fact>
            <Fact label="แนวโน้ม">
              {sum.direction ? DIRECTION_LABEL[sum.direction] : "—"}
              {sum.changePct !== null && <span className="text-muted-foreground"> ({sum.changePct > 0 ? "+" : ""}{sum.changePct}%)</span>}
            </Fact>
            <Fact label="สูงสุดในไฟล์">{sum.peak ? formatDate(sum.peak.periodStart) : "—"}</Fact>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">{sum.note ?? `แนวโน้ม: ค่าเฉลี่ย ${windowLabel(sum.window, series.granularity)}`}</p>
          <div className="mt-4">
            <TrendChart points={series.points} label={series.keyword} partial={sum.partialDropped} />
          </div>
          {Date.now() - Date.parse(series.retrievedAt) > STALE_AFTER_DAYS * 86_400_000 && (
            <Notice tone="warning" className="mt-4">
              ข้อมูลเทรนด์นี้เก่ากว่า {STALE_AFTER_DAYS} วัน — ดาวน์โหลดจาก Google Trends ใหม่เพื่อดูแนวโน้มปัจจุบัน
            </Notice>
          )}
        </section>
      )}
      <p className="text-[13px] text-muted-foreground">สัญญาณเทรนด์ยังไม่ถูกนำไปคิดในคะแนนโอกาส ใช้ประกอบการตัดสินใจแยกต่างหาก</p>
    </div>
  );
}

async function SourceTab({ id, p, status }: { id: string; p: Product; status: (f: TrackedField) => ReturnType<typeof fieldStatus> }) {
  const { supabase } = await getCurrentUser();
  const [{ data: history, error }, batch] = await Promise.all([
    supabase!
      .from("product_price_history")
      .select("id, price, commission_rate, commission_amount, source, recorded_at")
      .eq("product_id", id)
      .order("recorded_at", { ascending: false })
      .limit(50),
    p.import_batch_id ? supabase!.from("import_batches").select("id, file_name, created_at").eq("id", p.import_batch_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="provenance-h">
        <SectionHeader id="provenance-h" title="สถานะข้อมูลรายฟิลด์" description="แต่ละค่ามาจากไหน ค่าที่ไม่มีจะแสดงเป็น “ไม่มีข้อมูล” ไม่ใช่ 0" />
        <DataTable caption="สถานะข้อมูลรายฟิลด์" className="max-w-2xl">
          <thead>
            <tr>
              <Th>ฟิลด์</Th>
              <Th>สถานะ</Th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(FIELD_LABEL) as TrackedField[]).map((f) => (
              <Tr key={f}>
                <Td>{FIELD_LABEL[f]}</Td>
                <Td>
                  <TrustBadge status={status(f)} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
        <dl className="mt-3 grid max-w-2xl gap-1 text-[13px] text-muted-foreground sm:grid-cols-2">
          <div>
            <dt className="inline">สร้างเมื่อ </dt>
            <dd className="inline">{formatDateTime(p.created_at)}</dd>
          </div>
          <div>
            <dt className="inline">แก้ไขล่าสุด </dt>
            <dd className="inline">{formatDateTime(p.updated_at)}</dd>
          </div>
          <div>
            <dt className="inline">ข้อมูลจากแหล่ง ณ </dt>
            <dd className="inline">{formatDateTime(p.retrieved_at)}</dd>
          </div>
          {batch.data && (
            <div>
              <dt className="inline">นำเข้าล่าสุดจาก </dt>
              <dd className="inline">
                <Link href={`/imports/${batch.data.id}`} className="text-primary hover:underline">
                  {batch.data.file_name}
                </Link>
              </dd>
            </div>
          )}
        </dl>
      </section>

      <section aria-labelledby="history-h">
        <SectionHeader id="history-h" title="ประวัติราคาและค่าคอม" description="บันทึกอัตโนมัติทุกครั้งที่ราคาหรือค่าคอมเปลี่ยน" />
        {error ? (
          <Notice tone="error">โหลดประวัติไม่สำเร็จ: {error.message}</Notice>
        ) : history?.length ? (
          <DataTable caption="ประวัติราคาและค่าคอม">
            <thead>
              <tr>
                <Th>บันทึกเมื่อ</Th>
                <Th numeric>ราคา</Th>
                <Th numeric>อัตราค่าคอม</Th>
                <Th numeric hideBelow="sm">
                  ค่าคอมต่อชิ้น
                </Th>
                <Th hideBelow="md">แหล่ง</Th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <Tr key={h.id}>
                  <Td className="whitespace-nowrap">{formatDateTime(h.recorded_at)}</Td>
                  <Td numeric>{formatTHB(h.price)}</Td>
                  <Td numeric>{formatPercent(h.commission_rate)}</Td>
                  <Td numeric hideBelow="sm">
                    {formatTHB(h.commission_amount)}
                  </Td>
                  <Td hideBelow="md">{SOURCE_LABEL[h.source]}</Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        ) : (
          <p className="text-muted-foreground">ยังไม่มีประวัติ</p>
        )}
      </section>
    </div>
  );
}
