import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";

/*
 * Real RLS test against LOCAL Supabase (`npm run db:start`). Creates two users with the
 * service-role key, then checks that user B can neither read nor change user A's data.
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
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY!;

if (!URL || !ANON || !SERVICE) throw new Error("RLS tests need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY");
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(URL)) throw new Error("RLS tests create and delete users; they only run against local Supabase");

const admin = createClient<Database>(URL, SERVICE, { auth: { persistSession: false } });
const password = "test-password-123";
const run = Date.now();
const users: { id: string; client: SupabaseClient<Database> }[] = [];

async function makeUser(tag: string) {
  const email = `rls-${tag}-${run}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient<Database>(URL, ANON, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  const u = { id: data.user.id, client };
  users.push(u);
  return u;
}

let a: Awaited<ReturnType<typeof makeUser>>;
let b: Awaited<ReturnType<typeof makeUser>>;
let productId: string;
let batchId: string;

beforeAll(async () => {
  a = await makeUser("a");
  b = await makeUser("b");
  const { data, error } = await a.client
    .from("products")
    .insert({ name: "สินค้าของ A", source: "manual", price: 100, url_key: `example.test/a-${run}` })
    .select("id")
    .single();
  if (error) throw error;
  productId = data.id;
  const batch = await a.client.from("import_batches").insert({ file_name: "a.csv", duplicate_mode: "skip" }).select("id").single();
  if (batch.error) throw batch.error;
  batchId = batch.data.id;
});

afterAll(async () => {
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
});

describe("row level security", () => {
  it("creates a profile for each new user, visible only to its owner", async () => {
    const own = await a.client.from("profiles").select("id");
    expect(own.data?.map((p) => p.id)).toEqual([a.id]);
  });

  it("owner_id defaults to the signed-in user and price history is recorded", async () => {
    const { data } = await a.client.from("products").select("owner_id").eq("id", productId).single();
    expect(data?.owner_id).toBe(a.id);
    const history = await a.client.from("product_price_history").select("price").eq("product_id", productId);
    expect(history.data).toEqual([{ price: 100 }]);
  });

  it("user B cannot read user A's rows", async () => {
    for (const table of ["products", "product_price_history", "import_batches", "profiles"] as const) {
      const { data, error } = await b.client.from(table).select("*");
      expect(error).toBeNull();
      expect(data?.filter((r) => ("owner_id" in r ? r.owner_id : (r as { id: string }).id) === a.id)).toEqual([]);
    }
  });

  it("user B cannot update or delete user A's product", async () => {
    const upd = await b.client.from("products").update({ name: "hacked" }).eq("id", productId).select();
    expect(upd.data).toEqual([]);
    const del = await b.client.from("products").delete({ count: "exact" }).eq("id", productId);
    expect(del.count).toBe(0);
    const still = await a.client.from("products").select("name").eq("id", productId).single();
    expect(still.data?.name).toBe("สินค้าของ A");
  });

  it("user B cannot insert rows owned by user A", async () => {
    const { error } = await b.client.from("products").insert({ name: "x", source: "manual", owner_id: a.id });
    expect(error?.code).toBe("42501");
  });

  it("user B cannot attach rows to user A's import batch or product", async () => {
    const err = await b.client.from("import_row_errors").insert({ batch_id: batchId, row_number: 2, raw: {}, errors: [] });
    expect(err.error?.code).toBe("42501");
    const hist = await b.client.from("product_price_history").insert({ product_id: productId, source: "manual", price: 1 });
    expect(hist.error?.code).toBe("42501");
  });

  it("user B cannot move a product to user A by changing owner_id", async () => {
    const own = await b.client.from("products").insert({ name: "B", source: "manual" }).select("id").single();
    const move = await b.client.from("products").update({ owner_id: a.id }).eq("id", own.data!.id);
    expect(move.error?.code).toBe("42501");
  });

  it("opportunity scores and the research view are owner-only", async () => {
    const result = { version: 1 };
    const own = await a.client.from("opportunity_scores").insert({ product_id: productId, score: 50, confidence: "medium", score_version: 1, result }).select("owner_id").single();
    expect(own.error).toBeNull();
    expect(own.data?.owner_id).toBe(a.id);

    const viewA = await a.client.from("research_products").select("id, opportunity_score").eq("id", productId);
    expect(viewA.data).toEqual([{ id: productId, opportunity_score: 50 }]);

    const readB = await b.client.from("opportunity_scores").select("product_id");
    expect(readB.data).toEqual([]);
    const viewB = await b.client.from("research_products").select("id").eq("id", productId);
    expect(viewB.data).toEqual([]);

    // B cannot score A's product, even with B as owner.
    const ins = await b.client.from("opportunity_scores").insert({ product_id: productId, score: 1, confidence: "low", score_version: 1, result });
    expect(ins.error?.code).toBe("42501");
    const upd = await b.client.from("opportunity_scores").update({ score: 1 }).eq("product_id", productId).select();
    expect(upd.data).toEqual([]);
  });

  it("freshness summary only counts the caller's products", async () => {
    const own = await a.client.from("product_freshness").select("source, total");
    expect(own.data).toEqual([{ source: "manual", total: 1 }]);
    const other = await b.client.from("product_freshness").select("source, total");
    expect(other.data?.reduce((s, r) => s + (r.total ?? 0), 0)).toBe(1); // B's own product from the owner_id test
  });

  it("trend imports, observations and product links are owner-only", async () => {
    const imp = await a.client
      .from("trend_imports")
      .insert({ source: "google_trends_csv", granularity: "week", period_start: "2026-09-06", period_end: "2026-09-06", keywords: ["หูฟัง"], point_count: 1, retrieved_at: new Date().toISOString() })
      .select("id")
      .single();
    expect(imp.error).toBeNull();
    const obs = await a.client.from("trend_observations").insert({ import_id: imp.data!.id, keyword: "หูฟัง", period_start: "2026-09-06", value: 50 });
    expect(obs.error).toBeNull();
    const link = await a.client.from("product_trend_links").insert({ product_id: productId, keyword: "หูฟัง" });
    expect(link.error).toBeNull();

    for (const table of ["trend_imports", "trend_observations", "product_trend_links"] as const) {
      const { data } = await b.client.from(table as "trend_imports").select("owner_id");
      expect(data).toEqual([]);
    }
    const intoA = await b.client.from("trend_observations").insert({ import_id: imp.data!.id, keyword: "x", period_start: "2026-09-13", value: 1 });
    expect(intoA.error?.code).toBe("42501");
    const linkA = await b.client.from("product_trend_links").insert({ product_id: productId, keyword: "x" });
    expect(linkA.error?.code).toBe("42501");
    const del = await b.client.from("trend_imports").delete({ count: "exact" }).eq("id", imp.data!.id);
    expect(del.count).toBe(0);
  });

  it("content: owner-only, claims cite own facts, approved storyboards are locked, product delete cascades", async () => {
    const { data: prod } = await a.client.from("products").insert({ name: "สินค้าคอนเทนต์", source: "manual" }).select("id").single();
    const { data: fact, error: factError } = await a.client.from("product_facts").insert({ product_id: prod!.id, label: "แบต", value: "20 ชม." }).select("id").single();
    expect(factError).toBeNull();
    const { data: project } = await a.client.from("content_projects").insert({ product_id: prod!.id, title: "t", platform: "tiktok", target_duration_s: 30 }).select("id").single();
    const { data: sb } = await a.client
      .from("storyboards")
      .insert({ project_id: project!.id, version: 1, template_id: "quick_review", template_version: 1, disclosure: "#ได้รับค่าคอมมิชชัน" })
      .select("id")
      .single();
    const { data: scene } = await a.client.from("storyboard_scenes").insert({ storyboard_id: sb!.id, position: 0, kind: "feature", narration: "แบต 20 ชม." }).select("id").single();
    const { data: claim, error: claimError } = await a.client.from("scene_claims").insert({ scene_id: scene!.id, text: "แบต 20 ชม.", fact_id: fact!.id }).select("id").single();
    expect(claimError).toBeNull();

    // B sees nothing and cannot attach to A's rows.
    for (const table of ["product_facts", "content_projects", "storyboards", "storyboard_scenes", "scene_claims"] as const) {
      const { data } = await b.client.from(table as "product_facts").select("id");
      expect(data).toEqual([]);
    }
    expect((await b.client.from("product_facts").insert({ product_id: prod!.id, label: "x", value: "y" })).error?.code).toBe("42501");
    expect((await b.client.from("storyboard_scenes").insert({ storyboard_id: sb!.id, position: 1, kind: "x" })).error?.code).toBe("42501");
    const { data: bProd } = await b.client.from("products").insert({ name: "B2", source: "manual" }).select("id").single();
    const { data: bProject } = await b.client.from("content_projects").insert({ product_id: bProd!.id, title: "b", platform: "tiktok", target_duration_s: 30 }).select("id").single();
    const { data: bSb } = await b.client.from("storyboards").insert({ project_id: bProject!.id, version: 1, template_id: "x", template_version: 1, disclosure: "d" }).select("id").single();
    const { data: bScene } = await b.client.from("storyboard_scenes").insert({ storyboard_id: bSb!.id, position: 0, kind: "x" }).select("id").single();
    // B's claim cannot cite A's fact.
    expect((await b.client.from("scene_claims").insert({ scene_id: bScene!.id, text: "x", fact_id: fact!.id })).error?.code).toBe("42501");

    // A fact in use cannot be deleted on its own.
    expect((await a.client.from("product_facts").delete().eq("id", fact!.id)).error?.code).toBe("23503");

    // Approve → everything locked.
    const approve = await a.client.from("storyboards").update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", sb!.id);
    expect(approve.error).toBeNull();
    expect((await a.client.from("storyboards").update({ hook: "changed" }).eq("id", sb!.id)).error?.code).toBe("P0001");
    expect((await a.client.from("storyboard_scenes").update({ narration: "changed" }).eq("id", scene!.id)).error?.code).toBe("P0001");
    expect((await a.client.from("storyboard_scenes").insert({ storyboard_id: sb!.id, position: 1, kind: "x" })).error?.code).toBe("P0001");
    expect((await a.client.from("scene_claims").update({ review_status: "verified" }).eq("id", claim!.id)).error?.code).toBe("P0001");
    expect((await a.client.from("scene_claims").delete().eq("id", claim!.id)).error?.code).toBe("P0001");

    // Deleting the product still removes the whole tree.
    const del = await a.client.from("products").delete({ count: "exact" }).eq("id", prod!.id);
    expect(del.error).toBeNull();
    expect(del.count).toBe(1);
    expect((await a.client.from("storyboards").select("id").eq("id", sb!.id)).data).toEqual([]);
    expect((await a.client.from("product_facts").select("id").eq("id", fact!.id)).data).toEqual([]);
  });

  it("render jobs: only approved storyboards, one active job, owner-only, worker functions locked down", async () => {
    const { data: prod } = await a.client.from("products").insert({ name: "สินค้าวิดีโอ", source: "manual" }).select("id").single();
    const { data: project } = await a.client.from("content_projects").insert({ product_id: prod!.id, title: "v", platform: "tiktok", target_duration_s: 30 }).select("id").single();
    const { data: sb } = await a.client
      .from("storyboards")
      .insert({ project_id: project!.id, version: 1, template_id: "quick_review", template_version: 1, disclosure: "#ได้รับค่าคอมมิชชัน" })
      .select("id")
      .single();

    // Draft → cannot queue.
    expect((await a.client.from("render_jobs").insert({ storyboard_id: sb!.id })).error?.code).toBe("42501");
    await a.client.from("storyboards").update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", sb!.id);
    const { data: job, error } = await a.client.from("render_jobs").insert({ storyboard_id: sb!.id }).select("id, owner_id").single();
    expect(error).toBeNull();
    expect(job!.owner_id).toBe(a.id);
    // Second active job for the same storyboard is rejected (idempotency).
    expect((await a.client.from("render_jobs").insert({ storyboard_id: sb!.id })).error?.code).toBe("23505");
    // Users can't fake progress or outputs.
    expect((await a.client.from("render_jobs").update({ status: "completed" }).eq("id", job!.id).select()).data ?? []).toEqual([]);
    expect((await a.client.from("render_outputs").insert({ job_id: job!.id, owner_id: a.id, video_key: "x" })).error).not.toBeNull();

    // B: can't see, queue on, or cancel A's work.
    expect((await b.client.from("render_jobs").select("id")).data).toEqual([]);
    expect((await b.client.from("render_jobs").insert({ storyboard_id: sb!.id })).error?.code).toBe("42501");
    expect((await b.client.rpc("cancel_render_job", { job: job!.id })).data).toBe(false);
    // Only the worker (service role) may claim jobs.
    expect((await a.client.rpc("claim_render_job", { worker: "x" })).error).not.toBeNull();
    expect((await a.client.rpc("fail_exhausted_render_jobs")).error).not.toBeNull();

    expect((await a.client.rpc("cancel_render_job", { job: job!.id })).data).toBe(true);
    const { data: after } = await a.client.from("render_jobs").select("status").eq("id", job!.id).single();
    expect(after!.status).toBe("canceled");
    await a.client.from("products").delete().eq("id", prod!.id);
  });

  it("assets, usage and spending limits are owner-only; file facts and usage can't be forged", async () => {
    const sha = "a".repeat(64);
    const assetId = crypto.randomUUID();
    const { data: asset, error } = await a.client
      .from("assets")
      .insert({ id: assetId, kind: "image", storage_key: `${a.id}/${assetId}/original.jpg`, name: "a.jpg", mime: "image/jpeg", size_bytes: 10, sha256: sha, source: "own" })
      .select("id, license")
      .single();
    // A row can't point at someone else's file (or any path outside its own folder).
    const forgedId = crypto.randomUUID();
    for (const key of [`${b.id}/${forgedId}/original.jpg`, `${a.id}/${assetId}/original.jpg`, `${a.id}/${forgedId}/video.mp4`, `${a.id}/${forgedId}/../x/original.jpg`]) {
      const forged = await a.client.from("assets").insert({ id: forgedId, kind: "image", storage_key: key, name: "f", mime: "image/jpeg", size_bytes: 1, sha256: "c".repeat(64), source: "own" });
      expect(forged.error?.code).toBe("23514");
    }
    expect(error).toBeNull();
    expect(asset!.license).toBe("unknown"); // never assumed safe
    // Descriptive fields editable; file facts are not.
    expect((await a.client.from("assets").update({ license: "own_work" }).eq("id", asset!.id)).error).toBeNull();
    expect((await a.client.from("assets").update({ storage_key: "../../etc/passwd" }).eq("id", asset!.id)).error?.code).toBe("42501");
    // Same file twice for the same user is rejected.
    const dupId = crypto.randomUUID();
    expect((await a.client.from("assets").insert({ id: dupId, kind: "image", storage_key: `${a.id}/${dupId}/original.jpg`, name: "b", mime: "image/jpeg", size_bytes: 1, sha256: sha, source: "own" })).error?.code).toBe("23505");

    expect((await b.client.from("assets").select("id")).data).toEqual([]);
    expect((await b.client.from("assets").update({ name: "x" }).eq("id", asset!.id).select()).data).toEqual([]);
    // B can't put A's asset in B's scene.
    const { data: bScene } = await b.client.from("storyboard_scenes").select("id").limit(1).maybeSingle();
    if (bScene) expect((await b.client.from("storyboard_scenes").update({ asset_id: asset!.id }).eq("id", bScene.id)).error?.code).toBe("42501");

    // Usage is written by the worker only.
    expect((await a.client.from("usage_events").insert({ owner_id: a.id, provider: "render", units: 1, unit: "x" })).error).not.toBeNull();
    // Limits: own row only; spend summary never reveals another user's spend.
    expect((await a.client.from("spending_limits").upsert({ owner_id: a.id, daily_thb: 10 })).error).toBeNull();
    expect((await b.client.from("spending_limits").select("owner_id")).data).toEqual([]);
    expect((await b.client.from("spending_limits").insert({ owner_id: a.id, daily_thb: 0 })).error?.code).toBe("42501");
    await admin.from("usage_events").insert({ owner_id: a.id, provider: "render", units: 10, unit: "video_seconds", est_cost_thb: 5 });
    expect(Number((await a.client.rpc("spend_summary")).data?.[0]?.today_thb)).toBe(5);
    expect(Number((await b.client.rpc("spend_summary", { owner: a.id })).data?.[0]?.today_thb)).toBe(0);

    await a.client.from("assets").delete().eq("id", asset!.id);
  });

  it("publications: own approved, QA-passed videos only; disclosure kept; no double posting; posted rows locked", async () => {
    const disclosure = "#ได้รับค่าคอมมิชชัน";
    const { data: prod } = await a.client.from("products").insert({ name: "สินค้าเผยแพร่", source: "manual" }).select("id").single();
    const { data: project } = await a.client.from("content_projects").insert({ product_id: prod!.id, title: "p", platform: "tiktok", target_duration_s: 30 }).select("id").single();
    const { data: sb } = await a.client
      .from("storyboards")
      .insert({ project_id: project!.id, version: 1, template_id: "quick_review", template_version: 1, disclosure, status: "approved", approved_at: new Date().toISOString() })
      .select("id")
      .single();
    // Outputs are written by the worker (service role).
    const output = async (ok: boolean) => {
      const { data: job } = await admin.from("render_jobs").insert({ owner_id: a.id, storyboard_id: sb!.id, status: "completed" }).select("id").single();
      const { data: out } = await admin.from("render_outputs").insert({ job_id: job!.id, owner_id: a.id, video_key: "x.mp4", report: { ok, checks: [] } }).select("id").single();
      return out!.id;
    };
    const good = await output(true);
    const bad = await output(false);
    const row = (outputId: string, extra: Record<string, unknown> = {}) => ({ render_output_id: outputId, platform: "tiktok", caption: `cap

${disclosure}`, storyboard_id: sb!.id, project_id: project!.id, disclosure, ...extra });

    // B can't publish A's video, even with A's ids.
    expect((await b.client.from("publications").insert(row(good))).error?.code).toBe("42501");
    // QA-failed video and a caption without the disclosure are refused.
    expect((await a.client.from("publications").insert(row(bad))).error?.code).toBe("P0001");
    expect((await a.client.from("publications").insert(row(good, { caption: "no disclosure" }))).error?.code).toBe("23514");
    // A forged disclosure is replaced by the storyboard's own.
    expect((await a.client.from("publications").insert(row(good, { caption: "x", disclosure: "x" }))).error?.code).toBe("23514");
    // Can't start as published.
    expect((await a.client.from("publications").insert(row(good, { status: "published", published_at: new Date().toISOString(), external_url: "https://tiktok.com/v/1" }))).error?.code).toBe("P0001");

    const { data: pub, error } = await a.client.from("publications").insert(row(good)).select("id, owner_id, disclosure").single();
    expect(error).toBeNull();
    expect(pub!.owner_id).toBe(a.id);
    // One live publication per content and platform.
    expect((await a.client.from("publications").insert(row(good))).error?.code).toBe("23505");
    expect((await a.client.from("publications").insert(row(good, { platform: "shorts" }))).error).toBeNull();

    // Published needs a post URL; afterwards the caption/video are locked; can't go back to draft.
    expect((await a.client.from("publications").update({ status: "published", published_at: new Date().toISOString() }).eq("id", pub!.id)).error?.code).toBe("23514");
    expect((await a.client.from("publications").update({ status: "published", published_at: new Date().toISOString(), external_url: `https://www.tiktok.com/@a/video/${run}` }).eq("id", pub!.id)).error).toBeNull();
    expect((await a.client.from("publications").update({ caption: `changed ${disclosure}` }).eq("id", pub!.id)).error?.code).toBe("P0001");
    expect((await a.client.from("publications").update({ status: "draft" }).eq("id", pub!.id)).error?.code).toBe("P0001");
    expect((await a.client.from("publications").update({ notes: "ok" }).eq("id", pub!.id)).error).toBeNull();
    // Derived columns can't be written directly.
    expect((await a.client.from("publications").update({ disclosure: "x" }).eq("id", pub!.id)).error?.code).toBe("42501");
    // Posted rows are history: not deletable, only withdrawn. Then the content can be posted again.
    expect((await a.client.from("publications").delete().eq("id", pub!.id).select()).data).toEqual([]);
    const { data: w } = await a.client.from("publications").update({ status: "withdrawn" }).eq("id", pub!.id).select("withdrawn_at").single();
    expect(w!.withdrawn_at).not.toBeNull();
    expect((await a.client.from("publications").insert(row(good))).error).toBeNull();

    // B sees and changes nothing of A's.
    expect((await b.client.from("publications").select("id")).data).toEqual([]);
    expect((await b.client.from("publications").update({ notes: "x" }).eq("id", pub!.id).select()).data).toEqual([]);
    expect((await b.client.from("publications").delete().eq("project_id", project!.id).select()).data).toEqual([]);

    // Deleting the product cascades through to its publications.
    await a.client.from("products").delete().eq("id", prod!.id);
    expect((await a.client.from("publications").select("id").eq("project_id", project!.id)).data).toEqual([]);
  });

  it("analytics: imports, post metrics and conversions are owner-only and can't attach to others' publications", async () => {
    const disclosure = "#ได้รับค่าคอมมิชชัน";
    const { data: prod } = await a.client.from("products").insert({ name: "สินค้า analytics", source: "manual" }).select("id").single();
    const { data: project } = await a.client.from("content_projects").insert({ product_id: prod!.id, title: "an", platform: "tiktok", target_duration_s: 30 }).select("id").single();
    const { data: sb } = await a.client
      .from("storyboards")
      .insert({ project_id: project!.id, version: 1, template_id: "quick_review", template_version: 1, disclosure, status: "approved", approved_at: new Date().toISOString() })
      .select("id")
      .single();
    const { data: job } = await admin.from("render_jobs").insert({ owner_id: a.id, storyboard_id: sb!.id, status: "completed" }).select("id").single();
    const { data: out } = await admin.from("render_outputs").insert({ job_id: job!.id, owner_id: a.id, video_key: "x.mp4", report: { ok: true, checks: [] } }).select("id").single();
    await admin.from("usage_events").insert({ owner_id: a.id, provider: "render", units: 10, unit: "video_seconds", est_cost_thb: 0.5, render_job_id: job!.id });
    const { data: pub } = await a.client
      .from("publications")
      .insert({ render_output_id: out!.id, platform: "tiktok", caption: `c ${disclosure}`, storyboard_id: sb!.id, project_id: project!.id, disclosure })
      .select("id, tracking_code")
      .single();
    expect(pub!.tracking_code).toMatch(/^sa[0-9a-f]{10}$/);

    const { data: imp } = await a.client.from("performance_imports").insert({ kind: "post_metrics", file_name: "m.csv" }).select("id").single();
    const { data: cimp } = await a.client.from("performance_imports").insert({ kind: "affiliate_conversions", file_name: "c.csv" }).select("id").single();
    expect((await a.client.from("post_metrics").insert({ import_id: imp!.id, publication_id: pub!.id, post_key: "tiktok:1", captured_on: "2026-10-20", views: 10 })).error).toBeNull();
    // A metrics row can't hang off a conversions import.
    expect((await a.client.from("post_metrics").insert({ import_id: cimp!.id, post_key: "tiktok:2", captured_on: "2026-10-20" })).error?.code).toBe("42501");
    expect((await a.client.from("affiliate_conversions").insert({ import_id: cimp!.id, publication_id: pub!.id, order_id: "o1", status: "completed", commission_thb: 5 })).error).toBeNull();
    // Same order again = conflict (re-imports upsert instead).
    expect((await a.client.from("affiliate_conversions").insert({ import_id: cimp!.id, order_id: "o1", status: "pending" })).error?.code).toBe("23505");
    const costs = (await a.client.rpc("project_costs")).data ?? [];
    expect(costs.find((c) => c.project_id === project!.id)).toMatchObject({ cost_thb: 0.5, renders: 1 });

    // B: sees nothing, can't use A's import or publication, can't claim A's orders.
    for (const t of ["performance_imports", "post_metrics", "affiliate_conversions"] as const) expect((await b.client.from(t).select("id")).data).toEqual([]);
    expect((await b.client.rpc("project_costs")).data).toEqual([]);
    expect((await b.client.from("post_metrics").insert({ import_id: imp!.id, post_key: "x", captured_on: "2026-10-20" })).error?.code).toBe("42501");
    const { data: bImp } = await b.client.from("performance_imports").insert({ kind: "affiliate_conversions", file_name: "b.csv" }).select("id").single();
    expect((await b.client.from("affiliate_conversions").insert({ import_id: bImp!.id, publication_id: pub!.id, order_id: "o2", status: "completed" })).error?.code).toBe("42501");
    expect((await b.client.from("affiliate_conversions").update({ commission_thb: 0 }).eq("order_id", "o1").select()).data).toEqual([]);
    expect((await b.client.from("performance_imports").delete().eq("id", imp!.id).select()).data).toEqual([]);

    // Deleting an import removes its rows; deleting the product keeps orders but unlinks them.
    await a.client.from("performance_imports").delete().eq("id", imp!.id);
    expect((await a.client.from("post_metrics").select("id").eq("post_key", "tiktok:1")).data).toEqual([]);
    await a.client.from("products").delete().eq("id", prod!.id);
    const { data: order } = await a.client.from("affiliate_conversions").select("publication_id").eq("order_id", "o1").single();
    expect(order!.publication_id).toBeNull();
    await a.client.from("performance_imports").delete().eq("id", cimp!.id);
  });

  it("worker heartbeats: written by the worker only; users and anon see just online/offline", async () => {
    const id = `rls-test-${Date.now()}`;
    expect((await admin.from("worker_heartbeats").insert({ worker_id: id, busy: true })).error).toBeNull();
    const anon = createClient<Database>(URL, ANON, { auth: { persistSession: false } });
    for (const c of [a.client, anon]) {
      expect((await c.from("worker_heartbeats").select("*")).data ?? []).toEqual([]);
      expect((await c.from("worker_heartbeats").insert({ worker_id: `${id}-x` })).error?.code).toBe("42501");
      const { data } = await c.rpc("worker_status");
      expect(data![0].online).toBeGreaterThanOrEqual(1);
      expect(Object.keys(data![0]).sort()).toEqual(["busy", "last_seen", "online"]);
    }
    await admin.from("worker_heartbeats").delete().eq("worker_id", id);
  });

  it("AI settings and request log: owner-only; log entries can't be edited, deleted or point at others' rows; spend counts them", async () => {
    expect((await a.client.from("ai_settings").insert({ models: { script: "a/b" }, per_video_cap_thb: 100 })).error).toBeNull();
    expect((await b.client.from("ai_settings").select("owner_id")).data).toEqual([]);
    expect((await b.client.from("ai_settings").insert({ owner_id: a.id })).error?.code).toBe("42501");
    expect((await b.client.from("ai_settings").update({ per_video_cap_thb: 1 }).eq("owner_id", a.id).select()).data).toEqual([]);
    expect((await a.client.from("ai_settings").update({ models: [] as never }).eq("owner_id", a.id)).error?.code).toBe("23514");

    const before = Number((await a.client.rpc("spend_summary")).data![0].today_thb);
    const { data: log, error } = await a.client.from("ai_requests").insert({ task: "test", model: "a/b", status: "succeeded", cost_usd: 0.01, cost_thb: 0.35, product_id: productId }).select("id").single();
    expect(error).toBeNull();
    expect(Number((await a.client.rpc("spend_summary")).data![0].today_thb)).toBeCloseTo(before + 0.35);
    expect((await b.client.from("ai_requests").select("id")).data).toEqual([]);
    expect(Number((await b.client.rpc("spend_summary")).data![0].today_thb)).toBe(0);
    // Owners can't rewrite or erase their spending record.
    expect((await a.client.from("ai_requests").update({ cost_thb: 0 }).eq("id", log!.id)).error?.code).toBe("42501");
    await a.client.from("ai_requests").delete().eq("id", log!.id);
    expect((await a.client.from("ai_requests").select("cost_thb").eq("id", log!.id).single()).data!.cost_thb).toBe(0.35);
    // Not as someone else, not against someone else's product, no negative cost, known tasks only.
    expect((await b.client.from("ai_requests").insert({ owner_id: a.id, task: "test", model: "a/b", status: "failed" })).error?.code).toBe("42501");
    expect((await b.client.from("ai_requests").insert({ task: "test", model: "a/b", status: "failed", product_id: productId })).error?.code).toBe("42501");
    expect((await a.client.from("ai_requests").insert({ task: "test", model: "a/b", status: "failed", cost_thb: -1 })).error?.code).toBe("23514");
    expect((await a.client.from("ai_requests").insert({ task: "other", model: "a/b", status: "failed" })).error?.code).toBe("23514");
  });

  it("links rendered as href must be http(s), even when written straight through the API", async () => {
    for (const url of ["javascript:alert(1)", "data:text/html,x", " javascript:alert(1)"]) {
      expect((await a.client.from("products").update({ product_url: url }).eq("id", productId)).error?.code).toBe("23514");
      expect((await a.client.from("products").update({ affiliate_url: url }).eq("id", productId)).error?.code).toBe("23514");
      expect((await a.client.from("product_facts").insert({ product_id: productId, label: "x", value: "y", source_url: url })).error?.code).toBe("23514");
    }
    expect((await a.client.from("products").update({ product_url: "HTTPS://example.test/p" }).eq("id", productId)).error).toBeNull();
  });

  it("anonymous clients see nothing", async () => {
    const anon = createClient<Database>(URL, ANON, { auth: { persistSession: false } });
    for (const table of ["products", "opportunity_scores", "research_products", "product_freshness", "trend_imports", "trend_observations", "product_trend_links", "product_facts", "content_projects", "storyboards", "storyboard_scenes", "scene_claims", "render_jobs", "render_outputs", "assets", "usage_events", "spending_limits", "publications", "performance_imports", "post_metrics", "affiliate_conversions", "ai_settings", "ai_requests"] as const) {
      const { data, error } = await anon.from(table as "products").select("*");
      expect(data ?? []).toEqual([]);
      if (error) expect(error.code).toBe("42501");
    }
  });
});
