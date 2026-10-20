"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/features/products/actions";
import { getStorage } from "@/features/video/storage";
import { getCurrentUser } from "@/lib/supabase/server";
import { ASSET_LICENSES, ASSET_SOURCES } from "./licensing";

const uuid = z.uuid();

export interface AssetFormState {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

const editSchema = z.object({
  name: z.string().trim().min(1, "ต้องมีชื่อ").max(200),
  source: z.enum(ASSET_SOURCES),
  license: z.enum(ASSET_LICENSES),
  source_url: z
    .string()
    .trim()
    .max(2000)
    .transform((s) => s || null)
    .pipe(z.url({ protocol: /^https?$/, error: "ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://" }).nullable()),
  attribution: z
    .string()
    .trim()
    .max(300)
    .transform((s) => s || null),
  notes: z
    .string()
    .trim()
    .max(1000)
    .transform((s) => s || null),
  ai_generated: z.preprocess((v) => v === "on", z.boolean()),
  product_id: z.preprocess((v) => (v === "" || v === null ? null : v), z.uuid().nullable()),
});

export async function updateAsset(id: string, _prev: AssetFormState, formData: FormData): Promise<AssetFormState> {
  if (!uuid.safeParse(id).success) return { error: "รหัสไม่ถูกต้อง" };
  const parsed = editSchema.safeParse({
    name: formData.get("name") ?? "",
    source: formData.get("source"),
    license: formData.get("license"),
    source_url: formData.get("source_url") ?? "",
    attribution: formData.get("attribution") ?? "",
    notes: formData.get("notes") ?? "",
    ai_generated: formData.get("ai_generated"),
    product_id: formData.get("product_id") ?? "",
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { fieldErrors };
  }
  const { supabase } = await getCurrentUser();
  if (!supabase) return { error: "ยังไม่ได้เข้าสู่ระบบ" };
  const { error, count } = await supabase.from("assets").update(parsed.data, { count: "exact" }).eq("id", id);
  if (error) return { error: `บันทึกไม่สำเร็จ: ${error.message}` };
  if (!count) return { error: "ไม่พบไฟล์ หรือไม่มีสิทธิ์แก้ไข" };
  revalidatePath("/assets");
  return { ok: true };
}

export async function deleteAsset(id: string): Promise<ActionResult<null>> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "รหัสไม่ถูกต้อง" };
  const { supabase, user } = await getCurrentUser();
  if (!supabase || !user) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };
  const { error, count } = await supabase.from("assets").delete({ count: "exact" }).eq("id", id);
  if (error?.code === "23503") return { ok: false, error: "ไฟล์นี้ถูกใช้อยู่ในฉากของสคริปต์ — เอาออกจากฉากก่อน (สคริปต์ที่อนุมัติแล้วต้องลบโปรเจกต์หรือคงไฟล์ไว้)" };
  if (error) return { ok: false, error: `ลบไม่สำเร็จ: ${error.message}` };
  if (!count) return { ok: false, error: "ไม่พบไฟล์ หรือไม่มีสิทธิ์ลบ" };
  await getStorage().removePrefix(`${user.id}/${id}`);
  revalidatePath("/assets");
  return { ok: true, data: null };
}
