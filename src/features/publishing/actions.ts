"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PLATFORMS, type Platform } from "@/features/content/templates";
import type { ActionResult } from "@/features/products/actions";
import { getCurrentUser } from "@/lib/supabase/server";
import { checkPostUrl, checkPublication, composeCaption } from "./publishing";

const uuid = z.uuid();
const platform = z.enum(PLATFORMS);
const httpUrl = z
  .string()
  .trim()
  .max(2000, "ลิงก์ยาวเกินไป")
  .refine((v) => /^https?:\/\/\S+$/.test(v), "ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://");

/** Readable Thai message for errors the publications table raises. */
function dbError(error: { code?: string; message: string }): string {
  if (error.code === "23505")
    return error.message.includes("external_url") ? "ลิงก์โพสต์นี้ถูกบันทึกไว้แล้วในรายการอื่น" : "คอนเทนต์นี้มีรายการเผยแพร่บนแพลตฟอร์มนี้อยู่แล้ว — เปิดรายการเดิม หรือบันทึกว่าลบโพสต์ก่อนโพสต์ใหม่";
  if (error.code === "23514") return "ข้อมูลไม่ครบ: แคปชันต้องมีข้อความเปิดเผย affiliate และการเผยแพร่ต้องมีลิงก์โพสต์";
  if (error.message.includes("QA")) return "วิดีโอนี้ไม่ผ่านการตรวจคุณภาพ";
  if (error.message.includes("already published")) return "รายการที่เผยแพร่แล้วแก้ได้เฉพาะหมายเหตุและรหัสโพสต์";
  if (error.message.includes("status change")) return "เปลี่ยนสถานะแบบนี้ไม่ได้";
  return error.message;
}

function revalidate(id?: string, storyboardId?: string) {
  revalidatePath("/publishing");
  if (id) revalidatePath(`/publishing/${id}`);
  if (storyboardId) revalidatePath(`/videos/${storyboardId}`);
  revalidatePath("/dashboard");
}

/** Prepares an export pack + manual publication record for one rendered video. */
export async function createPublication(outputId: string, target: Platform): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(outputId).success || !platform.safeParse(target).success) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const { supabase, user } = await getCurrentUser();
  if (!supabase || !user) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };

  const { data: out } = await supabase
    .from("render_outputs")
    .select("id, job:render_jobs(storyboard:storyboards(id, project_id, caption, disclosure, project:content_projects(product:products(affiliate_url))))")
    .eq("id", outputId)
    .maybeSingle();
  const sb = out?.job?.storyboard;
  if (!sb) return { ok: false, error: "ไม่พบวิดีโอ" };

  const { data: existing } = await supabase.from("publications").select("id").eq("project_id", sb.project_id).eq("platform", target).neq("status", "withdrawn").maybeSingle();
  if (existing) return { ok: true, data: { id: existing.id } };

  const affiliateUrl = sb.project?.product?.affiliate_url ?? null;
  const { data, error } = await supabase
    .from("publications")
    .insert({
      render_output_id: outputId,
      platform: target,
      caption: composeCaption({ caption: sb.caption, disclosure: sb.disclosure, affiliateUrl, platform: target }),
      affiliate_url: affiliateUrl && /^https?:\/\//.test(affiliateUrl) ? affiliateUrl : null,
      // Derived again by the DB trigger from the output; passed only to satisfy the types.
      storyboard_id: sb.id,
      project_id: sb.project_id,
      disclosure: sb.disclosure,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: dbError(error) };
  revalidate(data.id, sb.id);
  return { ok: true, data: { id: data.id } };
}

const detailsSchema = z.object({
  caption: z.string().trim().min(1, "ต้องมีแคปชัน").max(5000, "แคปชันยาวเกินไป"),
  affiliate_url: z.union([z.literal(""), httpUrl]),
  notes: z.string().trim().max(1000, "หมายเหตุยาวเกินไป"),
});

export type DetailsInput = z.input<typeof detailsSchema>;
export type DetailsResult = ActionResult<null> & { fieldErrors?: Partial<Record<keyof DetailsInput, string>> };

/** Edits caption/link (unposted only — the DB refuses caption edits once posted) and notes. */
export async function saveDetails(id: string, input: DetailsInput): Promise<DetailsResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "รหัสไม่ถูกต้อง" };
  const parsed = detailsSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: DetailsResult["fieldErrors"] = {};
    for (const i of parsed.error.issues) fieldErrors[i.path[0] as keyof DetailsInput] ??= i.message;
    return { ok: false, error: "ตรวจข้อมูลที่ไฮไลต์", fieldErrors };
  }
  const { supabase } = await getCurrentUser();
  if (!supabase) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };
  const { data: pub } = await supabase.from("publications").select("status, disclosure").eq("id", id).maybeSingle();
  if (!pub) return { ok: false, error: "ไม่พบรายการ" };
  if (!parsed.data.caption.includes(pub.disclosure)) return { ok: false, error: "ตรวจข้อมูลที่ไฮไลต์", fieldErrors: { caption: "ต้องคงข้อความเปิดเผย affiliate ไว้ในแคปชัน" } };

  const posted = pub.status === "published" || pub.status === "withdrawn";
  const patch = posted ? { notes: parsed.data.notes || null } : { caption: parsed.data.caption, affiliate_url: parsed.data.affiliate_url || null, notes: parsed.data.notes || null };
  const { error } = await supabase.from("publications").update(patch).eq("id", id);
  if (error) return { ok: false, error: dbError(error) };
  revalidate(id);
  return { ok: true, data: null };
}

/** Plans a time to post (a reminder for the user; nothing is posted automatically). Null clears it. */
export async function setSchedule(id: string, scheduledFor: string | null): Promise<ActionResult<null>> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "รหัสไม่ถูกต้อง" };
  if (scheduledFor !== null && Number.isNaN(Date.parse(scheduledFor))) return { ok: false, error: "วันเวลาไม่ถูกต้อง" };
  const { supabase } = await getCurrentUser();
  if (!supabase) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };
  const { data, error } = await supabase
    .from("publications")
    .update(scheduledFor ? { status: "scheduled", scheduled_for: new Date(scheduledFor).toISOString() } : { status: "draft", scheduled_for: null })
    .eq("id", id)
    .in("status", ["draft", "scheduled"])
    .select("id");
  if (error) return { ok: false, error: dbError(error) };
  if (!data?.length) return { ok: false, error: "รายการนี้เผยแพร่ไปแล้ว ตั้งเวลาไม่ได้" };
  revalidate(id);
  return { ok: true, data: null };
}

const publishedSchema = z.object({
  external_url: z.string().trim().min(1, "ใส่ลิงก์โพสต์"),
  external_id: z.string().trim().max(200, "ยาวเกินไป"),
  published_at: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "วันเวลาไม่ถูกต้อง"),
});

export type PublishedInput = z.input<typeof publishedSchema>;
export type PublishedResult = ActionResult<null> & { fieldErrors?: Partial<Record<keyof PublishedInput, string>> };

/**
 * The user posted the video themselves. Records the post URL — without it the app never shows
 * "published" (design.md §9.8).
 */
export async function markPublished(id: string, input: PublishedInput): Promise<PublishedResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "รหัสไม่ถูกต้อง" };
  const parsed = publishedSchema.safeParse(input);
  const fieldErrors: PublishedResult["fieldErrors"] = {};
  if (!parsed.success) for (const i of parsed.error.issues) fieldErrors[i.path[0] as keyof PublishedInput] ??= i.message;
  const { supabase } = await getCurrentUser();
  if (!supabase) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };
  const { data: pub } = await supabase.from("publications").select("status, platform, caption, disclosure, affiliate_url, storyboard_id").eq("id", id).maybeSingle();
  if (!pub) return { ok: false, error: "ไม่พบรายการ" };
  if (pub.status !== "draft" && pub.status !== "scheduled") return { ok: false, error: "รายการนี้บันทึกการเผยแพร่ไปแล้ว" };

  const target = pub.platform as Platform;
  if (parsed.success) {
    const urlError = checkPostUrl(parsed.data.external_url, target);
    if (urlError) fieldErrors.external_url = urlError;
    if (Date.parse(parsed.data.published_at) > Date.now() + 5 * 60_000) fieldErrors.published_at = "เวลาเผยแพร่ต้องไม่อยู่ในอนาคต";
  }
  if (Object.keys(fieldErrors).length || !parsed.success) return { ok: false, error: "ตรวจข้อมูลที่ไฮไลต์", fieldErrors };

  const blocking = checkPublication({ caption: pub.caption, disclosure: pub.disclosure, affiliateUrl: pub.affiliate_url, platform: target, isLatestRender: true }).filter((i) => i.level === "error");
  if (blocking.length) return { ok: false, error: blocking.map((i) => i.message).join(" · ") };

  const { error } = await supabase
    .from("publications")
    .update({
      status: "published",
      external_url: new URL(parsed.data.external_url).toString(),
      external_id: parsed.data.external_id || null,
      published_at: new Date(parsed.data.published_at).toISOString(),
    })
    .eq("id", id);
  if (error) {
    const message = dbError(error);
    return error.code === "23505" ? { ok: false, error: "ตรวจข้อมูลที่ไฮไลต์", fieldErrors: { external_url: message } } : { ok: false, error: message };
  }
  revalidate(id, pub.storyboard_id);
  return { ok: true, data: null };
}

/** The post was taken down. Kept as history; the content can then be posted again. */
export async function withdrawPublication(id: string): Promise<ActionResult<null>> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "รหัสไม่ถูกต้อง" };
  const { supabase } = await getCurrentUser();
  if (!supabase) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };
  const { data, error } = await supabase.from("publications").update({ status: "withdrawn" }).eq("id", id).eq("status", "published").select("storyboard_id");
  if (error) return { ok: false, error: dbError(error) };
  if (!data?.length) return { ok: false, error: "บันทึกได้เฉพาะรายการที่เผยแพร่แล้ว" };
  revalidate(id, data[0].storyboard_id);
  return { ok: true, data: null };
}

/** Deletes an unposted record (posted ones are kept; the DB refuses). */
export async function deletePublication(id: string): Promise<ActionResult<null>> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "รหัสไม่ถูกต้อง" };
  const { supabase } = await getCurrentUser();
  if (!supabase) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };
  const { data, error } = await supabase.from("publications").delete().eq("id", id).select("storyboard_id");
  if (error) return { ok: false, error: dbError(error) };
  if (!data?.length) return { ok: false, error: "ลบไม่ได้ — รายการที่เผยแพร่แล้วเก็บไว้เป็นประวัติ (บันทึกว่าลบโพสต์แทน)" };
  revalidate(undefined, data[0].storyboard_id);
  return { ok: true, data: null };
}

/** Points an unposted record at the newest render of the same content. */
export async function switchToLatestRender(id: string): Promise<ActionResult<null>> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "รหัสไม่ถูกต้อง" };
  const { supabase } = await getCurrentUser();
  if (!supabase) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };
  const { data: pub } = await supabase.from("publications").select("project_id, render_output_id").eq("id", id).maybeSingle();
  if (!pub) return { ok: false, error: "ไม่พบรายการ" };
  const latest = await latestOutputForProject(pub.project_id);
  if (!latest || latest.id === pub.render_output_id) return { ok: false, error: "ใช้วิดีโอล่าสุดอยู่แล้ว" };
  const { data, error } = await supabase.from("publications").update({ render_output_id: latest.id }).eq("id", id).in("status", ["draft", "scheduled"]).select("id");
  if (error) return { ok: false, error: dbError(error) };
  if (!data?.length) return { ok: false, error: "รายการที่เผยแพร่แล้วเปลี่ยนวิดีโอไม่ได้" };
  revalidate(id);
  return { ok: true, data: null };
}

/** Newest completed render of an approved storyboard in the project (RLS: caller's own). */
async function latestOutputForProject(projectId: string) {
  const { supabase } = await getCurrentUser();
  const { data } = await supabase!
    .from("render_outputs")
    .select("id, created_at, job:render_jobs!inner(storyboard:storyboards!inner(project_id))")
    .eq("job.storyboard.project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
}
