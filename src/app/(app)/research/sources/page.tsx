import { Download, FileUp } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, Td, Th, Tr } from "@/components/shared/data-table";
import { PageHeader, SectionHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, Notice } from "@/components/shared/states";
import { Chip, type Tone } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { formatAge, formatDateTime } from "@/features/products/data-value";
import { filtersToQuery } from "@/features/products/filters";
import { type ProductSource, STALE_AFTER_DAYS } from "@/features/products/schema";
import { ResearchNav } from "@/features/research/research-nav";
import { listSourceAdapters } from "@/features/sources/registry";
import type { ConnectionState, SourceMode } from "@/features/sources/types";
import type { Tables } from "@/lib/supabase/database.types";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "แหล่งข้อมูลและความใหม่" };

const STATE: Record<ConnectionState, { label: string; tone: Tone }> = {
  available: { label: "ใช้งานได้", tone: "success" },
  not_connected: { label: "ยังไม่ได้เชื่อมต่อ", tone: "neutral" },
  not_available: { label: "ยังไม่รองรับ", tone: "neutral" },
};
const MODE: Record<SourceMode, string> = { manual: "กรอกในแบบฟอร์ม", file: "นำเข้าไฟล์", api: "ดึงผ่าน API" };

type Freshness = { [K in keyof Tables<"product_freshness">]: NonNullable<Tables<"product_freshness">[K]> };

const researchHref = (source: ProductSource, freshness?: "fresh" | "stale") => `/research${filtersToQuery({ source, freshness })}`;
const exportHref = (source?: ProductSource) => `/research/sources/export${filtersToQuery({ source, freshness: "stale" })}`;

export default async function SourcesPage() {
  const { supabase } = await getCurrentUser();
  const db = supabase!;
  const [{ data, error }, { data: lastImport }] = await Promise.all([
    db.from("product_freshness").select("*"),
    db.from("import_batches").select("id, file_name, created_at").eq("status", "completed").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const freshness = new Map(((data ?? []) as Freshness[]).map((f) => [f.source, f]));
  const adapters = listSourceAdapters();
  const totalStale = [...freshness.values()].reduce((s, f) => s + f.stale, 0);

  return (
    <>
      <PageHeader title="ค้นหาสินค้า" description="สินค้ามาจากไหน เชื่อมต่ออยู่หรือไม่ และข้อมูลใหม่แค่ไหน" />
      <ResearchNav current="/research/sources" />

      <div className="flex flex-col gap-8">
        <section aria-labelledby="sources-h">
          <SectionHeader id="sources-h" title="แหล่งข้อมูลสินค้า" description="สถานะจริงของแต่ละแหล่ง — แหล่งที่ยังไม่เชื่อมต่อจะไม่มีข้อมูลตัวอย่างหรือข้อมูลจำลอง" />
          <ul className="divide-y rounded-lg border bg-surface">
            {adapters.map((a) => {
              const c = a.connection();
              const count = freshness.get(a.key)?.total ?? 0;
              return (
                <li key={a.key} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {a.label} <span className="text-xs font-normal text-muted-foreground">· {MODE[a.mode]}</span>
                    </p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">{c.note}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {count ? (
                        <Link href={researchHref(a.key)} className="text-primary hover:underline">
                          {count.toLocaleString("th-TH")} สินค้า
                        </Link>
                      ) : (
                        "ยังไม่มีสินค้าจากแหล่งนี้"
                      )}
                      {a.key === "csv" && lastImport && (
                        <>
                          {" · นำเข้าล่าสุด "}
                          <Link href={`/imports/${lastImport.id}`} className="text-primary hover:underline" title={formatDateTime(lastImport.created_at)}>
                            {lastImport.file_name}
                          </Link>{" "}
                          ({formatAge(lastImport.created_at)})
                        </>
                      )}
                    </p>
                  </div>
                  <Chip tone={STATE[c.state].tone} className="self-start">
                    {STATE[c.state].label}
                  </Chip>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="freshness-h">
          <SectionHeader
            id="freshness-h"
            title="ความใหม่ของข้อมูล"
            description={`นับจากวันที่ดึงข้อมูลจากแหล่ง (ถ้าไม่มี ใช้วันที่แก้ไขล่าสุด) ราคาและค่าคอมที่เก่ากว่า ${STALE_AFTER_DAYS} วันถือว่าเก่า`}
          />
          {error ? (
            <ErrorState title="โหลดข้อมูลความใหม่ไม่สำเร็จ" description={error.message} />
          ) : !freshness.size ? (
            <EmptyState
              title="ยังไม่มีสินค้า"
              action={
                <Button asChild>
                  <Link href="/products/import">
                    <FileUp aria-hidden /> นำเข้า CSV
                  </Link>
                </Button>
              }
            />
          ) : (
            <DataTable caption="ความใหม่ของข้อมูลแยกตามแหล่ง">
              <thead>
                <tr>
                  <Th>แหล่ง</Th>
                  <Th numeric>ภายใน 3 วัน</Th>
                  <Th numeric hideBelow="sm">
                    4–{STALE_AFTER_DAYS} วัน
                  </Th>
                  <Th numeric>เก่ากว่า {STALE_AFTER_DAYS} วัน</Th>
                  <Th numeric hideBelow="md">
                    ไม่ทราบวันที่ดึง
                  </Th>
                  <Th hideBelow="lg">เก่าที่สุด</Th>
                  <Th hideBelow="sm">
                    <span className="sr-only">การทำงาน</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {adapters
                  .filter((a) => freshness.has(a.key))
                  .map((a) => {
                    const f = freshness.get(a.key)!;
                    return (
                      <Tr key={a.key}>
                        <Td>
                          <span className="font-medium">{a.label}</span>
                          <span className="block text-xs text-muted-foreground">{f.total.toLocaleString("th-TH")} สินค้า</span>
                        </Td>
                        <Td numeric>{f.fresh.toLocaleString("th-TH")}</Td>
                        <Td numeric hideBelow="sm">
                          {f.aging.toLocaleString("th-TH")}
                        </Td>
                        <Td numeric>
                          {f.stale ? (
                            <Link href={researchHref(a.key, "stale")} className="font-medium text-warning hover:underline">
                              {f.stale.toLocaleString("th-TH")}
                            </Link>
                          ) : (
                            "0"
                          )}
                        </Td>
                        <Td numeric hideBelow="md">
                          {f.unknown_date.toLocaleString("th-TH")}
                        </Td>
                        <Td hideBelow="lg" className="whitespace-nowrap text-muted-foreground">
                          <span title={formatDateTime(f.oldest)}>{formatAge(f.oldest)}</span>
                        </Td>
                        <Td hideBelow="sm" className="text-right">
                          {f.stale > 0 && (
                            <Button asChild size="sm" variant="ghost">
                              <a href={exportHref(a.key)} download>
                                <Download aria-hidden /> ส่งออกสินค้าเก่า
                              </a>
                            </Button>
                          )}
                        </Td>
                      </Tr>
                    );
                  })}
              </tbody>
            </DataTable>
          )}
        </section>

        <section aria-labelledby="refresh-h">
          <SectionHeader id="refresh-h" title="อัปเดตข้อมูลเก่าทั้งชุด" description="สำหรับแหล่งที่ยังไม่มี API: ส่งออก แก้ในสเปรดชีต แล้วนำเข้ากลับ" />
          {totalStale === 0 ? (
            <Notice tone="success">ไม่มีสินค้าที่ข้อมูลเก่ากว่า {STALE_AFTER_DAYS} วัน</Notice>
          ) : (
            <ol className="flex max-w-3xl flex-col gap-3 text-[13px]">
              <li className="flex flex-col gap-2 rounded-lg border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  <span className="font-medium">1. ส่งออกสินค้าเก่า {totalStale.toLocaleString("th-TH")} รายการ</span>
                  <span className="block text-muted-foreground">ไฟล์มีคอลัมน์ System ID ซึ่งใช้จับคู่กับสินค้าเดิม ห้ามแก้คอลัมน์นี้</span>
                </span>
                <Button asChild variant="outline" size="sm" className="self-start sm:self-auto">
                  <a href={exportHref()} download>
                    <Download aria-hidden /> ส่งออก CSV
                  </a>
                </Button>
              </li>
              <li className="rounded-lg border bg-surface p-4">
                <span className="font-medium">2. แก้ราคาและค่าคอมให้ตรงกับแหล่งข้อมูลปัจจุบัน</span>
                <span className="block text-muted-foreground">
                  ใส่วันที่ตรวจสอบในคอลัมน์ Retrieved (เช่น {new Date().toISOString().slice(0, 10)}) ไม่เช่นนั้นข้อมูลจะยังนับว่าเก่า ช่องที่เว้นว่างจะไม่ลบค่าเดิม
                </span>
              </li>
              <li className="flex flex-col gap-2 rounded-lg border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  <span className="font-medium">3. นำเข้าไฟล์ด้วยโหมดอัปเดต</span>
                  <span className="block text-muted-foreground">ระบบบันทึกประวัติราคาและคำนวณคะแนนโอกาสใหม่ให้อัตโนมัติ</span>
                </span>
                <Button asChild size="sm" className="self-start sm:self-auto">
                  <Link href="/products/import?mode=update">
                    <FileUp aria-hidden /> นำเข้าไฟล์ที่แก้แล้ว
                  </Link>
                </Button>
              </li>
            </ol>
          )}
        </section>
      </div>
    </>
  );
}
