import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, Td, Th, Tr } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { getTemplate, type Platform, PLATFORM_LABEL } from "@/features/content/templates";
import { formatAge, formatDateTime } from "@/features/products/data-value";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "วางแผนคอนเทนต์" };

export default async function ContentPage() {
  const { supabase } = await getCurrentUser();
  const { data: projects, error } = await supabase!
    .from("content_projects")
    .select("id, title, platform, target_duration_s, updated_at, product:products(id, name), storyboards(id, version, status, template_id, updated_at)")
    .order("updated_at", { ascending: false })
    .limit(200);

  return (
    <>
      <PageHeader
        title="วางแผนคอนเทนต์"
        description="โปรเจกต์คอนเทนต์ของแต่ละสินค้า สร้างจาก template แล้วตรวจและอนุมัติใน Script Studio"
        actions={
          <Button asChild>
            <Link href="/content/new">
              <Plus aria-hidden /> สร้างคอนเทนต์
            </Link>
          </Button>
        }
      />
      {error ? (
        <ErrorState title="โหลดโปรเจกต์ไม่สำเร็จ" description={error.message} />
      ) : !projects?.length ? (
        <EmptyState
          title="ยังไม่มีโปรเจกต์คอนเทนต์"
          description="เลือกสินค้าและรูปแบบ ระบบจะร่างสคริปต์ภาษาไทยจากข้อเท็จจริงของสินค้าให้แก้ต่อ"
          action={
            <Button asChild>
              <Link href="/content/new">
                <Plus aria-hidden /> สร้างคอนเทนต์
              </Link>
            </Button>
          }
        />
      ) : (
        <DataTable caption="โปรเจกต์คอนเทนต์">
          <thead>
            <tr>
              <Th>โปรเจกต์</Th>
              <Th hideBelow="md">รูปแบบ</Th>
              <Th hideBelow="sm">แพลตฟอร์ม</Th>
              <Th>สถานะ</Th>
              <Th hideBelow="lg">แก้ไขล่าสุด</Th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => {
              const latest = [...p.storyboards].sort((a, b) => b.version - a.version)[0];
              return (
                <Tr key={p.id}>
                  <Td className="max-w-[420px]">
                    {latest ? (
                      <Link href={`/studio/${latest.id}`} className="line-clamp-2 font-medium hover:underline">
                        {p.title}
                      </Link>
                    ) : (
                      <span className="font-medium">{p.title}</span>
                    )}
                    {p.product && (
                      <Link href={`/products/${p.product.id}`} className="mt-0.5 block text-xs text-muted-foreground hover:underline">
                        {p.product.name}
                      </Link>
                    )}
                  </Td>
                  <Td hideBelow="md">{latest ? (getTemplate(latest.template_id)?.name ?? latest.template_id) : "—"}</Td>
                  <Td hideBelow="sm" className="whitespace-nowrap">
                    {PLATFORM_LABEL[p.platform as Platform]} · {p.target_duration_s} วิ
                  </Td>
                  <Td>
                    {latest ? (
                      <span className="inline-flex flex-col gap-0.5">
                        <StatusBadge status={latest.status === "approved" ? "approved" : "draft"} />
                        <span className="text-xs text-muted-foreground">เวอร์ชัน {latest.version}</span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td hideBelow="lg" className="whitespace-nowrap text-muted-foreground">
                    <span title={formatDateTime(p.updated_at)}>{formatAge(latest?.updated_at ?? p.updated_at)}</span>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </DataTable>
      )}
    </>
  );
}
