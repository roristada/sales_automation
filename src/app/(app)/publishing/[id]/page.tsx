import { CheckCircle2, Download, ExternalLink, TriangleAlert, XCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader, SectionHeader } from "@/components/shared/page-header";
import { Notice } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { CopyButton } from "@/components/shared/copy-button";
import { Button } from "@/components/ui/button";
import type { ConversionStatus } from "@/features/analytics/csv";
import { summarize } from "@/features/analytics/summary";
import type { Platform } from "@/features/content/templates";
import { formatDate, formatDateTime } from "@/features/products/data-value";
import { DeletePublicationButton, DetailsForm, MarkPublishedForm, ScheduleForm, SwitchRenderButton, WithdrawButton } from "@/features/publishing/publication-forms";
import { checkPublication, PUBLICATION_BADGE, PUBLICATION_STATUS_LABEL, type PublicationStatus, getPublishingAdapter } from "@/features/publishing/publishing";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "เผยแพร่" };

const fileUrl = (outputId: string, file: string, download?: string) => `/api/renders/${outputId}/${file}${download ? `?download=1&name=${encodeURIComponent(download)}` : ""}`;

export default async function PublicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { supabase } = await getCurrentUser();
  const db = supabase!;

  const { data: pub } = await db
    .from("publications")
    .select(
      "*, output:render_outputs(id, created_at, duration_s, size_bytes, thumbnail_key, vtt_key, srt_key), storyboard:storyboards(id, version), project:content_projects(title, product:products(id, name))",
    )
    .eq("id", id)
    .maybeSingle();
  if (!pub?.output || !pub.project || !pub.storyboard) notFound();

  const { data: newest } = await db
    .from("render_outputs")
    .select("id, job:render_jobs!inner(storyboard:storyboards!inner(project_id))")
    .eq("job.storyboard.project_id", pub.project_id)
    .order("created_at", { ascending: false })
    .limit(1);
  const isLatestRender = !newest?.[0] || newest[0].id === pub.output.id;

  const [{ data: metrics }, { data: conversions }] = await Promise.all([
    db.from("post_metrics").select("post_key, captured_on, views, likes, comments, shares, saves, avg_watch_s").eq("publication_id", pub.id).limit(1000),
    db.from("affiliate_conversions").select("status, commission_thb, order_value_thb").eq("publication_id", pub.id).limit(5000),
  ]);
  const results = summarize({
    publications: [{ id: pub.id, projectId: pub.project_id }],
    metrics: (metrics ?? []).map((m) => ({
      publicationId: pub.id,
      postKey: m.post_key,
      capturedOn: m.captured_on,
      views: m.views,
      likes: m.likes,
      comments: m.comments,
      shares: m.shares,
      saves: m.saves,
      avgWatchS: m.avg_watch_s,
    })),
    conversions: (conversions ?? []).map((c) => ({ publicationId: pub.id, status: c.status as ConversionStatus, commission: c.commission_thb, orderValue: c.order_value_thb })),
    projectCosts: new Map(),
  }).byPublication.get(pub.id)!;
  const thb = (n: number) => new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", minimumFractionDigits: 2 }).format(n);

  const status = pub.status as PublicationStatus;
  const platform = pub.platform as Platform;
  const adapter = getPublishingAdapter(platform);
  const unposted = status === "draft" || status === "scheduled";
  const issues = checkPublication({ caption: pub.caption, disclosure: pub.disclosure, affiliateUrl: pub.affiliate_url, platform, isLatestRender });
  const blocked = issues.some((i) => i.level === "error");
  const { output, project, storyboard } = pub;
  const fileBase = `${(project.product?.name ?? "video").replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40)}-v${storyboard.version}-${platform}`;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "เผยแพร่", href: "/publishing" }, { label: project.title }]}
        title={project.title}
        meta={
          <>
            <StatusBadge status={PUBLICATION_BADGE[status]} label={PUBLICATION_STATUS_LABEL[status]} />
            <span>{adapter.label}</span>
            <span>โพสต์เอง (ยังไม่เชื่อมต่อ API)</span>
            <span>สคริปต์เวอร์ชัน {storyboard.version}</span>
          </>
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/videos/${storyboard.id}`}>เปิดใน Video Studio</Link>
            </Button>
            {unposted && <DeletePublicationButton id={pub.id} />}
          </>
        }
      />

      {status === "scheduled" && pub.scheduled_for && (
        <Notice tone={Date.parse(pub.scheduled_for) < Date.now() ? "warning" : "info"} className="mb-4">
          ตั้งเวลาโพสต์ไว้ {formatDateTime(pub.scheduled_for)}
          {Date.parse(pub.scheduled_for) < Date.now() ? " — เลยเวลาแล้ว" : ""} · ระบบไม่โพสต์ให้ โพสต์เองแล้วบันทึกลิงก์ด้านล่าง
        </Notice>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-8">
          <section aria-labelledby="pack-h">
            <SectionHeader
              id="pack-h"
              title="ไฟล์สำหรับโพสต์"
              description={`render เมื่อ ${formatDateTime(output.created_at)}${output.duration_s ? ` · ${output.duration_s.toFixed(1)} วินาที` : ""}`}
            />
            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="mx-auto w-full max-w-[220px] shrink-0 overflow-hidden rounded-lg border bg-black sm:mx-0">
                <video controls preload="metadata" poster={output.thumbnail_key ? fileUrl(output.id, "thumbnail") : undefined} className="aspect-[9/16] w-full" src={fileUrl(output.id, "video")}>
                  {output.vtt_key && <track kind="captions" srcLang="th" label="ไทย" src={fileUrl(output.id, "vtt")} />}
                </video>
              </div>
              <div className="flex flex-col gap-3 text-[13px]">
                <ul className="flex flex-col gap-1.5">
                  {(
                    [
                      ["video", "วิดีโอ (MP4)", `${fileBase}.mp4`, true],
                      ["thumbnail", "ภาพปก (JPG)", `${fileBase}.jpg`, !!output.thumbnail_key],
                      ["srt", "ซับไตเติล (SRT)", `${fileBase}.srt`, !!output.srt_key],
                      ["vtt", "ซับไตเติล (VTT)", `${fileBase}.vtt`, !!output.vtt_key],
                    ] as const
                  )
                    .filter(([, , , has]) => has)
                    .map(([file, label, name]) => (
                      <li key={file}>
                        <a href={fileUrl(output.id, file, name)} className="inline-flex items-center gap-1.5 text-primary hover:underline">
                          <Download className="size-3.5" aria-hidden /> {label}
                        </a>
                      </li>
                    ))}
                </ul>
                <p className="text-muted-foreground">ลิงก์ affiliate: {adapter.linkPlacement}</p>
                {!isLatestRender && unposted && (
                  <div className="flex flex-col items-start gap-2">
                    <span className="text-warning">มีวิดีโอที่ render ใหม่กว่าไฟล์นี้</span>
                    <SwitchRenderButton id={pub.id} />
                  </div>
                )}
              </div>
            </div>
          </section>

          <section aria-labelledby="caption-h">
            <SectionHeader id="caption-h" title="แคปชันและลิงก์" />
            <DetailsForm id={pub.id} posted={!unposted} captionLimit={adapter.captionLimit} initial={{ caption: pub.caption, affiliate_url: pub.affiliate_url ?? "", notes: pub.notes ?? "" }} />
          </section>

          <section aria-labelledby="results-h">
            <SectionHeader id="results-h" title="การติดตามผล" description="ตัวเลขมาจากไฟล์ที่นำเข้าในหน้า Analytics เท่านั้น" />
            <div className="flex flex-col gap-4 text-[13px]">
              <div>
                <p className="font-medium">รหัสติดตาม</p>
                <p className="mb-2 text-muted-foreground">ใส่รหัสนี้ในช่อง Sub_id ตอนสร้างลิงก์ใน Shopee Affiliate แล้วใช้ลิงก์นั้นกับโพสต์นี้ คำสั่งซื้อที่มีรหัสนี้จะนับค่าคอมให้วิดีโอนี้</p>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded-md border bg-surface-muted px-2 py-1 font-mono text-sm">{pub.tracking_code}</code>
                  <CopyButton value={pub.tracking_code} label="คัดลอกรหัส" />
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                {[
                  ["ยอดดู", results.latest?.views],
                  ["ถูกใจ", results.latest?.likes],
                  ["ความคิดเห็น", results.latest?.comments],
                  ["แชร์", results.latest?.shares],
                ].map(([label, v]) => (
                  <div key={label as string}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-semibold tabular-nums">{v == null ? <span className="font-normal text-muted-foreground">ไม่มีข้อมูล</span> : (v as number).toLocaleString("th-TH")}</dd>
                  </div>
                ))}
                <div>
                  <dt className="text-muted-foreground">ค่าคอมยืนยันแล้ว</dt>
                  <dd className="font-semibold tabular-nums">
                    {conversions?.length ? thb(results.commission.completed.commission) : <span className="font-normal text-muted-foreground">ไม่มีข้อมูล</span>}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">คำสั่งซื้อ</dt>
                  <dd className="tabular-nums">
                    {conversions?.length ? (
                      `ยืนยัน ${results.commission.completed.orders} · รอ ${results.commission.pending.orders} · ยกเลิก ${results.commission.cancelled.orders}`
                    ) : (
                      <span className="text-muted-foreground">ไม่มีข้อมูล</span>
                    )}
                  </dd>
                </div>
              </dl>
              {results.latest && (
                <p className="text-xs text-muted-foreground">
                  ยอดสะสม ณ {formatDate(results.latest.capturedOn)} (นำเข้า {results.latest.snapshots} ครั้ง)
                </p>
              )}
            </div>
          </section>
        </div>

        <aside aria-label="สถานะการเผยแพร่" className="order-first flex flex-col gap-4 lg:sticky lg:top-4 lg:order-none">
          {unposted && (
            <section className="rounded-lg border bg-surface p-4 text-[13px]">
              <h2 className="mb-2 font-semibold">ตรวจก่อนโพสต์</h2>
              <ul className="flex flex-col gap-1.5">
                <li className="flex items-start gap-1.5">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden /> สคริปต์อนุมัติแล้วและวิดีโอผ่านการตรวจคุณภาพ
                </li>
                {!issues.some((i) => i.message.includes("เปิดเผย")) && (
                  <li className="flex items-start gap-1.5">
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden /> แคปชันมีข้อความเปิดเผย affiliate
                  </li>
                )}
                {issues.map((i) => {
                  const Icon = i.level === "error" ? XCircle : TriangleAlert;
                  return (
                    <li key={i.message} className="flex items-start gap-1.5">
                      <Icon className={i.level === "error" ? "mt-0.5 size-3.5 shrink-0 text-destructive" : "mt-0.5 size-3.5 shrink-0 text-warning"} aria-hidden />
                      <span>
                        <span className="sr-only">{i.level === "error" ? "ต้องแก้: " : "ข้อสังเกต: "}</span>
                        {i.message}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {unposted ? (
            <>
              <section className="rounded-lg border bg-surface p-4">
                <h2 className="mb-1 font-semibold">บันทึกการเผยแพร่</h2>
                <p className="mb-3 text-[13px] text-muted-foreground">โพสต์วิดีโอบน {adapter.label} ด้วยตัวเอง แล้ววางลิงก์โพสต์ที่นี่</p>
                {blocked && (
                  <Notice tone="error" className="mb-3">
                    แก้รายการที่ต้องแก้ก่อนบันทึก
                  </Notice>
                )}
                <MarkPublishedForm id={pub.id} platformLabel={adapter.label} blocked={blocked} />
              </section>
              <section className="rounded-lg border bg-surface p-4">
                <h2 className="mb-3 font-semibold">ตั้งเวลา</h2>
                <ScheduleForm id={pub.id} scheduledFor={pub.scheduled_for} />
              </section>
            </>
          ) : (
            <section className="rounded-lg border bg-surface p-4 text-[13px]">
              <h2 className="mb-2 font-semibold">{status === "published" ? "เผยแพร่แล้ว" : "ลบโพสต์แล้ว"}</h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                <dt className="text-muted-foreground">เมื่อ</dt>
                <dd>{formatDateTime(pub.published_at)}</dd>
                {pub.external_id && (
                  <>
                    <dt className="text-muted-foreground">รหัสโพสต์</dt>
                    <dd className="break-all">{pub.external_id}</dd>
                  </>
                )}
                {pub.withdrawn_at && (
                  <>
                    <dt className="text-muted-foreground">ลบเมื่อ</dt>
                    <dd>{formatDateTime(pub.withdrawn_at)}</dd>
                  </>
                )}
              </dl>
              {pub.external_url && (
                <a href={pub.external_url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 break-all text-primary hover:underline">
                  เปิดโพสต์ <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                </a>
              )}
              <p className="mt-2 text-xs text-muted-foreground">บันทึกโดยคุณ (ไม่ได้ยืนยันจากแพลตฟอร์ม เพราะยังไม่ได้เชื่อมต่อ API)</p>
              {status === "published" && (
                <div className="mt-3">
                  <WithdrawButton id={pub.id} />
                </div>
              )}
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
