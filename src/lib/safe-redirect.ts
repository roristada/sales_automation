const BASE = "http://local.invalid";
// Backslash, ASCII control characters and DEL.
const UNSAFE_CHARS = /[\\\x00-\x1f\x7f]/;

/**
 * A post-login redirect target that can only stay on this site. Rejects absolute URLs,
 * protocol-relative ("//x"), backslash tricks ("/\x" — browsers treat "\" as "/"), and control
 * characters; the result must resolve to the same origin.
 */
export function safeNext(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || UNSAFE_CHARS.test(next)) return fallback;
  try {
    const url = new URL(next, BASE);
    const out = `${url.pathname}${url.search}${url.hash}`;
    // Check the normalised result too: "/.//evil.com" or "/%2e//evil.com" become "//evil.com".
    return url.origin === BASE && out.startsWith("/") && !out.startsWith("//") && !out.startsWith("/\\") ? out : fallback;
  } catch {
    return fallback;
  }
}
