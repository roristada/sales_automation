"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/features/products/actions";
import { getCurrentUser } from "@/lib/supabase/server";
import { refreshOutdatedScores } from "./scores";

/** Scores products that have no score yet (e.g. created before Milestone 2) or an outdated one. */
export async function recomputeOutdatedScores(): Promise<ActionResult<{ scored: number }>> {
  const { supabase, user } = await getCurrentUser();
  if (!supabase || !user) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };
  const { scored, error } = await refreshOutdatedScores(supabase);
  if (error) return { ok: false, error: `คำนวณคะแนนไม่สำเร็จ: ${error}` };
  revalidatePath("/research");
  return { ok: true, data: { scored } };
}
