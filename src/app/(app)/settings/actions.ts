"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/supabase/server";

export interface ProfileState {
  error?: string;
  message?: string;
}

const schema = z.object({ display_name: z.string().trim().max(80, "ชื่อยาวเกิน 80 ตัวอักษร") });

export async function updateProfile(_prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const parsed = schema.safeParse({ display_name: formData.get("display_name") ?? "" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { supabase, user } = await getCurrentUser();
  if (!supabase || !user) return { error: "ยังไม่ได้เข้าสู่ระบบ" };

  const { error } = await supabase
    .from("profiles")
    .update({ display_name: parsed.data.display_name || null })
    .eq("id", user.id);
  if (error) return { error: `บันทึกไม่สำเร็จ: ${error.message}` };
  revalidatePath("/", "layout");
  return { message: "บันทึกแล้ว" };
}

export interface LimitsState {
  error?: string;
  fieldErrors?: Partial<Record<"daily_thb" | "monthly_thb", string>>;
  message?: string;
}

const money = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z.coerce.number({ error: "ต้องเป็นตัวเลข" }).min(0, "ต้องไม่ติดลบ").max(10_000_000, "มากเกินไป").nullable(),
);
const limitsSchema = z.object({ daily_thb: money, monthly_thb: money });

/** Daily/monthly spending caps in THB. Empty = no cap. */
export async function saveSpendingLimits(_prev: LimitsState, formData: FormData): Promise<LimitsState> {
  const parsed = limitsSchema.safeParse({ daily_thb: formData.get("daily_thb") ?? "", monthly_thb: formData.get("monthly_thb") ?? "" });
  if (!parsed.success) {
    const fe: LimitsState["fieldErrors"] = {};
    for (const i of parsed.error.issues) fe[i.path[0] as "daily_thb"] ??= i.message;
    return { fieldErrors: fe };
  }
  const { supabase, user } = await getCurrentUser();
  if (!supabase || !user) return { error: "ยังไม่ได้เข้าสู่ระบบ" };
  const { error } = await supabase.from("spending_limits").upsert({ owner_id: user.id, ...parsed.data }, { onConflict: "owner_id" });
  if (error) return { error: `บันทึกไม่สำเร็จ: ${error.message}` };
  revalidatePath("/settings");
  return { message: "บันทึกเพดานค่าใช้จ่ายแล้ว" };
}
