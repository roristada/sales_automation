"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isSignupDisabled } from "@/lib/env";
import { safeNext } from "@/lib/safe-redirect";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const credentialsSchema = z.object({
  email: z.email("กรอกอีเมลให้ถูกต้อง"),
  password: z.string().min(8, "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร"),
  next: z.string().optional(),
});

export interface AuthFormState {
  error?: string;
  message?: string;
  fieldErrors?: Partial<Record<"email" | "password", string>>;
  email?: string;
}

function parse(formData: FormData) {
  const result = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  if (result.success) return { data: result.data } as const;
  const fieldErrors: AuthFormState["fieldErrors"] = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    if (key === "email" || key === "password") fieldErrors[key] ??= issue.message;
  }
  return { state: { fieldErrors, email: String(formData.get("email") ?? "") } } as const;
}

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = parse(formData);
  if (!parsed.data) return parsed.state;
  const supabase = await createClient();
  if (!supabase) return { error: "ยังไม่ได้ตั้งค่า Supabase", email: parsed.data.email };

  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  // Generic message: do not reveal whether the email exists.
  if (error) return { error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง", email: parsed.data.email };

  redirect(safeNext(parsed.data.next));
}

export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  if (isSignupDisabled()) return { error: "ปิดการสร้างบัญชีใหม่แล้ว" };
  const parsed = parse(formData);
  if (!parsed.data) return parsed.state;
  const supabase = await createClient();
  if (!supabase) return { error: "ยังไม่ได้ตั้งค่า Supabase", email: parsed.data.email };

  const origin = (await headers()).get("origin") ?? "";
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) return { error: error.message, email: parsed.data.email };

  // With email confirmation enabled there is no session yet.
  if (!data.session) {
    return { message: "ตรวจอีเมลเพื่อยืนยันบัญชี แล้วเข้าสู่ระบบ", email: parsed.data.email };
  }
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase?.auth.signOut();
  redirect("/login");
}
