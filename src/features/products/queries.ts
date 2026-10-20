import "server-only";

import type { getCurrentUser } from "@/lib/supabase/server";

type Db = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>["supabase"]>;

/** Distinct categories the user has, for filter dropdowns. */
export async function listCategories(db: Db): Promise<string[]> {
  const { data } = await db.from("products").select("category").not("category", "is", null).order("category").limit(5000);
  return [...new Set((data ?? []).map((r) => r.category as string))];
}
