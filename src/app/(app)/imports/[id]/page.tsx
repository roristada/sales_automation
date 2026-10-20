import { FileUp } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DataTable, Td, Th, Tr } from "@/components/shared/data-table";
import { PageHeader, SectionHeader } from "@/components/shared/page-header";
import { Notice } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import type { RowError } from "@/features/products/csv";
import { formatDateTime } from "@/features/products/data-value";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "ผลการนำเข้า" };

export default async function ImportBatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await getCurrentUser();
  const { data: batch } = await supabase!.from("import_batches").select("*").eq("id", id).maybeSingle();
  if (!batch) notFound();
  const { data: errors, count, error } = await supabase!
    .from("import_row_errors")
    .select("id, row_number, raw, errors", { count: "exact" })
    .eq("batch_id", id)
    .order("row_number")
    .limit(500);

  const stats = [
    ["แถวทั้งหมด", batch.total_rows],
    ["เพิ่มใหม่", batch.inserted_count],
    ["อัปเดต", batch.updated_count],
    ["ซ้ำ (ข้าม)", batch.duplicate_count],
    ["ผิดพลาด", batch.failed_count],
  ] as const;
  const processed = batch.inserted_count + batch.updated_count + batch.duplicate_count + batch.failed_count;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "ภาพรวม", href: "/dashboard" }, { label: "ผลการนำเข้า" }]}
        title={batch.file_name}
        meta={
          <>
            {batch.status === "completed" ? <StatusBadge status="completed" /> : batch.status === "failed" ? <StatusBadge status="failed" /> : <StatusBadge status="processing" label="ไม่เสร็จ" />}
            <span>{formatDateTime(batch.created_at)}</span>
            <span>เมื่อพบสินค้าซ้ำ: {batch.duplicate_mode === "skip" ? "ข้าม" : "อัปเดต"}</span>
          </>
        }
        actions={
          <Button asChild variant="outline">
            <Link href="/products/import">
              <FileUp aria-hidden /> นำเข้าไฟล์อื่น
            </Link>
          </Button>
        }
      />

      {batch.status !== "completed" && (
        <Notice tone={batch.status === "failed" ? "error" : "warning"} className="mb-6">
          การนำเข้านี้หยุดก่อนเสร็จ — ประมวลผลแล้ว {processed.toLocaleString()} จาก {batch.total_rows.toLocaleString()} แถว แถวที่บันทึกแล้วยังอยู่ นำเข้าไฟล์เดิมอีกครั้งได้อย่างปลอดภัย (สินค้าซ้ำจะถูกข้ามหรืออัปเดต)
        </Notice>
      )}

      <dl className="mb-8 flex flex-wrap gap-x-8 gap-y-3 border-b pb-6">
        {stats.map(([label, n]) => (
          <div key={label}>
            <dt className="text-[13px] text-muted-foreground">{label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{n.toLocaleString()}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="errors-h">
        <SectionHeader
          id="errors-h"
          title={`แถวที่นำเข้าไม่สำเร็จ${count ? ` (${count.toLocaleString()})` : ""}`}
          description={count ? "แก้ในไฟล์ต้นฉบับแล้วนำเข้าอีกครั้ง — เลขแถวนับรวมหัวคอลัมน์ตามที่เห็นในโปรแกรม spreadsheet" : undefined}
        />
        {error ? (
          <Notice tone="error">โหลดแถวที่ผิดพลาดไม่สำเร็จ: {error.message}</Notice>
        ) : !errors?.length ? (
          <p className="text-muted-foreground">ไม่มีแถวที่ผิดพลาด</p>
        ) : (
          <>
            <DataTable caption="แถวที่นำเข้าไม่สำเร็จ">
              <thead>
                <tr>
                  <Th className="w-16">แถว</Th>
                  <Th>ปัญหา</Th>
                  <Th hideBelow="md">ข้อมูลในไฟล์</Th>
                </tr>
              </thead>
              <tbody>
                {errors.map((e) => (
                  <Tr key={e.id}>
                    <Td className="tabular-nums">{e.row_number}</Td>
                    <Td>
                      <ul className="flex flex-col gap-1">
                        {(e.errors as unknown as RowError[]).map((err, i) => (
                          <li key={i} className="text-destructive">
                            {err.field && <code className="mr-1.5 rounded bg-surface-muted px-1 text-xs text-foreground">{err.field}</code>}
                            {err.message}
                          </li>
                        ))}
                      </ul>
                    </Td>
                    <Td hideBelow="md" className="max-w-md font-mono text-xs break-all text-muted-foreground">
                      {JSON.stringify(e.raw)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
            {count && count > errors.length ? <p className="mt-2 text-xs text-muted-foreground">แสดง {errors.length} แถวแรกจาก {count}</p> : null}
          </>
        )}
      </section>
    </>
  );
}
