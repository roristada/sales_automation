import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, Td, Th, Tr } from "@/components/shared/data-table";
import { PageHeader, SectionHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { getTemplate } from "@/features/content/templates";
import { formatAge, formatDateTime } from "@/features/products/data-value";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Script Studio" };

type Row = {
  id: string;
  version: number;
  status: string;
  template_id: string;
  updated_at: string;
  project: { id: string; title: string; product: { name: string } | null } | null;
};

function List({ rows, caption }: { rows: Row[]; caption: string }) {
  return (
    <DataTable caption={caption}>
      <thead>
        <tr>
          <Th>สคริปต์</Th>
          <Th hideBelow="md">รูปแบบ</Th>
          <Th>สถานะ</Th>
          <Th hideBelow="sm">แก้ไขล่าสุด</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <Tr key={r.id}>
            <Td className="max-w-[420px]">
              <Link href={`/studio/${r.id}`} className="line-clamp-2 font-medium hover:underline">
                {r.project?.title ?? "—"}
              </Link>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {r.project?.product?.name} · เวอร์ชัน {r.version}
              </span>
            </Td>
            <Td hideBelow="md">{getTemplate(r.template_id)?.name ?? r.template_id}</Td>
            <Td>
              <StatusBadge status={r.status === "approved" ? "approved" : "draft"} />
            </Td>
            <Td hideBelow="sm" className="whitespace-nowrap text-muted-foreground">
              <span title={formatDateTime(r.updated_at)}>{formatAge(r.updated_at)}</span>
            </Td>
          </Tr>
        ))}
      </tbody>
    </DataTable>
  );
}

export default async function StudioListPage() {
  const { supabase } = await getCurrentUser();
  const { data, error } = await supabase!
    .from("storyboards")
    .select("id, version, status, template_id, updated_at, project:content_projects(id, title, product:products(name))")
    .order("updated_at", { ascending: false })
    .limit(300);
  const rows = (data ?? []) as Row[];
  const drafts = rows.filter((r) => r.status === "draft");
  const approved = rows.filter((r) => r.status === "approved");

  return (
    <>
      <PageHeader
        title="Script Studio"
        description="ตรวจ แก้ และอนุมัติสคริปต์ ทุก claim ต้องอ้างอิงข้อเท็จจริงของสินค้าก่อนอนุมัติ"
        actions={
          <Button asChild>
            <Link href="/content/new">
              <Plus aria-hidden /> สร้างคอนเทนต์
            </Link>
          </Button>
        }
      />
      {error ? (
        <ErrorState title="โหลดสคริปต์ไม่สำเร็จ" description={error.message} />
      ) : !rows.length ? (
        <EmptyState title="ยังไม่มีสคริปต์" description="สร้างคอนเทนต์จากหน้าวางแผนคอนเทนต์หรือหน้าสินค้า" />
      ) : (
        <div className="flex flex-col gap-8">
          <section aria-labelledby="drafts-h">
            <SectionHeader id="drafts-h" title={`ฉบับร่าง (${drafts.length})`} description="ยังไม่อนุมัติ — ต้องตรวจ claim ทุกข้อ" />
            {drafts.length ? <List rows={drafts} caption="สคริปต์ฉบับร่าง" /> : <p className="text-muted-foreground">ไม่มีฉบับร่างค้างอยู่</p>}
          </section>
          <section aria-labelledby="approved-h">
            <SectionHeader id="approved-h" title={`อนุมัติแล้ว (${approved.length})`} description="ล็อกไว้ พร้อมใช้ทำวิดีโอ" />
            {approved.length ? <List rows={approved} caption="สคริปต์ที่อนุมัติแล้ว" /> : <p className="text-muted-foreground">ยังไม่มี</p>}
          </section>
        </div>
      )}
    </>
  );
}
