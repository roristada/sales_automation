import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signOut } from "@/app/(auth)/actions";
import { AppShell, SIDEBAR_COOKIE } from "@/components/layout/app-shell";
import { SetupRequired } from "@/components/shared/states";
import { getCurrentUser } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user } = await getCurrentUser();
  if (!supabase) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <SetupRequired feature="แอป" />
      </main>
    );
  }
  // Middleware already redirects; this is the server-side guard for every protected page.
  if (!user) redirect("/login");

  const [{ data: profile }, cookieStore] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
    cookies(),
  ]);

  return (
    <AppShell
      account={{ email: user.email ?? "", displayName: profile?.display_name ?? null }}
      signOut={signOut}
      initialCollapsed={cookieStore.get(SIDEBAR_COOKIE)?.value === "1"}
    >
      {children}
    </AppShell>
  );
}
