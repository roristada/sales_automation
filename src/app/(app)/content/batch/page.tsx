import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, Td, Th, Tr } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { getTemplate, type Platform, PLATFORM_LABEL } from "@/features/content/templates";
import { formatDateTime } from "@/features/products/data-value";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "สร้างหลายวิดีโอ" };

export default async function BatchesPage() {
  const { supabase } = await getCurrentUser();
  const { data: batches, error } = await supabase!
    .from("content_batches")
    .select("id, template_id, platform, use_ai, created_at, items:content_batch_items(status, cost_thb, storyboard:storyboards(status))")
    .order("created_at", { ascending: false })
    .limit(100);
  const action = (
    <Button asChild>
      <Link href="/content/batch/new">
        <Plus aria-hidden /> ชุดใหม่
      </Link>
    </Button>
  );
  return (
    <>
      <PageHeader breadcrumb={[{ label: "วางแผนคอนเทนต์", href: "/content" }, { label: "สร้างหลายวิดีโอ" }]} title="สร้างหลายวิดีโอ" description="ร่างสคริปต์ให้หลายสินค้าในครั้งเดียว แล้วตรวจ อนุมัติ และ render ทีละงาน" actions={action} />
      {error ? (
        <ErrorState title="โหลดชุดงานไม่สำเร็จ" description={error.message} />
      ) : !batches?.length ? (
        <EmptyState title="ยังไม่มีชุดงาน" description="เลือกหลายสินค้า รูปแบบ และความยาว ระบบจะร่างสคริปต์ให้ทุกสินค้า" action={action} />
      ) : (
        <DataTable caption="ชุดงาน">
          <thead>
            <tr>
              <Th>ชุด</Th>
              <Th hideBelow="sm">รูปแบบ</Th>
              <Th numeric>อนุมัติแล้ว</Th>
              <Th hideBelow="md" numeric>
                ค่า AI
              </Th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <Tr key={b.id}>
                <Td>
                  <Link href={`/content/batch/${b.id}`} className="font-medium text-primary hover:underline">
                    {formatDateTime(b.created_at)}
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    {b.items.length} สินค้า · {PLATFORM_LABEL[b.platform as Platform]}
                    {b.use_ai ? " · AI เขียน" : ""}
                  </span>
                </Td>
                <Td hideBelow="sm">{getTemplate(b.template_id)?.name ?? b.template_id}</Td>
                <Td numeric>
                  {b.items.filter((i) => i.storyboard?.status === "approved").length}/{b.items.length}
                </Td>
                <Td hideBelow="md" numeric>
                  ฿{b.items.reduce((n, i) => n + Number(i.cost_thb), 0).toLocaleString("th-TH", { maximumFractionDigits: 2 })}
                </Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </>
  );
}
