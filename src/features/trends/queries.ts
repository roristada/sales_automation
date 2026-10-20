import "server-only";

import type { getCurrentUser } from "@/lib/supabase/server";
import type { Granularity, TrendPoint } from "./google-trends-csv";

type Db = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>["supabase"]>;

const PAGE = 1000;
const MAX_OBSERVATIONS = 50_000;

export interface KeywordSeries {
  importId: string;
  fileName: string | null;
  keyword: string;
  region: string | null;
  category: string | null;
  granularity: Granularity;
  retrievedAt: string;
  importedAt: string;
  points: TrendPoint[];
}

/**
 * Latest imported series for each keyword. Older imports of the same keyword are listed
 * separately as history; values are never merged across imports (each is relative to itself).
 */
export async function listLatestSeries(db: Db, onlyKeyword?: string): Promise<{ latest: KeywordSeries[]; imports: { id: string; file_name: string | null; keywords: string[]; created_at: string }[]; error: string | null }> {
  const { data: imports, error } = await db
    .from("trend_imports")
    .select("id, file_name, category, granularity, keywords, retrieved_at, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return { latest: [], imports: [], error: error.message };

  // keyword → newest import that contains it
  const pick = new Map<string, (typeof imports)[number]>();
  for (const imp of imports) for (const k of imp.keywords) if (!pick.has(k) && (!onlyKeyword || k === onlyKeyword)) pick.set(k, imp);
  if (!pick.size) return { latest: [], imports, error: null };

  const importIds = [...new Set([...pick.values()].map((i) => i.id))];
  // PostgREST caps responses at max_rows (1000), so page through.
  const obs: { import_id: string; keyword: string; region: string | null; period_start: string; value: number; below_one: boolean }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error: obsError } = await db
      .from("trend_observations")
      .select("import_id, keyword, region, period_start, value, below_one")
      .in("import_id", importIds)
      .order("id")
      .range(from, from + PAGE - 1);
    if (obsError) return { latest: [], imports, error: obsError.message };
    obs.push(...data);
    if (data.length < PAGE || obs.length >= MAX_OBSERVATIONS) break;
  }

  const latest: KeywordSeries[] = [...pick.entries()].map(([keyword, imp]) => {
    const rows = obs.filter((o) => o.import_id === imp.id && o.keyword === keyword).sort((a, b) => a.period_start.localeCompare(b.period_start));
    return {
      importId: imp.id,
      fileName: imp.file_name,
      keyword,
      region: rows[0]?.region ?? null,
      category: imp.category,
      granularity: imp.granularity as Granularity,
      retrievedAt: imp.retrieved_at,
      importedAt: imp.created_at,
      points: rows.map((r) => ({ periodStart: r.period_start, value: Number(r.value), belowOne: r.below_one })),
    };
  });
  latest.sort((a, b) => a.keyword.localeCompare(b.keyword, "th"));
  return { latest, imports, error: null };
}
