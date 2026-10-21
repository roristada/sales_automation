import "server-only";

import type { Provenance } from "@/features/products/schema";
import type { Tables } from "@/lib/supabase/database.types";
import type { getCurrentUser } from "@/lib/supabase/server";
import { buildFacts, type Fact } from "./facts";
import { getTemplate } from "./templates";
import { validateStoryboard, type ValidationIssue } from "./validate";

export type Db = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>["supabase"]>;

export type Storyboard = Tables<"storyboards">;
export type Scene = Tables<"storyboard_scenes"> & { claims: Tables<"scene_claims">[] };
export type ProductForContent = Pick<
  Tables<"products">,
  "id" | "name" | "spoken_name" | "price" | "category" | "marketplace" | "description" | "provenance" | "retrieved_at" | "updated_at" | "affiliate_url"
>;

export const PRODUCT_COLUMNS = "id, name, spoken_name, price, category, marketplace, description, provenance, retrieved_at, updated_at, affiliate_url";

export async function loadFacts(db: Db, product: ProductForContent): Promise<{ facts: Fact[]; rows: Tables<"product_facts">[] }> {
  const { data } = await db.from("product_facts").select("*").eq("product_id", product.id).order("position").order("created_at");
  const rows = data ?? [];
  return { facts: buildFacts({ ...product, provenance: product.provenance as Provenance }, rows), rows };
}

export type StudioAsset = Pick<Tables<"assets">, "id" | "name" | "kind" | "license" | "attribution" | "source" | "ai_generated" | "duration_s" | "product_id">;

export interface StudioBundle {
  storyboard: Storyboard;
  project: Tables<"content_projects">;
  product: ProductForContent;
  facts: Fact[];
  factRows: Tables<"product_facts">[];
  scenes: Scene[];
  /** The user's asset library, for the scene media picker and license checks. */
  assets: StudioAsset[];
  versions: Pick<Storyboard, "id" | "version" | "status" | "created_at">[];
  issues: ValidationIssue[];
}

/** Everything the Script Studio needs for one storyboard, plus its validation result. */
export async function loadStudio(db: Db, storyboardId: string): Promise<StudioBundle | null> {
  const { data: storyboard } = await db.from("storyboards").select("*").eq("id", storyboardId).maybeSingle();
  if (!storyboard) return null;
  const { data: project } = await db.from("content_projects").select("*").eq("id", storyboard.project_id).maybeSingle();
  if (!project) return null;
  const [{ data: product }, { data: sceneRows }, { data: versions }, { data: assetRows }] = await Promise.all([
    db.from("products").select(PRODUCT_COLUMNS).eq("id", project.product_id).maybeSingle(),
    db.from("storyboard_scenes").select("*, claims:scene_claims(*)").eq("storyboard_id", storyboardId).order("position"),
    db.from("storyboards").select("id, version, status, created_at").eq("project_id", project.id).order("version", { ascending: false }),
    db.from("assets").select("id, name, kind, license, attribution, source, ai_generated, duration_s, product_id").in("kind", ["image", "video"]).order("created_at", { ascending: false }).limit(500),
  ]);
  const assets = assetRows ?? [];
  const assetById = new Map(assets.map((a) => [a.id, a]));
  if (!product) return null;
  const { facts, rows } = await loadFacts(db, product);
  const scenes = (sceneRows ?? []).map((s) => ({ ...s, claims: [...s.claims].sort((a, b) => a.created_at.localeCompare(b.created_at)) }));
  const issues = validateStoryboard(
    {
      hook: storyboard.hook,
      caption: storyboard.caption,
      cta: storyboard.cta,
      disclosure: storyboard.disclosure,
      target_duration_s: project.target_duration_s,
      literals: getTemplate(storyboard.template_id)?.literals ?? [],
    },
    scenes.map((s) => ({ ...s, asset: s.asset_id ? (assetById.get(s.asset_id) ?? null) : null })),
    facts,
  );
  return { storyboard, project, product, facts, factRows: rows, scenes, assets, versions: versions ?? [], issues };
}
