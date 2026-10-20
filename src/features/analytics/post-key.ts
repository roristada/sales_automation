/**
 * Normalised identity of a post, so a row in a platform export (a link or a bare ID) can be
 * matched to a publication's recorded post URL. Short links (vt.tiktok.com/…) can't be resolved
 * offline; they only match the same short link.
 */

function platformKey(u: URL): string | null {
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
  const path = u.pathname;
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    const m = /\/video\/(\d+)/.exec(path);
    if (m) return `tiktok:${m[1]}`;
  }
  if (host === "youtu.be") {
    const id = path.split("/")[1];
    if (id) return `shorts:${id}`;
  }
  if (host === "youtube.com" || host.endsWith(".youtube.com")) {
    const m = /^\/(?:shorts|embed|live)\/([\w-]+)/.exec(path);
    if (m) return `shorts:${m[1]}`;
    const v = u.searchParams.get("v");
    if (v) return `shorts:${v}`;
  }
  if (host === "instagram.com" || host.endsWith(".instagram.com")) {
    const m = /^\/(?:[\w.]+\/)?(?:reels?|p)\/([\w-]+)/.exec(path);
    if (m) return `reels:${m[1]}`;
  }
  return null;
}

/** Key for a link or a bare post ID from an export. Null for empty input. */
export function postKey(value: string | null | undefined): string | null {
  const s = (value ?? "").trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) {
    let u: URL;
    try {
      u = new URL(s);
    } catch {
      return null;
    }
    const k = platformKey(u);
    if (k) return k;
    return `url:${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`;
  }
  return `id:${s}`;
}

/** Every key a publication can be found by: its URL, the post ID inside it, and the ID typed in. */
export function publicationKeys(p: { external_url: string | null; external_id: string | null }): string[] {
  const keys = new Set<string>();
  const fromUrl = postKey(p.external_url);
  if (fromUrl) {
    keys.add(fromUrl);
    const id = /^(?:tiktok|shorts|reels):(.+)$/.exec(fromUrl)?.[1];
    if (id) keys.add(`id:${id}`);
  }
  if (p.external_id?.trim()) keys.add(`id:${p.external_id.trim()}`);
  return [...keys];
}
