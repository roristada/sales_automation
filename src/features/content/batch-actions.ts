"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isOpenRouterConfigured } from "@/features/ai/openrouter";
import type { ActionResult } from "@/features/products/actions";
import { queueRender } from "@/features/video/actions";
import { getCurrentUser } from "@/lib/supabase/server";
import { applyAiScript, createProjectFromTemplate } from "./actions";
import { aiDraftScript } from "./ai-actions";
import { batchBudgetLeft, MAX_BATCH_PRODUCTS, STALE_WORK_MS } from "./batch";
import { DURATIONS, getTemplate, PLATFORMS } from "./templates";

/*
 * "สร้างหลายวิดีโอ" (docs/AI_VIDEO_PLAN.md AI-6). A batch drafts one project per product from the
 * template and, if asked, has AI write each script — one item per call, so the page shows
 * progress and a failure stays with its product. Every script still waits for the user to check
 * its claims and approve it in Script Studio; only approved scripts are rendered.
 */

const uuid = z.uuid();

async function requireUser() {
  const { supabase, user } = await getCurrentUser();
  if (!supabase || !user) throw new Error("ยังไม่ได้เข้าสู่ระบบ");
  return { supabase, user };
}

const batchSchema = z.object({
  productIds: z.array(z.uuid()).min(1, "เลือกสินค้าอย่างน้อย 1 รายการ").max(MAX_BATCH_PRODUCTS, `เลือกได้ครั้งละไม่เกิน ${MAX_BATCH_PRODUCTS} สินค้า`),
  templateId: z.string().refine((id) => !!getTemplate(id), "เลือกรูปแบบคอนเทนต์"),
  platform: z.enum(PLATFORMS, { error: "เลือกแพลตฟอร์ม" }),
  durationS: z.number().refine((n) => (DURATIONS as readonly number[]).includes(n), "เลือกความยาว"),
  useAi: z.boolean(),
  budgetThb: z.number().min(0, "งบต้องไม่ติดลบ").max(100_000, "งบมากเกินไป").nullable(),
});

export async function createBatch(input: z.input<typeof batchSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const b = parsed.data;
  if (b.useAi && !isOpenRouterConfigured()) return { ok: false, error: "ยังไม่ได้ตั้งค่า OPENROUTER_API_KEY — ปิด “ให้ AI เขียนสคริปต์” หรือตั้งค่าก่อน" };
  const ids = [...new Set(b.productIds)];
  const { supabase, user } = await requireUser();
  const { data: batch, error } = await supabase
    .from("content_batches")
    .insert({ owner_id: user.id, template_id: b.templateId, platform: b.platform, target_duration_s: b.durationS, use_ai: b.useAi, budget_thb: b.useAi ? b.budgetThb : null })
    .select("id")
    .single();
  if (error) return { ok: false, error: `สร้างชุดงานไม่สำเร็จ: ${error.message}` };
  const { error: itemError } = await supabase.from("content_batch_items").insert(ids.map((product_id, position) => ({ batch_id: batch.id, product_id, position })));
  if (itemError) {
    await supabase.from("content_batches").delete().eq("id", batch.id);
    return { ok: false, error: itemError.code === "42501" ? "ไม่พบสินค้าบางรายการ" : `สร้างชุดงานไม่สำเร็จ: ${itemError.message}` };
  }
  revalidatePath("/content/batch");
  return { ok: true, data: { id: batch.id } };
}

export interface BatchItemResult {
  status: string;
  error: string | null;
  costThb: number;
  storyboardId: string | null;
}

/**
 * Runs one item as far as it goes: draft from the template, then (batch with AI) write the
 * script. Claimed with status "working" so two tabs can't do the same item twice.
 */
export async function runBatchItem(itemId: string): Promise<ActionResult<BatchItemResult>> {
  if (!uuid.safeParse(itemId).success) return { ok: false, error: "รหัสไม่ถูกต้อง" };
  const { supabase } = await requireUser();
  const staleBefore = new Date(Date.now() - STALE_WORK_MS).toISOString();
  const { data: item } = await supabase
    .from("content_batch_items")
    .update({ status: "working", error: null })
    .eq("id", itemId)
    .or(`status.in.(pending,drafted,failed),and(status.eq.working,updated_at.lt.${staleBefore})`)
    .select("*, batch:content_batches(*)")
    .maybeSingle();
  if (!item?.batch) return { ok: false, error: "งานนี้กำลังทำอยู่ หรือเสร็จไปแล้ว" };
  const batch = item.batch;

  const finish = async (patch: { status: "drafted" | "written" | "failed"; error?: string | null }) => {
    let cost = 0;
    if (item.storyboard_id) {
      const { data } = await supabase.from("ai_requests").select("cost_thb").eq("storyboard_id", item.storyboard_id);
      cost = (data ?? []).reduce((n, r) => n + Number(r.cost_thb), 0);
    }
    await supabase
      .from("content_batch_items")
      .update({ status: patch.status, error: patch.error ?? null, project_id: item.project_id, storyboard_id: item.storyboard_id, cost_thb: cost })
      .eq("id", itemId);
    revalidatePath(`/content/batch/${batch.id}`);
    return { ok: true as const, data: { status: patch.status, error: patch.error ?? null, costThb: cost, storyboardId: item.storyboard_id } };
  };

  if (!item.storyboard_id) {
    const created = await createProjectFromTemplate({ product_id: item.product_id, template_id: batch.template_id, platform: batch.platform as (typeof PLATFORMS)[number], target_duration_s: batch.target_duration_s });
    if (!created.ok) return finish({ status: "failed", error: created.error });
    item.project_id = created.data.projectId;
    item.storyboard_id = created.data.storyboardId;
  }
  if (!batch.use_ai) return finish({ status: "drafted" });

  const { data: sb } = await supabase.from("storyboards").select("status").eq("id", item.storyboard_id).maybeSingle();
  if (sb?.status !== "draft") return finish({ status: "drafted", error: "สคริปต์นี้อนุมัติแล้ว — ไม่ให้ AI เขียนทับ" });
  const { data: items } = await supabase.from("content_batch_items").select("cost_thb").eq("batch_id", batch.id);
  const left = batchBudgetLeft(batch.budget_thb === null ? null : Number(batch.budget_thb), (items ?? []).map((i) => Number(i.cost_thb)));
  if (left !== null && left <= 0) return finish({ status: "drafted", error: "งบ AI ของชุดนี้หมดแล้ว — เขียนต่อเองใน Studio หรือสร้างชุดใหม่ที่งบมากขึ้น" });

  const draft = await aiDraftScript(item.storyboard_id, { instruction: "" });
  if (!draft.ok) return finish({ status: "failed", error: draft.error });
  const applied = await applyAiScript(item.storyboard_id, draft.data.draft);
  if (!applied.ok) return finish({ status: "failed", error: applied.error });
  return finish({ status: "written", error: draft.data.warnings.length ? draft.data.warnings.join(" · ").slice(0, 1000) : null });
}

/**
 * Queues renders for the batch's approved scripts that have no finished or active render yet.
 * Each goes through queueRender (caps, AI clips required, voice spend guard).
 */
export async function renderBatch(batchId: string, opts: { voice: boolean; confirmed?: boolean }): Promise<ActionResult<{ queued: number; skipped: number; errors: string[] }> | { ok: false; error: string; needsConfirm: true }> {
  if (!uuid.safeParse(batchId).success) return { ok: false, error: "รหัสไม่ถูกต้อง" };
  const { supabase } = await requireUser();
  const { data: items } = await supabase
    .from("content_batch_items")
    .select("position, storyboard:storyboards(id, status, render_jobs(status)), product:products(name)")
    .eq("batch_id", batchId)
    .order("position");
  if (!items) return { ok: false, error: "ไม่พบชุดงาน" };
  let queued = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const it of items) {
    const sb = it.storyboard;
    if (!sb || sb.status !== "approved" || sb.render_jobs.some((j) => ["queued", "processing", "completed"].includes(j.status))) {
      skipped++;
      continue;
    }
    const res = await queueRender(sb.id, { voice: opts.voice, confirmed: opts.confirmed });
    if (res.ok) queued++;
    else if ("needsConfirm" in res) return { ok: false, error: `${it.product?.name ?? "สินค้า"}: ${res.error}`, needsConfirm: true };
    else errors.push(`${it.product?.name ?? `งานที่ ${it.position + 1}`}: ${res.error}`);
  }
  revalidatePath(`/content/batch/${batchId}`);
  return { ok: true, data: { queued, skipped, errors } };
}
