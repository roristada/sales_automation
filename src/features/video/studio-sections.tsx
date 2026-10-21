import { CheckCircle2, Download, TriangleAlert, XCircle } from "lucide-react";
import Link from "next/link";
import { DataTable, Td, Th, Tr } from "@/components/shared/data-table";
import { SectionHeader } from "@/components/shared/page-header";
import { Notice } from "@/components/shared/states";
import { StatusBadge, type WorkflowStatus } from "@/components/shared/status-badge";
import { type Platform, PLATFORM_LABEL } from "@/features/content/templates";
import { formatDateTime } from "@/features/products/data-value";
import { PreparePublication } from "@/features/publishing/publication-forms";
import { PUBLICATION_BADGE, PUBLICATION_STATUS_LABEL, type PublicationStatus } from "@/features/publishing/publishing";
import { ClipsPanel } from "./clips-panel";
import { RenderPanel } from "./render-panel";
import type { VideoStudioData } from "./studio-data";
import { VideoPreview } from "./video-preview";

/* The video side of a script, shared by Video Studio and the video workspace. */

export const JOB_STATUS: Record<string, { status: WorkflowStatus; label: string }> = {
  queued: { status: "queued", label: "รอคิว" },
  processing: { status: "processing", label: "กำลัง render" },
  completed: { status: "completed", label: "เสร็จ" },
  failed: { status: "failed", label: "ล้มเหลว" },
  canceled: { status: "unavailable", label: "ยกเลิกแล้ว" },
};

export const renderFileUrl = (outputId: string, file: string, download?: string) => `/api/renders/${outputId}/${file}${download ? `?download=1&name=${encodeURIComponent(download)}` : ""}`;

/** The latest rendered video, or the live preview when there's none yet. */
export function OutputSection({ d }: { d: VideoStudioData }) {
  const { output, latestDone, preview } = d;
  if (!output) {
    return (
      <section aria-labelledby="preview-h">
        <SectionHeader id="preview-h" title="ตัวอย่างสด" description="ตัวอย่างจากสคริปต์ปัจจุบัน ใช้เทมเพลตเดียวกับตอน render — ไฟล์จริงต้องกด Render" />
        <VideoPreview props={preview} />
      </section>
    );
  }
  return (
    <>
      <section aria-labelledby="output-h">
        <SectionHeader id="output-h" title="วิดีโอที่ render แล้ว" description={`render เมื่อ ${formatDateTime(latestDone!.finished_at)}`} />
        <div className="mx-auto w-full max-w-[360px] overflow-hidden rounded-lg border bg-black">
          <video controls preload="metadata" poster={output.thumbnail_key ? renderFileUrl(output.id, "thumbnail") : undefined} className="aspect-[9/16] w-full" src={renderFileUrl(output.id, "video")}>
            {output.vtt_key && <track kind="captions" srcLang="th" label="ไทย" src={renderFileUrl(output.id, "vtt")} />}
          </video>
        </div>
      </section>
      <details className="group">
        <summary className="cursor-pointer text-[13px] font-medium text-primary">ดูตัวอย่างสดจากสคริปต์</summary>
        <div className="mt-3">
          <VideoPreview props={preview} />
        </div>
      </details>
    </>
  );
}

export function ClipsSection({ d }: { d: VideoStudioData }) {
  return (
    <section aria-labelledby="clips-h">
      <SectionHeader
        id="clips-h"
        title="คลิป AI ต่อฉาก"
        description="สร้างคลิปด้วย AI เฉพาะฉากที่ต้องการ ตรวจแล้วกด “ใช้คลิปนี้” — ฉากอื่นใช้ภาพสินค้า + motion graphics ได้ฟรี · render ได้เมื่อทุกฉากที่ตั้งเป็นคลิป AI มีคลิปที่อนุมัติแล้ว"
      />
      <ClipsPanel storyboardId={d.sb.id} scenes={d.clipScenes} aiReady={d.aiReady} approved={d.sb.status === "approved"} reusable={d.reusable} choices={d.videoChoices} usdThb={d.usdThb} hasFrame={d.hasFrame} />
    </section>
  );
}

/** Render controls, downloads, publishing and the QA report. */
export function RenderAside({ d }: { d: VideoStudioData }) {
  const { sb, output, report, pubs } = d;
  return (
    <>
      <section className="rounded-lg border bg-surface p-4">
        <h2 className="mb-3 font-semibold">Render</h2>
        {sb.status === "approved" ? (
          <RenderPanel storyboardId={sb.id} active={d.active} hasOutput={!!output} workerOnline={d.workerOnline} voice={d.voiceOption} music={d.musicOptions} lastMusicId={d.lastMusicId} />
        ) : (
          <p className="text-[13px] text-muted-foreground">อนุมัติสคริปต์ก่อน</p>
        )}
        {d.lastFailed && !d.active && (
          <Notice tone="error" className="mt-3">
            render ล่าสุดล้มเหลว: {d.lastFailed.error_message ?? d.lastFailed.error_code}
          </Notice>
        )}
      </section>

      {output && (
        <section className="rounded-lg border bg-surface p-4 text-[13px]">
          <h2 className="mb-2 font-semibold">ดาวน์โหลด</h2>
          <ul className="flex flex-col gap-1.5">
            {[
              ["video", "MP4", `${d.fileBase}.mp4`],
              ["thumbnail", "ภาพปก (JPG)", `${d.fileBase}.jpg`],
              ["srt", "ซับไตเติล (SRT)", `${d.fileBase}.srt`],
              ["vtt", "ซับไตเติล (VTT)", `${d.fileBase}.vtt`],
            ].map(([file, label, name]) => (
              <li key={file}>
                <a href={renderFileUrl(output.id, file, name)} className="inline-flex items-center gap-1.5 text-primary hover:underline">
                  <Download className="size-3.5" aria-hidden /> {label}
                </a>
              </li>
            ))}
          </ul>
          {output.size_bytes && (
            <p className="mt-2 text-xs text-muted-foreground">
              {(output.size_bytes / 1024 / 1024).toFixed(1)} MB · {output.duration_s?.toFixed(1)} วินาที
            </p>
          )}
        </section>
      )}

      {output && sb.status === "approved" && (
        <section id="publish" aria-labelledby="publish-h" className="scroll-mt-4 rounded-lg border bg-surface p-4 text-[13px]">
          <h2 id="publish-h" className="mb-2 font-semibold">
            เผยแพร่
          </h2>
          {pubs.length > 0 && (
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
          <PreparePublication outputId={output.id} defaultPlatform={d.nextPlatform} />
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
    </>
  );
}

export function RenderHistory({ d }: { d: VideoStudioData }) {
  if (!d.jobs.length) return null;
  return (
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
          {d.jobs.map((j) => (
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
  );
}
