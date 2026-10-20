import { CheckCircle2, Download, Pencil, TriangleAlert, XCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { DataTable, Td, Th, Tr } from "@/components/shared/data-table";
import { PageHeader, SectionHeader } from "@/components/shared/page-header";
import { Notice } from "@/components/shared/states";
import { StatusBadge, type WorkflowStatus } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { getTemplate, type Platform, PLATFORM_LABEL, PLATFORMS } from "@/features/content/templates";
import { formatDateTime } from "@/features/products/data-value";
import { PreparePublication } from "@/features/publishing/publication-forms";
import { PUBLICATION_BADGE, PUBLICATION_STATUS_LABEL, type PublicationStatus } from "@/features/publishing/publishing";
import type { QaReport } from "@/features/video/qa";
import { type ActiveJob, RenderPanel } from "@/features/video/render-panel";
import { buildTimeline } from "@/features/video/timeline";
import { VideoPreview } from "@/features/video/video-preview";
import { getWorkerStatus } from "@/features/monitoring/queries";
import { galleryList } from "@/features/products/schema";
import { workerState } from "@/features/monitoring/status";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Video Studio" };

const JOB_STATUS: Record<string, { status: WorkflowStatus; label: string }> = {
  queued: { status: "queued", label: "รอคิว" },
  processing: { status: "processing", label: "กำลัง render" },
  completed: { status: "completed", label: "เสร็จ" },
  failed: { status: "failed", label: "ล้มเหลว" },
  canceled: { status: "unavailable", label: "ยกเลิกแล้ว" },
};

const fileUrl = (outputId: string, file: string, download?: string) => `/api/renders/${outputId}/${file}${download ? `?download=1&name=${encodeURIComponent(download)}` : ""}`;

export default async function VideoPage({ params }: { params: Promise<{ storyboardId: string }> }) {
  const { storyboardId } = await params;
  if (!z.uuid().safeParse(storyboardId).success) notFound();
  const { supabase } = await getCurrentUser();
  const db = supabase!;

  const { data: sb } = await db.from("storyboards").select("*, project:content_projects(id, title, platform, target_duration_s, product:products(id, name, image_url, gallery_urls))").eq("id", storyboardId).maybeSingle();
  if (!sb?.project?.product) notFound();
  const { project } = sb;
  const product = project.product!;
  const [{ data: scenes }, { data: jobs }, { data: pubs }] = await Promise.all([
    db.from("storyboard_scenes").select("id, kind, narration, on_screen_text, asset:assets(id, kind, duration_s)").eq("storyboard_id", storyboardId).order("position"),
    db.from("render_jobs").select("*, output:render_outputs(*)").eq("storyboard_id", storyboardId).order("created_at", { ascending: false }).limit(20),
    db.from("publications").select("id, platform, status").eq("project_id", project.id).neq("status", "withdrawn").order("created_at"),
  ]);

  const preview = buildTimeline({
    productName: product.name,
    imageSrc: product.image_url,
    gallery: galleryList(product.gallery_urls),
    hook: sb.hook,
    cta: sb.cta,
    disclosure: sb.disclosure,
    scenes: (scenes ?? []).map((s) => ({
      ...s,
      media: s.asset ? { kind: s.asset.kind as "image" | "video", src: `/api/assets/${s.asset.id}`, durationS: s.asset.duration_s } : null,
    })),
  });
  const activeRow = jobs?.find((j) => j.status === "queued" || j.status === "processing");
  // Only asked while a job waits: tells "worker not running" apart from "queued behind another job".
  const worker = activeRow?.status === "queued" ? workerState(await getWorkerStatus(db)) : "unknown";
  const active: ActiveJob | null = activeRow
    ? {
        id: activeRow.id,
        status: activeRow.status as ActiveJob["status"],
        progress: activeRow.progress,
        stage: activeRow.stage,
        attempt: activeRow.attempt,
        createdAt: activeRow.created_at,
        errorMessage: activeRow.error_message,
      }
    : null;
  const latestDone = jobs?.find((j) => j.status === "completed" && j.output);
  const output = latestDone?.output ?? null;
  const report = output?.report as QaReport | undefined;
  const lastFailed = jobs?.[0]?.status === "failed" ? jobs[0] : null;
  // Suggest the project's platform first, then one this content isn't on yet.
  const taken = new Set(pubs?.map((p) => p.platform));
  const nextPlatform = [project.platform as Platform, ...PLATFORMS].find((p) => !taken.has(p)) ?? (project.platform as Platform);
  const fileBase = `${product.name.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40)}-v${sb.version}`;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Video Studio", href: "/videos" }, { label: project.title }]}
        title={project.title}
        meta={
          <>
            <StatusBadge status={sb.status === "approved" ? "approved" : "draft"} />
            <span>เวอร์ชัน {sb.version}</span>
            <span>{getTemplate(sb.template_id)?.name ?? sb.template_id}</span>
            <span>
              {PLATFORM_LABEL[project.platform as Platform]} · ประมาณ {(preview.durationInFrames / preview.fps).toFixed(1)} วินาที
            </span>
          </>
        }
        actions={
          <Button asChild variant="outline">
            <Link href={`/studio/${sb.id}`}>
              <Pencil aria-hidden /> เปิดใน Script Studio
            </Link>
          </Button>
        }
      />

      {sb.status !== "approved" ? (
        <Notice tone="warning">
          สคริปต์นี้ยังไม่อนุมัติ จึง render ไม่ได้ —{" "}
          <Link href={`/studio/${sb.id}`} className="font-medium text-primary hover:underline">
            ตรวจและอนุมัติใน Script Studio
          </Link>
        </Notice>
      ) : null}

      <div className="mt-4 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6 lg:order-1">
          {output && (
            <section aria-labelledby="output-h">
              <SectionHeader id="output-h" title="วิดีโอที่ render แล้ว" description={`render เมื่อ ${formatDateTime(latestDone!.finished_at)}`} />
              <div className="mx-auto w-full max-w-[360px] overflow-hidden rounded-lg border bg-black">
                <video controls preload="metadata" poster={output.thumbnail_key ? fileUrl(output.id, "thumbnail") : undefined} className="aspect-[9/16] w-full" src={fileUrl(output.id, "video")}>
                  {output.vtt_key && <track kind="captions" srcLang="th" label="ไทย" src={fileUrl(output.id, "vtt")} />}
                </video>
              </div>
            </section>
          )}
          {output ? (
            <details className="group">
              <summary className="cursor-pointer text-[13px] font-medium text-primary">ดูตัวอย่างสดจากสคริปต์</summary>
              <div className="mt-3">
                <VideoPreview props={preview} />
              </div>
            </details>
          ) : (
            <section aria-labelledby="preview-h">
              <SectionHeader id="preview-h" title="ตัวอย่างสด" description="ตัวอย่างจากสคริปต์ปัจจุบัน ใช้เทมเพลตเดียวกับตอน render — ไฟล์จริงต้องกด Render" />
              <VideoPreview props={preview} />
            </section>
          )}
        </div>

        {/* Render controls first on small screens; beside the video on large ones. */}
        <aside aria-label="Render" className="order-first flex flex-col gap-4 lg:sticky lg:top-4 lg:order-2">
          <section className="rounded-lg border bg-surface p-4">
            <h2 className="mb-3 font-semibold">Render</h2>
            {sb.status === "approved" ? (
              <RenderPanel storyboardId={sb.id} active={active} hasOutput={!!output} workerOnline={worker === "unknown" ? null : worker === "online" || worker === "busy"} />
            ) : (
              <p className="text-[13px] text-muted-foreground">อนุมัติสคริปต์ก่อน</p>
            )}
            {lastFailed && !active && (
              <Notice tone="error" className="mt-3">
                render ล่าสุดล้มเหลว: {lastFailed.error_message ?? lastFailed.error_code}
              </Notice>
            )}
          </section>

          {output && (
            <section className="rounded-lg border bg-surface p-4 text-[13px]">
              <h2 className="mb-2 font-semibold">ดาวน์โหลด</h2>
              <ul className="flex flex-col gap-1.5">
                {[
                  ["video", "MP4", `${fileBase}.mp4`],
                  ["thumbnail", "ภาพปก (JPG)", `${fileBase}.jpg`],
                  ["srt", "ซับไตเติล (SRT)", `${fileBase}.srt`],
                  ["vtt", "ซับไตเติล (VTT)", `${fileBase}.vtt`],
                ].map(([file, label, name]) => (
                  <li key={file}>
                    <a href={fileUrl(output.id, file, name)} className="inline-flex items-center gap-1.5 text-primary hover:underline">
                      <Download className="size-3.5" aria-hidden /> {label}
                    </a>
                  </li>
                ))}
              </ul>
              {output.size_bytes && <p className="mt-2 text-xs text-muted-foreground">{(output.size_bytes / 1024 / 1024).toFixed(1)} MB · {output.duration_s?.toFixed(1)} วินาที</p>}
            </section>
          )}

          {output && sb.status === "approved" && (
            <section id="publish" aria-labelledby="publish-h" className="scroll-mt-4 rounded-lg border bg-surface p-4 text-[13px]">
              <h2 id="publish-h" className="mb-2 font-semibold">
                เผยแพร่
              </h2>
              {pubs && pubs.length > 0 && (
                <ul className="mb-3 flex flex-col gap-1.5">
                  {pubs.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-2">
                      <Link href={`/publishing/${p.id}`} className="font-medium text-primary hover:underline">
                        {PLATFORM_LABEL[p.platform as Platform]}
                      </Link>
                      <StatusBadge status={PUBLICATION_BADGE[p.status as PublicationStatus]} label={PUBLICATION_STATUS_LABEL[p.status as PublicationStatus]} />
                    </li>
                  ))}
                </ul>
              )}
              <PreparePublication outputId={output.id} defaultPlatform={nextPlatform} />
            </section>
          )}

          {report && (
            <section className="rounded-lg border bg-surface p-4 text-[13px]">
              <h2 className="mb-2 font-semibold">ตรวจคุณภาพไฟล์</h2>
              <ul className="flex flex-col gap-1.5">
                {report.checks.map((c) => {
                  const Icon = c.ok ? CheckCircle2 : c.level === "warn" ? TriangleAlert : XCircle;
                  return (
                    <li key={c.key} className="flex items-start gap-1.5">
                      <Icon className={c.ok ? "mt-0.5 size-3.5 shrink-0 text-success" : c.level === "warn" ? "mt-0.5 size-3.5 shrink-0 text-warning" : "mt-0.5 size-3.5 shrink-0 text-destructive"} aria-hidden />
                      <span>
                        <span className="font-medium">{c.label}</span>
                        <span className="sr-only">{c.ok ? " ผ่าน" : c.level === "warn" ? " ข้อสังเกต" : " ไม่ผ่าน"}</span>
                        <span className="block text-muted-foreground">{c.detail}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </aside>
      </div>

      {jobs && jobs.length > 0 && (
        <section aria-labelledby="history-h" className="mt-8">
          <SectionHeader id="history-h" title="ประวัติการ render" />
          <DataTable caption="ประวัติการ render">
            <thead>
              <tr>
                <Th>เริ่ม</Th>
                <Th>สถานะ</Th>
                <Th hideBelow="sm">ครั้งที่ลอง</Th>
                <Th hideBelow="md">รายละเอียด</Th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <Tr key={j.id}>
                  <Td className="whitespace-nowrap">{formatDateTime(j.created_at)}</Td>
                  <Td>
                    <StatusBadge status={JOB_STATUS[j.status].status} label={JOB_STATUS[j.status].label} />
                  </Td>
                  <Td hideBelow="sm">
                    {j.attempt}/{j.max_attempts}
                  </Td>
                  <Td hideBelow="md" className="text-muted-foreground">
                    {j.error_message ?? (j.output ? `${j.output.duration_s?.toFixed(1)} วินาที` : "—")}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        </section>
      )}
    </>
  );
}
