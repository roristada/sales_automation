import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, Td, Th, Tr } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, Notice } from "@/components/shared/states";
import { StatusBadge, type WorkflowStatus } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { getTemplate } from "@/features/content/templates";
import { formatAge, formatDateTime } from "@/features/products/data-value";
import { TTS_STATUS } from "@/features/video/tts";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Video Studio" };

const JOB: Record<string, { status: WorkflowStatus; label: string }> = {
  queued: { status: "queued", label: "รอคิว" },
  processing: { status: "processing", label: "กำลัง render" },
  completed: { status: "ready", label: "มีวิดีโอแล้ว" },
  failed: { status: "failed", label: "render ล้มเหลว" },
  canceled: { status: "unavailable", label: "ยกเลิก" },
};

export default async function VideosPage() {
  const { supabase } = await getCurrentUser();
  const { data, error } = await supabase!
    .from("storyboards")
    .select("id, version, template_id, approved_at, project:content_projects(title, product:products(name)), jobs:render_jobs(status, created_at)")
    .eq("status", "approved")
    .order("approved_at", { ascending: false })
    .limit(200);

  return (
    <>
      <PageHeader title="Video Studio" description="ทำวิดีโอจากสคริปต์ที่อนุมัติแล้ว ดูตัวอย่าง render และดาวน์โหลด MP4 ซับไตเติล และภาพปก" />
      <Notice tone="info" className="mb-4">
        {TTS_STATUS.note}
      </Notice>
      {error ? (
        <ErrorState title="โหลดรายการไม่สำเร็จ" description={error.message} />
      ) : !data?.length ? (
        <EmptyState
          title="ยังไม่มีสคริปต์ที่อนุมัติ"
          description="วิดีโอทำได้จากสคริปต์ที่อนุมัติแล้วเท่านั้น ตรวจ claim และอนุมัติใน Script Studio ก่อน"
          action={
            <Button asChild>
              <Link href="/studio">ไปที่ Script Studio</Link>
            </Button>
          }
        />
      ) : (
        <DataTable caption="สคริปต์ที่อนุมัติแล้ว">
          <thead>
            <tr>
              <Th>สคริปต์</Th>
              <Th hideBelow="md">รูปแบบ</Th>
              <Th>วิดีโอ</Th>
              <Th hideBelow="sm">อนุมัติเมื่อ</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((s) => {
              const latest = [...s.jobs].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
              const st = latest ? JOB[latest.status] : null;
              return (
                <Tr key={s.id}>
                  <Td className="max-w-[420px]">
                    <Link href={`/videos/${s.id}`} className="line-clamp-2 font-medium hover:underline">
                      {s.project?.title}
                    </Link>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {s.project?.product?.name} · เวอร์ชัน {s.version}
                    </span>
                  </Td>
                  <Td hideBelow="md">{getTemplate(s.template_id)?.name ?? s.template_id}</Td>
                  <Td>{st ? <StatusBadge status={st.status} label={st.label} /> : <span className="text-xs text-muted-foreground">ยังไม่ได้ render</span>}</Td>
                  <Td hideBelow="sm" className="whitespace-nowrap text-muted-foreground">
                    <span title={formatDateTime(s.approved_at)}>{formatAge(s.approved_at)}</span>
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
