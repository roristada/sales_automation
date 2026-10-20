import type { Metadata } from "next";
import { SetupRequired } from "@/components/shared/states";
import { isSupabaseConfigured } from "@/lib/env";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "เข้าสู่ระบบ" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <p className="mb-8 text-center text-lg font-semibold tracking-tight">Sales Automation</p>
        <div className="rounded-xl border bg-card p-6">
          <h1 className="text-lg font-semibold">เข้าสู่ระบบ</h1>
          <p className="mb-5 text-[13px] text-muted-foreground">จัดการสินค้า affiliate และสร้างเนื้อหา</p>
          {error && (
            <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
              ลิงก์เข้าสู่ระบบไม่ถูกต้องหรือหมดอายุ กรุณาลองใหม่
            </p>
          )}
          {isSupabaseConfigured() ? <LoginForm next={next} /> : <SetupRequired feature="การเข้าสู่ระบบ" />}
        </div>
      </div>
    </main>
  );
}
