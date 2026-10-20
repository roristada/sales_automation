/**
 * Public Supabase configuration. Both values are safe to expose to the browser;
 * row-level security is what protects user data. The service-role key is never read here.
 */
export function getSupabasePublicEnv(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function isSupabaseConfigured(): boolean {
  return getSupabasePublicEnv() !== null;
}

/**
 * `DISABLE_SIGNUP=true` hides and refuses sign-up in the app once your own account exists. Also turn
 * off sign-ups in Supabase Auth — the anon key can call the sign-up API directly (docs/DEPLOY.md).
 */
export function isSignupDisabled(): boolean {
  return /^(1|true|yes)$/i.test(process.env.DISABLE_SIGNUP ?? "");
}
