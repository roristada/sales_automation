import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, Td, Th, Tr } from "@/components/shared/data-table";
import { PageHeader, SectionHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { Chip, type Tone } from "@/components/shared/status-badge";
import { formatAge, formatDate, formatDateTime } from "@/features/products/data-value";
import { ResearchNav } from "@/features/research/research-nav";
import { listTrendAdapters } from "@/features/sources/trends";
import type { ConnectionState } from "@/features/sources/types";
import { Sparkline } from "@/features/trends/charts";
import { listLatestSeries } from "@/features/trends/queries";
import { DIRECTION_LABEL, type Direction, GRANULARITY_LABEL, summarizeTrend } from "@/features/trends/summary";
import { DeleteTrendImportButton, TrendUpload } from "@/features/trends/trend-upload";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "เทรนด์" };

const STATE: Record<ConnectionState, { label: string; tone: Tone }> = {
  available: { label: "ใช้งานได้", tone: "success" },
  not_connected: { label: "ยังไม่ได้เชื่อมต่อ", tone: "neutral" },
  not_available: { label: "ยังไม่รองรับ", tone: "neutral" },
};
const DIRECTION_ICON: Record<Direction, typeof TrendingUp> = { rising: TrendingUp, flat: Minus, falling: TrendingDown };

export default async function TrendsPage() {
  const { supabase } = await getCurrentUser();
  const db = supabase!;
  const [{ latest, imports, error }, { data: links }] = await Promise.all([listLatestSeries(db), db.from("product_trend_links").select("keyword")]);
  const linkCount = new Map<string, number>();
  for (const l of links ?? []) linkCount.set(l.keyword, (linkCount.get(l.keyword) ?? 0) + 1);

  return (
    <>
      <PageHeader title="ค้นหาสินค้า" description="สัญญาณความสนใจจาก Google Trends ใช้ประกอบการเลือกสินค้า" />
      <ResearchNav current="/research/trends" />

      <div className="flex flex-col gap-8">
        <section aria-labelledby="trend-sources-h">
          <SectionHeader id="trend-sources-h" title="แหล่งข้อมูลเทรนด์" />
          <ul className="mb-4 divide-y rounded-lg border bg-surface">
            {listTrendAdapters().map((a) => {
              const c = a.connection();
              return (
                <li key={a.key} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <p className="font-medium">{a.label}</p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">{c.note}</p>
                  </div>
                  <Chip tone={STATE[c.state].tone} className="self-start">
                    {STATE[c.state].label}
                  </Chip>
                </li>
              );
            })}
          </ul>
          <TrendUpload />
          <details className="mt-3 max-w-3xl text-[13px]">
            <summary className="cursor-pointer text-primary">วิธีดาวน์โหลดไฟล์จาก Google Trends</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>เปิด trends.google.com แล้วค้นหาคีย์เวิร์ด (เปรียบเทียบได้สูงสุด 5 คำในไฟล์เดียว)</li>
              <li>เลือกประเทศไทยและช่วงเวลา เช่น 12 เดือนที่ผ่านมา</li>
              <li>ที่กราฟ “ความสนใจตามช่วงเวลา” กดปุ่มดาวน์โหลด (ลูกศรลง) จะได้ไฟล์ CSV</li>
              <li>นำเข้าไฟล์นั้นที่นี่ — ค่าเป็นความสนใจเทียบกับจุดสูงสุดในไฟล์เดียวกัน (0–100) จึงเทียบข้ามไฟล์ไม่ได้</li>
            </ol>
          </details>
        </section>

        <section aria-labelledby="keywords-h">
          <SectionHeader id="keywords-h" title="คีย์เวิร์ด" description="แสดงไฟล์ล่าสุดของแต่ละคีย์เวิร์ด แนวโน้มไม่รวมช่วงล่าสุดที่ยังไม่ครบ" />
          {error ? (
            <ErrorState title="โหลดข้อมูลเทรนด์ไม่สำเร็จ" description={error} />
          ) : !latest.length ? (
            <EmptyState title="ยังไม่มีข้อมูลเทรนด์" description="นำเข้าไฟล์ CSV จาก Google Trends เพื่อดูแนวโน้มความสนใจของคีย์เวิร์ด แล้วผูกกับสินค้าได้ในหน้าสินค้า" />
          ) : (
            <DataTable caption="แนวโน้มคีย์เวิร์ด">
              <thead>
                <tr>
                  <Th>คีย์เวิร์ด</Th>
                  <Th hideBelow="sm">
                    <span className="sr-only">กราฟย่อ</span>
                  </Th>
                  <Th numeric>ล่าสุด</Th>
                  <Th>แนวโน้ม</Th>
                  <Th hideBelow="md">ข้อมูล ณ</Th>
                  <Th numeric hideBelow="lg">
                    สินค้าที่ผูก
                  </Th>
                </tr>
              </thead>
              <tbody>
                {latest.map((s) => {
                  const sum = summarizeTrend(s.points, s.granularity, new Date(s.retrievedAt));
                  const Icon = sum.direction ? DIRECTION_ICON[sum.direction] : null;
                  return (
                    <Tr key={s.keyword}>
                      <Td>
                        <span className="font-medium">{s.keyword}</span>
                        <span className="block text-xs text-muted-foreground">
                          {[s.region, GRANULARITY_LABEL[s.granularity], `${formatDate(s.points[0]?.periodStart ?? null)} – ${formatDate(s.points.at(-1)?.periodStart ?? null)}`]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </Td>
                      <Td hideBelow="sm">
                        <Sparkline points={sum.partialDropped ? s.points.slice(0, -1) : s.points} />
                      </Td>
                      <Td numeric>{sum.latest ? (sum.latest.belowOne ? "<1" : sum.latest.value) : "—"}</Td>
                      <Td>
                        {sum.direction && Icon ? (
                          <span className="inline-flex flex-col gap-0.5">
                            <Chip icon={Icon}>{DIRECTION_LABEL[sum.direction]}</Chip>
                            {sum.changePct !== null && (
                              <span className="text-xs text-muted-foreground tabular-nums">
                                {sum.changePct > 0 ? "+" : ""}
                                {sum.changePct}%
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">{sum.note}</span>
                        )}
                      </Td>
                      <Td hideBelow="md" className="whitespace-nowrap text-muted-foreground">
                        <span title={formatDateTime(s.retrievedAt)}>{formatAge(s.retrievedAt)}</span>
                      </Td>
                      <Td numeric hideBelow="lg">
                        {linkCount.get(s.keyword) ?? 0}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </DataTable>
          )}
        </section>

        {imports.length > 0 && (
          <section aria-labelledby="imports-h">
            <SectionHeader id="imports-h" title="ไฟล์ที่นำเข้า" />
            <ul className="max-w-3xl divide-y rounded-lg border bg-surface">
              {imports.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{i.file_name ?? "ไม่มีชื่อไฟล์"}</p>
                    <p className="text-xs text-muted-foreground">
                      {i.keywords.join(", ")} · นำเข้า {formatDateTime(i.created_at)}
                    </p>
                  </div>
                  <DeleteTrendImportButton id={i.id} label={i.file_name ?? i.keywords.join(", ")} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
