import "server-only";

import type { Provenance } from "@/features/products/schema";
import type { Json, Tables, TablesInsert } from "@/lib/supabase/database.types";
import type { getCurrentUser } from "@/lib/supabase/server";
import { computeOpportunityScore, SCORE_VERSION } from "./opportunity-score";

type Db = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>["supabase"]>;
type ScoreSource = Pick<
  Tables<"products">,
  "id" | "owner_id" | "price" | "commission_rate" | "commission_amount" | "affiliate_url" | "image_url" | "description" | "provenance"
>;

const SCORE_COLUMNS = "id, owner_id, price, commission_rate, commission_amount, affiliate_url, image_url, description, provenance";
/** Keeps `.in()` URLs well under PostgREST/proxy limits. */
const ID_BATCH = 200;
const OUTDATED_BATCH = 500;

async function storeScores(db: Db, products: ScoreSource[]): Promise<string | null> {
  if (!products.length) return null;
  const computedAt = new Date().toISOString();
  const rows: TablesInsert<"opportunity_scores">[] = products.map((p) => {
    const r = computeOpportunityScore({ ...p, provenance: (p.provenance ?? {}) as Provenance });
    return {
      product_id: p.id,
      owner_id: p.owner_id,
      score: r.score,
      confidence: r.confidence,
      score_version: r.version,
      result: r as unknown as NonNullable<Json>,
      computed_at: computedAt,
    };
  });
  const { error } = await db.from("opportunity_scores").upsert(rows, { onConflict: "product_id" });
  return error?.message ?? null;
}

/**
 * Recomputes and stores the Opportunity Score for the given products. Call after any write
 * that changes product fields. Returns an error message, or null on success.
 */
export async function refreshOpportunityScores(db: Db, productIds: string[]): Promise<string | null> {
  const ids = [...new Set(productIds)];
  for (let i = 0; i < ids.length; i += ID_BATCH) {
    const { data, error } = await db.from("products").select(SCORE_COLUMNS).in("id", ids.slice(i, i + ID_BATCH));
    if (error) return error.message;
    const storeError = await storeScores(db, data);
    if (storeError) return storeError;
  }
  return null;
}

const outdatedFilter = `score_version.is.null,score_version.lt.${SCORE_VERSION}`;

/** Number of the user's products with no score yet or a score from an older formula. */
export async function countOutdatedScores(db: Db): Promise<number> {
  const { count } = await db.from("research_products").select("id", { count: "exact", head: true }).or(outdatedFilter);
  return count ?? 0;
}

/** Scores every product that has no score or an outdated one. Returns how many were scored. */
export async function refreshOutdatedScores(db: Db): Promise<{ scored: number; error: string | null }> {
  let scored = 0;
  // Each pass stores scores, so the next query returns the next set. Bounded as a safety net.
  for (let pass = 0; pass < 200; pass++) {
    const { data, error } = await db.from("research_products").select(SCORE_COLUMNS).or(outdatedFilter).limit(OUTDATED_BATCH);
    if (error) return { scored, error: error.message };
    if (!data.length) return { scored, error: null };
    const storeError = await storeScores(db, data as ScoreSource[]);
    if (storeError) return { scored, error: storeError };
    scored += data.length;
  }
  return { scored, error: null };
}
