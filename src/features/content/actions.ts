"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/features/products/actions";
import { formatTHB } from "@/features/products/data-value";
import { fieldStatus, type Provenance } from "@/features/products/schema";
import type { Json } from "@/lib/supabase/database.types";
import { getCurrentUser } from "@/lib/supabase/server";
import { checkFacts, MAX_DESCRIPTION_CHARS, MAX_EXTRACTED_FACTS } from "./fact-extract";
import { claimFactKey, parseFactKey } from "./facts";
import { loadFacts, loadStudio, PRODUCT_COLUMNS, type Db } from "./queries";
import { DURATIONS, getTemplate, PLATFORMS, type StoryboardDraft, TEMPLATE_VERSION, type TemplateContext } from "./templates";
import { canApprove, type ValidationIssue } from "./validate";

async function requireUser() {
  const { supabase, user } = await getCurrentUser();
  if (!supabase || !user) throw new Error("ยังไม่ได้เข้าสู่ระบบ");
  return { supabase, user };
}

const LOCKED = "สคริปต์นี้อนุมัติแล้วจึงแก้ไขไม่ได้ — สร้างเวอร์ชันใหม่เพื่อแก้";

/** Maps database errors to messages a user can act on. */
function dbError(error: { code?: string; message: string }, action = "บันทึก"): string {
  if (error.code === "P0001") return LOCKED;
  if (error.code === "23503") return "ข้อเท็จจริงนี้ถูกอ้างอิงใน claim อยู่ — ลบหรือเปลี่ยน claim ที่อ้างอิงก่อน";
  return `${action}ไม่สำเร็จ: ${error.message}`;
}

const uuid = z.uuid();
const studioPath = (id: string) => `/studio/${id}`;

// ---------------------------------------------------------------------------
// Product facts
// ---------------------------------------------------------------------------

export interface FactFormState {
  error?: string;
  fieldErrors?: Partial<Record<"label" | "value" | "source_url", string>>;
  ok?: boolean;
}

const factSchema = z.object({
  label: z.string().trim().min(1, "ต้องระบุหัวข้อ").max(80, "ยาวเกิน 80 ตัวอักษร"),
  value: z.string().trim().min(1, "ต้องระบุรายละเอียด").max(300, "ยาวเกิน 300 ตัวอักษร"),
  source_url: z
    .string()
    .trim()
    .max(2000)
    .transform((s) => s || null)
    .pipe(z.url({ protocol: /^https?$/, error: "URL ต้องขึ้นต้นด้วย http:// หรือ https://" }).nullable()),
});

export async function saveFact(productId: string, factId: string | null, _prev: FactFormState, formData: FormData): Promise<FactFormState> {
  if (!uuid.safeParse(productId).success || (factId && !uuid.safeParse(factId).success)) return { error: "รหัสไม่ถูกต้อง" };
  const parsed = factSchema.safeParse({ label: formData.get("label") ?? "", value: formData.get("value") ?? "", source_url: formData.get("source_url") ?? "" });
  if (!parsed.success) {
    const fe: FactFormState["fieldErrors"] = {};
    for (const i of parsed.error.issues) fe[i.path[0] as "label"] ??= i.message;
    return { fieldErrors: fe };
  }
  const { supabase, user } = await requireUser();
  if (factId) {
    // Editing a fact changes what claims rely on; the user re-checks claims that cite it.
    const { error } = await supabase.from("product_facts").update({ ...parsed.data, status: "user_provided" }).eq("id", factId);
    if (error) return { error: dbError(error) };
    // Only drafts: approved storyboards are locked and keep their snapshot of the fact.
    const { data: cited } = await supabase
      .from("scene_claims")
      .select("id, scene:storyboard_scenes!inner(storyboard:storyboards!inner(status))")
      .eq("fact_id", factId)
      .eq("review_status", "verified")
      .eq("scene.storyboard.status", "draft");
    if (cited?.length) {
      await supabase
        .from("scene_claims")
        .update({ review_status: "pending" })
        .in(
          "id",
          cited.map((c) => c.id),
        );
    }
  } else {
    const { count } = await supabase.from("product_facts").select("id", { count: "exact", head: true }).eq("product_id", productId);
    const { error } = await supabase.from("product_facts").insert({ ...parsed.data, product_id: productId, owner_id: user.id, position: count ?? 0 });
    if (error) return { error: dbError(error) };
  }
  revalidatePath(`/products/${productId}`);
  return { ok: true };
}

export async function deleteFact(productId: string, factId: string): Promise<ActionResult<null>> {
  if (!uuid.safeParse(factId).success) return { ok: false, error: "รหัสไม่ถูกต้อง" };
  const { supabase } = await requireUser();
  const { error, count } = await supabase.from("product_facts").delete({ count: "exact" }).eq("id", factId);
  if (error) return { ok: false, error: dbError(error, "ลบ") };
  if (!count) return { ok: false, error: "ไม่พบข้อเท็จจริง หรือไม่มีสิทธิ์ลบ" };
  revalidatePath(`/products/${productId}`);
  return { ok: true, data: null };
}

const extractedSchema = z.object({
  description: z.string().trim().min(1, "ไม่มีคำอธิบายสินค้า").max(MAX_DESCRIPTION_CHARS),
  facts: z
    .array(z.object({ label: z.string().trim().min(1).max(80), value: z.string().trim().min(1).max(300) }))
    .min(1, "เลือกอย่างน้อย 1 ข้อ")
    .max(MAX_EXTRACTED_FACTS, `เพิ่มได้ครั้งละไม่เกิน ${MAX_EXTRACTED_FACTS} ข้อ`),
});

/**
 * Saves facts an AI pulled from the product description, as "ai_estimate": they can't back a
 * script until confirmed. Re-checked here (duplicates, numbers missing from the description).
 */
export async function addExtractedFacts(productId: string, input: { description: string; facts: { label: string; value: string }[] }): Promise<ActionResult<{ added: number }>> {
  if (!uuid.safeParse(productId).success) return { ok: false, error: "รหัสไม่ถูกต้อง" };
  const parsed = extractedSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { supabase, user } = await requireUser();
  const { data: product } = await supabase.from("products").select("product_url").eq("id", productId).maybeSingle();
  if (!product) return { ok: false, error: "ไม่พบสินค้า" };
  const { data: existing } = await supabase.from("product_facts").select("label, value").eq("product_id", productId);
  const checked = checkFacts(parsed.data.facts, parsed.data.description, existing ?? []);
  const bad = checked.find((f) => f.problem);
  if (bad) return { ok: false, error: `“${bad.label}”: ${bad.problem}` };
  const start = existing?.length ?? 0;
  const { error } = await supabase.from("product_facts").insert(
    checked.map((f, i) => ({
      product_id: productId,
      owner_id: user.id,
      label: f.label,
      value: f.value,
      status: "ai_estimate",
      source_url: product.product_url,
      position: start + i,
    })),
  );
  if (error) return { ok: false, error: dbError(error) };
  revalidatePath(`/products/${productId}`);
  return { ok: true, data: { added: checked.length } };
}

/** The user checked an AI-extracted fact against its source. */
export async function confirmFact(productId: string, factId: string): Promise<ActionResult<null>> {
  if (!uuid.safeParse(factId).success) return { ok: false, error: "รหัสไม่ถูกต้อง" };
  const { supabase } = await requireUser();
  const { data: fact } = await supabase.from("product_facts").select("status, source_url").eq("id", factId).maybeSingle();
  if (!fact) return { ok: false, error: "ไม่พบข้อเท็จจริง" };
  if (fact.status !== "ai_estimate") return { ok: true, data: null };
  const { error } = await supabase
    .from("product_facts")
    .update({ status: fact.source_url ? "verified_source" : "user_provided" })
    .eq("id", factId);
  if (error) return { ok: false, error: dbError(error) };
  revalidatePath(`/products/${productId}`);
  return { ok: true, data: null };
}

/** Confirms every AI-extracted fact of a product at once (the user has checked them all). */
export async function confirmAllFacts(productId: string): Promise<ActionResult<{ confirmed: number }>> {
  if (!uuid.safeParse(productId).success) return { ok: false, error: "รหัสไม่ถูกต้อง" };
  const { supabase } = await requireUser();
  const pending = supabase.from("product_facts").update({ status: "verified_source" }, { count: "exact" }).eq("product_id", productId).eq("status", "ai_estimate");
  const withSource = await pending.not("source_url", "is", null);
  if (withSource.error) return { ok: false, error: dbError(withSource.error) };
  const withoutSource = await supabase.from("product_facts").update({ status: "user_provided" }, { count: "exact" }).eq("product_id", productId).eq("status", "ai_estimate").is("source_url", null);
  if (withoutSource.error) return { ok: false, error: dbError(withoutSource.error) };
  revalidatePath(`/products/${productId}`);
  return { ok: true, data: { confirmed: (withSource.count ?? 0) + (withoutSource.count ?? 0) } };
}

// ---------------------------------------------------------------------------
// Creating a project from a template
// ---------------------------------------------------------------------------

async function templateContext(db: Db, productId: string, platform: TemplateContext["platform"], durationS: number) {
  const { data: product } = await db.from("products").select(PRODUCT_COLUMNS).eq("id", productId).maybeSingle();
  if (!product) return null;
  const { rows } = await loadFacts(db, product);
  const priceStatus = fieldStatus({ ...product, provenance: product.provenance as Provenance }, "price");
  const ctx: TemplateContext = {
    productName: product.name,
    // A stale price still goes in (with its claim); validation blocks approval until it's refreshed.
    price: priceStatus === "unavailable" ? null : formatTHB(product.price),
    category: product.category,
    facts: rows.map((r) => ({ id: r.id, label: r.label, value: r.value })),
    platform,
    durationS,
  };
  return { product, ctx };
}

async function insertScenes(db: Db, ownerId: string, storyboardId: string, draft: StoryboardDraft): Promise<string | null> {
  const { data: scenes, error } = await db
    .from("storyboard_scenes")
    .insert(
      draft.scenes.map((s, i) => ({
        storyboard_id: storyboardId,
        owner_id: ownerId,
        position: i,
        kind: s.kind,
        narration: s.narration,
        on_screen_text: s.on_screen_text,
        visual_note: s.visual_note,
        text_origin: "template",
      })),
    )
    .select("id, position");
  if (error) return dbError(error);
  const idAt = new Map(scenes.map((s) => [s.position, s.id]));
  const claims = draft.scenes.flatMap((s, i) => s.claims.map((c) => ({ scene_id: idAt.get(i)!, owner_id: ownerId, text: c.text, ...parseFactKey(c.factKey) })));
  if (claims.length) {
    const { error: claimError } = await db.from("scene_claims").insert(claims);
    if (claimError) return dbError(claimError);
  }
  return null;
}

export interface CreateProjectState {
  error?: string;
  fieldErrors?: Partial<Record<"product_id" | "template_id" | "platform" | "target_duration_s" | "title", string>>;
}

const createSchema = z.object({
  product_id: z.uuid({ error: "เลือกสินค้า" }),
  template_id: z.string().refine((id) => !!getTemplate(id), "เลือกรูปแบบคอนเทนต์"),
  platform: z.enum(PLATFORMS, { error: "เลือกแพลตฟอร์ม" }),
  target_duration_s: z.coerce
    .number()
    .refine((n) => (DURATIONS as readonly number[]).includes(n), "เลือกความยาว"),
  title: z.string().trim().max(200, "ยาวเกิน 200 ตัวอักษร"),
});

export async function createContentProject(_prev: CreateProjectState, formData: FormData): Promise<CreateProjectState> {
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fe: CreateProjectState["fieldErrors"] = {};
    for (const i of parsed.error.issues) fe[i.path[0] as "title"] ??= i.message;
    return { fieldErrors: fe };
  }
  const input = parsed.data;
  const { supabase, user } = await requireUser();
  const loaded = await templateContext(supabase, input.product_id, input.platform, input.target_duration_s);
  if (!loaded) return { fieldErrors: { product_id: "ไม่พบสินค้า" } };
  const template = getTemplate(input.template_id)!;
  const draft = template.build(loaded.ctx);

  const { data: project, error } = await supabase
    .from("content_projects")
    .insert({
      owner_id: user.id,
      product_id: input.product_id,
      title: input.title || `${template.name}: ${loaded.product.name}`.slice(0, 200),
      platform: input.platform,
      target_duration_s: input.target_duration_s,
    })
    .select("id")
    .single();
  if (error) return { error: dbError(error) };

  const { data: sb, error: sbError } = await supabase
    .from("storyboards")
    .insert({
      project_id: project.id,
      owner_id: user.id,
      version: 1,
      template_id: template.id,
      template_version: TEMPLATE_VERSION,
      hook: draft.hook,
      caption: draft.caption,
      cta: draft.cta,
      disclosure: draft.disclosure,
    })
    .select("id")
    .single();
  const sceneError = sbError ? dbError(sbError) : await insertScenes(supabase, user.id, sb!.id, draft);
  if (sceneError) {
    await supabase.from("content_projects").delete().eq("id", project.id);
    return { error: sceneError };
  }
  revalidatePath("/content");
  redirect(studioPath(sb!.id));
}

export async function deleteContentProject(id: string): Promise<ActionResult<null>> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "รหัสไม่ถูกต้อง" };
  const { supabase } = await requireUser();
  const { error, count } = await supabase.from("content_projects").delete({ count: "exact" }).eq("id", id);
  if (error) return { ok: false, error: dbError(error, "ลบ") };
  if (!count) return { ok: false, error: "ไม่พบโปรเจกต์ หรือไม่มีสิทธิ์ลบ" };
  revalidatePath("/content");
  revalidatePath("/studio");
  return { ok: true, data: null };
}

// ---------------------------------------------------------------------------
// Editing a storyboard (all blocked by the DB lock once approved)
// ---------------------------------------------------------------------------

const storyboardTextSchema = z.object({
  hook: z.string().max(300, "Hook ยาวเกิน 300 ตัวอักษร"),
  caption: z.string().max(2200, "แคปชันยาวเกิน 2,200 ตัวอักษร"),
  cta: z.string().max(300, "CTA ยาวเกิน 300 ตัวอักษร"),
});

export async function updateStoryboardText(id: string, input: z.input<typeof storyboardTextSchema>): Promise<ActionResult<null>> {
  const parsed = storyboardTextSchema.safeParse(input);
  if (!uuid.safeParse(id).success || !parsed.success) return { ok: false, error: parsed.error?.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const { supabase } = await requireUser();
  const { error } = await supabase.from("storyboards").update(parsed.data).eq("id", id);
  if (error) return { ok: false, error: dbError(error) };
  revalidatePath(studioPath(id));
  return { ok: true, data: null };
}

const sceneTextSchema = z.object({
  narration: z.string().max(1000, "คำพูดยาวเกิน 1,000 ตัวอักษร"),
  on_screen_text: z.string().max(200, "ข้อความบนจอยาวเกิน 200 ตัวอักษร"),
  visual_note: z.string().max(500, "คำอธิบายภาพยาวเกิน 500 ตัวอักษร"),
});

/** Looks up which storyboard a scene belongs to (RLS-scoped). */
async function sceneStoryboard(db: Db, sceneId: string) {
  const { data } = await db.from("storyboard_scenes").select("id, storyboard_id, position").eq("id", sceneId).maybeSingle();
  return data;
}

export async function updateScene(sceneId: string, input: z.input<typeof sceneTextSchema>): Promise<ActionResult<null>> {
  const parsed = sceneTextSchema.safeParse(input);
  if (!uuid.safeParse(sceneId).success || !parsed.success) return { ok: false, error: parsed.error?.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const { supabase } = await requireUser();
  const scene = await sceneStoryboard(supabase, sceneId);
  if (!scene) return { ok: false, error: "ไม่พบฉาก" };
  const { error } = await supabase.from("storyboard_scenes").update({ ...parsed.data, text_origin: "user" }).eq("id", sceneId);
  if (error) return { ok: false, error: dbError(error) };
  revalidatePath(studioPath(scene.storyboard_id));
  return { ok: true, data: null };
}

/** Rewrites positions 0..n-1 in the given order. */
async function renumber(db: Db, storyboardId: string, orderedIds: string[]) {
  for (const [i, id] of orderedIds.entries()) {
    const { error } = await db.from("storyboard_scenes").update({ position: i }).eq("id", id).eq("storyboard_id", storyboardId);
    if (error) return error;
  }
  return null;
}

export async function addScene(storyboardId: string, afterPosition: number): Promise<ActionResult<null>> {
  if (!uuid.safeParse(storyboardId).success) return { ok: false, error: "รหัสไม่ถูกต้อง" };
  const { supabase, user } = await requireUser();
  const { data: scenes } = await supabase.from("storyboard_scenes").select("id").eq("storyboard_id", storyboardId).order("position");
  const { data: created, error } = await supabase
    .from("storyboard_scenes")
    .insert({ storyboard_id: storyboardId, owner_id: user.id, position: afterPosition + 1, kind: "custom", text_origin: "user" })
    .select("id")
    .single();
  if (error) return { ok: false, error: dbError(error) };
  const ids = (scenes ?? []).map((s) => s.id);
  ids.splice(afterPosition + 1, 0, created.id);
  const renumberError = await renumber(supabase, storyboardId, ids);
  if (renumberError) return { ok: false, error: dbError(renumberError) };
  revalidatePath(studioPath(storyboardId));
  return { ok: true, data: null };
}

export async function deleteScene(sceneId: string): Promise<ActionResult<null>> {
  if (!uuid.safeParse(sceneId).success) return { ok: false, error: "รหัสไม่ถูกต้อง" };
  const { supabase } = await requireUser();
  const scene = await sceneStoryboard(supabase, sceneId);
  if (!scene) return { ok: false, error: "ไม่พบฉาก" };
  const { error } = await supabase.from("storyboard_scenes").delete().eq("id", sceneId);
  if (error) return { ok: false, error: dbError(error, "ลบ") };
  const { data: rest } = await supabase.from("storyboard_scenes").select("id").eq("storyboard_id", scene.storyboard_id).order("position");
  await renumber(
    supabase,
    scene.storyboard_id,
    (rest ?? []).map((s) => s.id),
  );
  revalidatePath(studioPath(scene.storyboard_id));
  return { ok: true, data: null };
}

export async function moveScene(sceneId: string, direction: "up" | "down"): Promise<ActionResult<null>> {
  if (!uuid.safeParse(sceneId).success) return { ok: false, error: "รหัสไม่ถูกต้อง" };
  const { supabase } = await requireUser();
  const scene = await sceneStoryboard(supabase, sceneId);
  if (!scene) return { ok: false, error: "ไม่พบฉาก" };
  const { data: scenes } = await supabase.from("storyboard_scenes").select("id").eq("storyboard_id", scene.storyboard_id).order("position");
  const ids = (scenes ?? []).map((s) => s.id);
  const i = ids.indexOf(sceneId);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) return { ok: true, data: null };
  [ids[i], ids[j]] = [ids[j], ids[i]];
  const error = await renumber(supabase, scene.storyboard_id, ids);
  if (error) return { ok: false, error: dbError(error) };
  revalidatePath(studioPath(scene.storyboard_id));
  return { ok: true, data: null };
}

/** Resets one scene to the template's text for the same position, with current facts. */
export async function regenerateScene(sceneId: string): Promise<ActionResult<null>> {
  if (!uuid.safeParse(sceneId).success) return { ok: false, error: "รหัสไม่ถูกต้อง" };
  const { supabase, user } = await requireUser();
  const scene = await sceneStoryboard(supabase, sceneId);
  if (!scene) return { ok: false, error: "ไม่พบฉาก" };
  const bundle = await loadStudio(supabase, scene.storyboard_id);
  if (!bundle) return { ok: false, error: "ไม่พบสคริปต์" };
  if (bundle.storyboard.status === "approved") return { ok: false, error: LOCKED };
  const template = getTemplate(bundle.storyboard.template_id);
  const loaded = template && (await templateContext(supabase, bundle.product.id, bundle.project.platform as TemplateContext["platform"], bundle.project.target_duration_s));
  const draft = template && loaded ? template.build(loaded.ctx).scenes[scene.position] : undefined;
  if (!draft) return { ok: false, error: "template ไม่มีฉากในตำแหน่งนี้ — แก้ข้อความเองได้" };

  const { error } = await supabase
    .from("storyboard_scenes")
    .update({ kind: draft.kind, narration: draft.narration, on_screen_text: draft.on_screen_text, visual_note: draft.visual_note, text_origin: "template" })
    .eq("id", sceneId);
  if (error) return { ok: false, error: dbError(error) };
  await supabase.from("scene_claims").delete().eq("scene_id", sceneId);
  if (draft.claims.length) {
    const { error: claimError } = await supabase
      .from("scene_claims")
      .insert(draft.claims.map((c) => ({ scene_id: sceneId, owner_id: user.id, text: c.text, ...parseFactKey(c.factKey) })));
    if (claimError) return { ok: false, error: dbError(claimError) };
  }
  revalidatePath(studioPath(scene.storyboard_id));
  return { ok: true, data: null };
}

const aiSceneSchema = sceneTextSchema.extend({
  claims: z
    .array(z.object({ text: z.string().trim().min(1).max(300), factKey: z.string().max(60).nullable() }))
    .max(20, "CLAIM มากเกิน 20 ข้อ"),
});

/**
 * Replaces a scene's text and claims with an AI reply the user pasted back (manual AI help).
 * Marked text_origin "ai"; every claim starts "pending" so it must be checked again.
 */
export async function applyAiSceneText(sceneId: string, input: z.input<typeof aiSceneSchema>): Promise<ActionResult<null>> {
  const parsed = aiSceneSchema.safeParse(input);
  if (!uuid.safeParse(sceneId).success || !parsed.success) return { ok: false, error: parsed.error?.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const { supabase, user } = await requireUser();
  const scene = await sceneStoryboard(supabase, sceneId);
  if (!scene) return { ok: false, error: "ไม่พบฉาก" };
  for (const c of parsed.data.claims) {
    const belongs = await checkFactBelongs(supabase, scene.storyboard_id, c.factKey);
    if (belongs) return { ok: false, error: belongs };
  }
  const { claims, ...text } = parsed.data;
  const { error } = await supabase.from("storyboard_scenes").update({ ...text, text_origin: "ai" }).eq("id", sceneId);
  if (error) return { ok: false, error: dbError(error) };
  const { error: delError } = await supabase.from("scene_claims").delete().eq("scene_id", sceneId);
  if (delError) return { ok: false, error: dbError(delError) };
  if (claims.length) {
    const { error: claimError } = await supabase
      .from("scene_claims")
      .insert(claims.map((c) => ({ scene_id: sceneId, owner_id: user.id, text: c.text, ...parseFactKey(c.factKey) })));
    if (claimError) return { ok: false, error: dbError(claimError) };
  }
  revalidatePath(studioPath(scene.storyboard_id));
  return { ok: true, data: null };
}

/** Shows a library asset in a scene instead of the product photo (null = product photo). */
export async function setSceneAsset(sceneId: string, assetId: string | null): Promise<ActionResult<null>> {
  if (!uuid.safeParse(sceneId).success || (assetId !== null && !uuid.safeParse(assetId).success)) return { ok: false, error: "รหัสไม่ถูกต้อง" };
  const { supabase } = await requireUser();
  const scene = await sceneStoryboard(supabase, sceneId);
  if (!scene) return { ok: false, error: "ไม่พบฉาก" };
  const { error } = await supabase.from("storyboard_scenes").update({ asset_id: assetId }).eq("id", sceneId);
  if (error) return { ok: false, error: dbError(error) };
  revalidatePath(studioPath(scene.storyboard_id));
  return { ok: true, data: null };
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

const claimSchema = z.object({
  text: z.string().trim().min(1, "ต้องระบุข้อความ claim").max(300, "ยาวเกิน 300 ตัวอักษร"),
  factKey: z.string().max(60).nullable(),
});

/** A claim may only cite facts of the storyboard's own product. */
async function checkFactBelongs(db: Db, storyboardId: string, factKey: string | null): Promise<string | null> {
  const { fact_id } = parseFactKey(factKey);
  if (!fact_id) return null;
  const { data: sb } = await db.from("storyboards").select("project:content_projects(product_id)").eq("id", storyboardId).maybeSingle();
  const { data: fact } = await db.from("product_facts").select("product_id").eq("id", fact_id).maybeSingle();
  return fact && sb?.project && fact.product_id === sb.project.product_id ? null : "ข้อเท็จจริงนี้ไม่ใช่ของสินค้านี้";
}

export async function addClaim(sceneId: string, input: z.input<typeof claimSchema>): Promise<ActionResult<null>> {
  const parsed = claimSchema.safeParse(input);
  if (!uuid.safeParse(sceneId).success || !parsed.success) return { ok: false, error: parsed.error?.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const { supabase, user } = await requireUser();
  const scene = await sceneStoryboard(supabase, sceneId);
  if (!scene) return { ok: false, error: "ไม่พบฉาก" };
  const belongs = await checkFactBelongs(supabase, scene.storyboard_id, parsed.data.factKey);
  if (belongs) return { ok: false, error: belongs };
  const { error } = await supabase.from("scene_claims").insert({ scene_id: sceneId, owner_id: user.id, text: parsed.data.text, ...parseFactKey(parsed.data.factKey) });
  if (error) return { ok: false, error: dbError(error) };
  revalidatePath(studioPath(scene.storyboard_id));
  return { ok: true, data: null };
}

const claimUpdateSchema = z.object({
  text: z.string().trim().min(1, "ต้องระบุข้อความ claim").max(300).optional(),
  factKey: z.string().max(60).nullable().optional(),
  review_status: z.enum(["pending", "verified", "rejected"]).optional(),
});

export async function updateClaim(claimId: string, input: z.input<typeof claimUpdateSchema>): Promise<ActionResult<null>> {
  const parsed = claimUpdateSchema.safeParse(input);
  if (!uuid.safeParse(claimId).success || !parsed.success) return { ok: false, error: parsed.error?.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const { supabase } = await requireUser();
  const { data: claim } = await supabase.from("scene_claims").select("id, text, fact_id, product_field, scene:storyboard_scenes(storyboard_id)").eq("id", claimId).maybeSingle();
  if (!claim?.scene) return { ok: false, error: "ไม่พบ claim" };
  const storyboardId = claim.scene.storyboard_id;

  const patch: { text?: string; fact_id?: string | null; product_field?: string | null; review_status?: string } = {};
  if (parsed.data.text !== undefined && parsed.data.text !== claim.text) patch.text = parsed.data.text;
  if (parsed.data.factKey !== undefined && parsed.data.factKey !== claimFactKey(claim)) {
    const belongs = await checkFactBelongs(supabase, storyboardId, parsed.data.factKey);
    if (belongs) return { ok: false, error: belongs };
    Object.assign(patch, parseFactKey(parsed.data.factKey));
  }
  // Changing what a claim says or cites means it must be checked again.
  if (patch.text !== undefined || "fact_id" in patch) patch.review_status = "pending";
  if (parsed.data.review_status) {
    const factKey = "fact_id" in patch ? claimFactKey({ fact_id: patch.fact_id ?? null, product_field: patch.product_field ?? null }) : claimFactKey(claim);
    if (parsed.data.review_status === "verified" && !factKey) return { ok: false, error: "เลือกข้อเท็จจริงที่ claim นี้อ้างอิงก่อนยืนยัน" };
    patch.review_status = parsed.data.review_status;
  }
  if (!Object.keys(patch).length) return { ok: true, data: null };
  const { error } = await supabase.from("scene_claims").update(patch).eq("id", claimId);
  if (error) return { ok: false, error: dbError(error) };
  revalidatePath(studioPath(storyboardId));
  return { ok: true, data: null };
}

export async function deleteClaim(claimId: string): Promise<ActionResult<null>> {
  if (!uuid.safeParse(claimId).success) return { ok: false, error: "รหัสไม่ถูกต้อง" };
  const { supabase } = await requireUser();
  const { data: claim } = await supabase.from("scene_claims").select("scene:storyboard_scenes(storyboard_id)").eq("id", claimId).maybeSingle();
  if (!claim?.scene) return { ok: false, error: "ไม่พบ claim" };
  const { error } = await supabase.from("scene_claims").delete().eq("id", claimId);
  if (error) return { ok: false, error: dbError(error, "ลบ") };
  revalidatePath(studioPath(claim.scene.storyboard_id));
  return { ok: true, data: null };
}

// ---------------------------------------------------------------------------
// Approval and versions
// ---------------------------------------------------------------------------

export async function approveStoryboard(id: string): Promise<ActionResult<null> | { ok: false; error: string; issues: ValidationIssue[] }> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "รหัสไม่ถูกต้อง" };
  const { supabase } = await requireUser();
  const bundle = await loadStudio(supabase, id);
  if (!bundle) return { ok: false, error: "ไม่พบสคริปต์" };
  if (bundle.storyboard.status === "approved") return { ok: true, data: null };
  // Re-validated on the server: the client's view may be out of date.
  if (!canApprove(bundle.issues)) return { ok: false, error: "ยังอนุมัติไม่ได้ — แก้รายการที่ต้องแก้ก่อน", issues: bundle.issues };

  const cited = new Set(bundle.scenes.flatMap((s) => s.claims.map((c) => claimFactKey(c))).filter((k): k is string => !!k));
  const snapshot = { facts: bundle.facts.filter((f) => cited.has(f.key)).map((f) => ({ key: f.key, label: f.label, value: f.value, status: f.status })) };
  const { error } = await supabase
    .from("storyboards")
    .update({ status: "approved", approved_at: new Date().toISOString(), approved_snapshot: snapshot as unknown as Json })
    .eq("id", id)
    .eq("status", "draft");
  if (error) return { ok: false, error: dbError(error) };
  revalidatePath(studioPath(id));
  revalidatePath("/studio");
  revalidatePath("/content");
  return { ok: true, data: null };
}

/** Copies a storyboard into a new draft version. Claims stay verified only if their fact is unchanged. */
export async function createNewVersion(id: string): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "รหัสไม่ถูกต้อง" };
  const { supabase, user } = await requireUser();
  const bundle = await loadStudio(supabase, id);
  if (!bundle) return { ok: false, error: "ไม่พบสคริปต์" };
  const { storyboard: sb } = bundle;
  const latest = Math.max(...bundle.versions.map((v) => v.version));
  const snap = new Map(((sb.approved_snapshot as { facts?: { key: string; value: string | null }[] } | null)?.facts ?? []).map((f) => [f.key, f.value]));
  const now = new Map(bundle.facts.map((f) => [f.key, f.value]));

  const { data: created, error } = await supabase
    .from("storyboards")
    .insert({
      project_id: sb.project_id,
      owner_id: user.id,
      version: latest + 1,
      template_id: sb.template_id,
      template_version: sb.template_version,
      hook: sb.hook,
      caption: sb.caption,
      cta: sb.cta,
      disclosure: sb.disclosure,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: dbError(error) };

  const { data: scenes, error: sceneError } = await supabase
    .from("storyboard_scenes")
    .insert(
      bundle.scenes.map((s) => ({
        storyboard_id: created.id,
        owner_id: user.id,
        position: s.position,
        kind: s.kind,
        narration: s.narration,
        on_screen_text: s.on_screen_text,
        visual_note: s.visual_note,
        text_origin: s.text_origin,
        asset_id: s.asset_id,
      })),
    )
    .select("id, position");
  if (sceneError) return { ok: false, error: dbError(sceneError) };
  const idAt = new Map(scenes.map((s) => [s.position, s.id]));
  const claims = bundle.scenes.flatMap((s) =>
    s.claims.map((c) => {
      const key = claimFactKey(c);
      const unchanged = key !== null && snap.has(key) && snap.get(key) === now.get(key);
      return {
        scene_id: idAt.get(s.position)!,
        owner_id: user.id,
        text: c.text,
        fact_id: c.fact_id,
        product_field: c.product_field,
        review_status: c.review_status === "verified" && !unchanged ? "pending" : c.review_status,
      };
    }),
  );
  if (claims.length) {
    const { error: claimError } = await supabase.from("scene_claims").insert(claims);
    if (claimError) return { ok: false, error: dbError(claimError) };
  }
  revalidatePath("/studio");
  return { ok: true, data: { id: created.id } };
}
