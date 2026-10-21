import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { isOpenRouterConfigured } from "@/features/ai/openrouter";
import { batchBudgetLeft, type BatchItemStatus } from "@/features/content/batch";
import { type BatchRow, BatchRunner } from "@/features/content/batch-runner";
import { getTemplate, type Platform, PLATFORM_LABEL } from "@/features/content/templates";
import { formatDateTime } from "@/features/products/data-value";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "ชุดวิดีโอ" };

export default async function BatchPage({ params, searchParams }: { params: Promise<{ batchId: string }>; searchParams: Promise<{ start?: string }> }) {
  const [{ batchId }, { start }] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(batchId).success) notFound();
  const { supabase } = await getCurrentUser();
  const db = supabase!;
  const { data: batch } = await db.from("content_batches").select("*").eq("id", batchId).maybeSingle();
  if (!batch) notFound();
  const { data: items } = await db
    .from("content_batch_items")
    .select("id, status, error, cost_thb, storyboard_id, product:products(name), storyboard:storyboards(status, render_jobs(status, created_at))")
    .eq("batch_id", batchId)
    .order("position");
  const rows: BatchRow[] = (items ?? []).map((i) => ({
    id: i.id,
    productName: i.product?.name ?? "(สินค้าถูกลบ)",
    status: i.status as BatchItemStatus,
    error: i.error,
    costThb: Number(i.cost_thb),
    storyboardId: i.storyboard_id,
    scriptStatus: i.storyboard?.status ?? null,
    renderStatus: [...(i.storyboard?.render_jobs ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.status ?? null,
  }));
  const left = batchBudgetLeft(batch.budget_thb === null ? null : Number(batch.budget_thb), rows.map((r) => r.costThb));
  const template = getTemplate(batch.template_id);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "วางแผนคอนเทนต์", href: "/content" }, { label: "สร้างหลายวิดีโอ", href: "/content/batch" }, { label: formatDateTime(batch.created_at) }]}
        title={`ชุด ${rows.length} วิดีโอ`}
        description={[
          template?.name ?? batch.template_id,
          PLATFORM_LABEL[batch.platform as Platform],
          `${batch.target_duration_s} วินาที`,
          batch.use_ai ? `AI เขียนสคริปต์${left === null ? "" : ` · งบเหลือ ฿${Math.max(0, left).toLocaleString("th-TH", { maximumFractionDigits: 2 })}`}` : "ร่างจาก template",
        ].join(" · ")}
      />
      <BatchRunner batchId={batch.id} useAi={batch.use_ai} rows={rows} autoStart={start === "1"} voiceAvailable={isOpenRouterConfigured()} />
    </>
  );
}
