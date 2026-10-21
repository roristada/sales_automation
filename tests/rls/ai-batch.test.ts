import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";

/*
 * AI-6 against LOCAL Supabase: batches are owner-only and their items can only point at the
 * owner's own product, project and script; an approved AI clip can be reused (free) only in an
 * approved script of the same product, in a scene planned as an AI clip; project_costs counts AI.
 */

function loadEnv(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(".env.local", "utf8")
        .split(/\r?\n/)
        .filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
    );
  } catch {
    return {};
  }
}
const env = { ...loadEnv(), ...process.env };
const URL = env.NEXT_PUBLIC_SUPABASE_URL!;
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(URL)) throw new Error("these tests create and delete users; they only run against local Supabase");
const admin = createClient<Database>(URL, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const run = Date.now();

async function makeUser(tag: string) {
  const email = `batch-${tag}-${run}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "test-password-123", email_confirm: true });
  if (error) throw error;
  const client = createClient<Database>(URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  await client.auth.signInWithPassword({ email, password: "test-password-123" });
  return { id: data.user.id, client };
}

let a: Awaited<ReturnType<typeof makeUser>>;
let b: Awaited<ReturnType<typeof makeUser>>;

async function script(owner: typeof a, productId: string, version = 1) {
  const { data: project } = await owner.client.from("content_projects").insert({ product_id: productId, title: `p${version}`, platform: "tiktok", target_duration_s: 30 }).select("id").single();
  const { data: sb } = await owner.client.from("storyboards").insert({ project_id: project!.id, version, template_id: "quick_review", template_version: 1, disclosure: "#ได้รับค่าคอมมิชชัน" }).select("id").single();
  const { data: scene } = await owner.client.from("storyboard_scenes").insert({ storyboard_id: sb!.id, position: 0, kind: "intro", narration: "x" }).select("id").single();
  await admin.from("storyboards").update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", sb!.id);
  return { projectId: project!.id, storyboardId: sb!.id, sceneId: scene!.id };
}

beforeAll(async () => {
  a = await makeUser("a");
  b = await makeUser("b");
});

afterAll(async () => {
  for (const u of [a, b]) if (u) await admin.auth.admin.deleteUser(u.id);
});

describe("batches", () => {
  it("owner-only; items start pending and point only at the owner's own records", async () => {
    const { data: p1 } = await a.client.from("products").insert({ name: "หูฟัง", source: "manual" }).select("id").single();
    const { data: pb } = await b.client.from("products").insert({ name: "ของ B", source: "manual" }).select("id").single();
    const { data: batch, error } = await a.client.from("content_batches").insert({ template_id: "quick_review", platform: "tiktok", target_duration_s: 30, use_ai: true, budget_thb: 5 }).select("id").single();
    expect(error).toBeNull();
    expect((await a.client.from("content_batch_items").insert({ batch_id: batch!.id, product_id: p1!.id, position: 0 })).error).toBeNull();
    // Another user's product, or a non-pending start, is refused; B can't add to A's batch.
    expect((await a.client.from("content_batch_items").insert({ batch_id: batch!.id, product_id: pb!.id, position: 1 })).error?.code).toBe("42501");
    expect((await a.client.from("content_batch_items").insert({ batch_id: batch!.id, product_id: p1!.id, position: 2, status: "written" } as never)).error?.code).toBe("42501");
    expect((await b.client.from("content_batch_items").insert({ batch_id: batch!.id, product_id: pb!.id, position: 3 })).error?.code).toBe("42501");
    expect((await b.client.from("content_batches").select("id")).data).toEqual([]);
    expect((await b.client.from("content_batch_items").select("id")).data).toEqual([]);

    // Items may link only to a project of the same product, and that project's script.
    const mine = await script(a, p1!.id);
    const { data: other } = await a.client.from("products").insert({ name: "อีกชิ้น", source: "manual" }).select("id").single();
    const wrong = await script(a, other!.id);
    const { data: item } = await a.client.from("content_batch_items").select("id").eq("batch_id", batch!.id).single();
    expect((await a.client.from("content_batch_items").update({ project_id: wrong.projectId }).eq("id", item!.id)).error?.code).toBe("42501");
    expect((await a.client.from("content_batch_items").update({ project_id: mine.projectId, storyboard_id: wrong.storyboardId }).eq("id", item!.id)).error?.code).toBe("42501");
    expect((await a.client.from("content_batch_items").update({ status: "written", project_id: mine.projectId, storyboard_id: mine.storyboardId, cost_thb: 0.02 }).eq("id", item!.id)).error).toBeNull();
    // Product and batch are fixed once created.
    expect((await a.client.from("content_batch_items").update({ product_id: other!.id } as never).eq("id", item!.id)).error?.code).toBe("42501");
    // B can't touch A's item.
    expect((await b.client.from("content_batch_items").update({ status: "failed" }).eq("id", item!.id).select()).data).toEqual([]);
  });
});

describe("reusing an approved clip", () => {
  it("only in an approved script of the same product, in an AI-clip scene, for free", async () => {
    const { data: product } = await a.client.from("products").insert({ name: "ลำโพง", source: "manual" }).select("id").single();
    const v1 = await script(a, product!.id, 1);
    const v2 = await script(a, product!.id, 2);
    const { data: otherProduct } = await a.client.from("products").insert({ name: "อื่น", source: "manual" }).select("id").single();
    const other = await script(a, otherProduct!.id);

    // An approved clip in v1.
    const assetId = randomUUID();
    await admin.from("assets").insert({ id: assetId, owner_id: a.id, kind: "video", storage_key: `${a.id}/${assetId}/original.mp4`, name: "clip", mime: "video/mp4", size_bytes: 1, sha256: createHash("sha256").update(assetId).digest("hex"), source: "ai_generated", ai_generated: true });
    const { data: src } = await admin
      .from("scene_generations")
      .insert({ owner_id: a.id, scene_id: v1.sceneId, storyboard_id: v1.storyboardId, video_task: "video_product", model: "kwaivgi/kling-v3.0-std", prompt: "rotate", duration_s: 5, est_cost_thb: 14.7, cost_thb: 14.7, status: "succeeded", review_status: "approved", asset_id: assetId })
      .select("id")
      .single();

    // The target scene must be planned as an AI clip.
    expect((await a.client.rpc("reuse_scene_clip", { target_scene: v2.sceneId, source: src!.id })).error?.code).toBe("42501");
    await a.client.from("scene_visual_plans").insert({ scene_id: v2.sceneId, storyboard_id: v2.storyboardId, mode: "ai_video", prompt: "rotate" });
    await a.client.from("scene_visual_plans").insert({ scene_id: other.sceneId, storyboard_id: other.storyboardId, mode: "ai_video", prompt: "rotate" });
    // Not another product's scene, not by another user.
    expect((await a.client.rpc("reuse_scene_clip", { target_scene: other.sceneId, source: src!.id })).error?.code).toBe("42501");
    expect((await b.client.rpc("reuse_scene_clip", { target_scene: v2.sceneId, source: src!.id })).error?.code).toBe("P0002");

    const { data: created, error } = await a.client.rpc("reuse_scene_clip", { target_scene: v2.sceneId, source: src!.id });
    expect(error).toBeNull();
    const { data: row } = await a.client.from("scene_generations").select("scene_id, status, review_status, asset_id, cost_thb, est_cost_thb").eq("id", created!).single();
    expect(row).toEqual({ scene_id: v2.sceneId, status: "succeeded", review_status: "approved", asset_id: assetId, cost_thb: 0, est_cost_thb: 0 });
    // Reusing again replaces the scene's approved clip (one approved per scene).
    expect((await a.client.rpc("reuse_scene_clip", { target_scene: v2.sceneId, source: src!.id })).error).toBeNull();
    expect((await a.client.from("scene_generations").select("id").eq("scene_id", v2.sceneId).eq("review_status", "approved")).data).toHaveLength(1);
  });
});

describe("project costs", () => {
  it("include every AI call on the project's scripts", async () => {
    const { data: product } = await a.client.from("products").insert({ name: "เมาส์", source: "manual" }).select("id").single();
    const s = await script(a, product!.id);
    await a.client.from("ai_requests").insert([
      { task: "script", model: "m/x", status: "succeeded", cost_usd: 0.001, cost_thb: 0.035, storyboard_id: s.storyboardId },
      { task: "tts", model: "m/y", status: "succeeded", cost_usd: 0.01, cost_thb: 0.35, storyboard_id: s.storyboardId },
    ]);
    const { data } = await a.client.rpc("project_costs");
    expect(data?.find((r) => r.project_id === s.projectId)).toMatchObject({ cost_thb: 0.385, renders: 0, ai_thb: 0.385 });
    expect(((await b.client.rpc("project_costs")).data ?? []).some((r) => r.project_id === s.projectId)).toBe(false);
  });
});
