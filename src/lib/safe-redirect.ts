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
    return url.origin === BASE ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}
