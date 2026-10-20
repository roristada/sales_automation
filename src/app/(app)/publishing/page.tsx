import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, Td, Th, Tr } from "@/components/shared/data-table";
import { PageHeader, SectionHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, Notice } from "@/components/shared/states";
import { Chip, StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { type Platform, PLATFORM_LABEL } from "@/features/content/templates";
import { formatDateTime } from "@/features/products/data-value";
import { PUBLICATION_BADGE, PUBLICATION_STATUS_LABEL, type PublicationStatus, PUBLISHING_ADAPTERS } from "@/features/publishing/publishing";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "เผยแพร่" };

export default async function PublishingPage() {
  const { supabase } = await getCurrentUser();
  const db = supabase!;
  const [{ data: pubs, error }, { data: outputs }] = await Promise.all([
    db
      .from("publications")
      .select("id, platform, status, scheduled_for, published_at, external_url, project_id, project:content_projects(title, product:products(name))")
      .order("updated_at", { ascending: false })
      .limit(300),
    db
      .from("render_outputs")
      .select("id, created_at, job:render_jobs(storyboard:storyboards(id, version, project:content_projects(id, title, platform, product:products(name))))")
      .order("created_at", { ascending: false })
      .limit(300),
  ]);

  // Content with a finished video and no live publication yet (newest render per project).
  const live = new Set((pubs ?? []).filter((p) => p.status !== "withdrawn").map((p) => p.project_id));
  const ready = new Map<string, { storyboardId: string; version: number; title: string; product: string; platform: Platform; renderedAt: string }>();
  for (const o of outputs ?? []) {
    const sb = o.job?.storyboard;
    const project = sb?.project;
    if (!sb || !project || live.has(project.id) || ready.has(project.id)) continue;
    ready.set(project.id, { storyboardId: sb.id, version: sb.version, title: project.title, product: project.product?.name ?? "", platform: project.platform as Platform, renderedAt: o.created_at });
  }

  const now = Date.now();
  return (
    <>
      <PageHeader title="เผยแพร่" description="เตรียมไฟล์และแคปชันสำหรับโพสต์ แล้วบันทึกลิงก์โพสต์ที่คุณเผยแพร่เอง" />

      <section aria-labelledby="platforms-h" className="mb-8">
        <SectionHeader id="platforms-h" title="การเชื่อมต่อแพลตฟอร์ม" description="ยังไม่มีแพลตฟอร์มที่เชื่อมต่อ ระบบจึงไม่โพสต์ให้อัตโนมัติ — สถานะ “เผยแพร่แล้ว” มาจากลิงก์โพสต์ที่คุณบันทึกเท่านั้น" />
        <ul className="grid gap-3 md:grid-cols-3">
          {Object.values(PUBLISHING_ADAPTERS).map((a) => {
            const c = a.connection();
            return (
              <li key={a.platform} className="rounded-lg border bg-surface p-3 text-[13px]">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-medium">{a.label}</span>
                  <Chip tone={c.state === "available" ? "success" : "neutral"}>{c.state === "available" ? "เชื่อมต่อแล้ว" : "ยังไม่เชื่อมต่อ"}</Chip>
                </div>
                <p className="text-muted-foreground">{c.note}</p>
              </li>
            );
          })}
        </ul>
      </section>

      {ready.size > 0 && (
        <section aria-labelledby="ready-h" className="mb-8">
          <SectionHeader id="ready-h" title="วิดีโอที่พร้อมเผยแพร่" description="render เสร็จแล้วแต่ยังไม่มีรายการเผยแพร่ — เปิดใน Video Studio เพื่อเตรียมเผยแพร่" />
          <DataTable caption="วิดีโอที่พร้อมเผยแพร่">
            <thead>
              <tr>
                <Th>คอนเทนต์</Th>
                <Th hideBelow="sm">แพลตฟอร์มที่วางแผน</Th>
                <Th hideBelow="md">render เมื่อ</Th>
                <Th>
                  <span className="sr-only">การทำงาน</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {[...ready.values()].map((r) => (
                <Tr key={r.storyboardId}>
                  <Td className="max-w-[420px]">
                    <span className="line-clamp-2 font-medium">{r.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {r.product} · เวอร์ชัน {r.version}
                    </span>
                  </Td>
                  <Td hideBelow="sm">{PLATFORM_LABEL[r.platform]}</Td>
                  <Td hideBelow="md" className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(r.renderedAt)}
                  </Td>
                  <Td className="text-right">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/videos/${r.storyboardId}#publish`}>เตรียมเผยแพร่</Link>
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        </section>
      )}

      <section aria-labelledby="pubs-h">
        <SectionHeader id="pubs-h" title="รายการเผยแพร่" />
        {error ? (
          <ErrorState title="โหลดรายการไม่สำเร็จ" description={error.message} />
        ) : !pubs?.length ? (
          <EmptyState
            title="ยังไม่มีรายการเผยแพร่"
            description="เมื่อ render วิดีโอเสร็จ กด “เตรียมเผยแพร่” ใน Video Studio เพื่อรับไฟล์และแคปชันสำหรับโพสต์"
            action={
              <Button asChild>
                <Link href="/videos">ไปที่ Video Studio</Link>
              </Button>
            }
          />
        ) : (
          <DataTable caption="รายการเผยแพร่">
            <thead>
              <tr>
                <Th>คอนเทนต์</Th>
                <Th hideBelow="sm">แพลตฟอร์ม</Th>
                <Th>สถานะ</Th>
                <Th hideBelow="md">เวลา</Th>
                <Th hideBelow="md">โพสต์</Th>
              </tr>
            </thead>
            <tbody>
              {pubs.map((p) => {
                const status = p.status as PublicationStatus;
                const overdue = status === "scheduled" && p.scheduled_for && Date.parse(p.scheduled_for) < now;
                return (
                  <Tr key={p.id}>
                    <Td className="max-w-[420px]">
                      <Link href={`/publishing/${p.id}`} className="line-clamp-2 font-medium hover:underline">
                        {p.project?.title}
                      </Link>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{p.project?.product?.name}</span>
                    </Td>
                    <Td hideBelow="sm">{PLATFORM_LABEL[p.platform as Platform]}</Td>
                    <Td>
                      <StatusBadge status={PUBLICATION_BADGE[status]} label={PUBLICATION_STATUS_LABEL[status]} />
                      {overdue && <span className="mt-1 block text-xs font-medium text-warning">เลยเวลาที่ตั้งไว้</span>}
                    </Td>
                    <Td hideBelow="md" className="whitespace-nowrap text-muted-foreground">
                      {status === "scheduled" ? formatDateTime(p.scheduled_for) : status === "draft" ? "—" : formatDateTime(p.published_at)}
                    </Td>
                    <Td hideBelow="md">
                      {p.external_url ? (
                        <a href={p.external_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                          เปิดโพสต์ <ExternalLink className="size-3.5" aria-hidden />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </section>
      {pubs?.some((p) => p.status === "scheduled") && (
        <Notice tone="info" className="mt-4">
          เวลาที่ตั้งไว้เป็นตัวเตือนเท่านั้น ระบบไม่โพสต์ให้ — เมื่อโพสต์เองแล้วให้เปิดรายการและบันทึกลิงก์โพสต์
        </Notice>
      )}
    </>
  );
}
