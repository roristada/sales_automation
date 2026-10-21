import type { WorkflowStatus } from "@/components/shared/status-badge";
import { AI_CAPTION_NOTE } from "@/features/ai/clips";
import type { Platform } from "@/features/content/templates";
import type { SourceConnection } from "@/features/sources/types";

/**
 * Publishing (PLAN.md M6). No platform API is connected, so posting is manual: the user takes
 * the export pack (MP4, cover, captions, caption text, affiliate link), posts it, and records
 * the post URL. A `PublishingAdapter` with `publish` plugs in once a platform grants access.
 */

export type PublicationStatus = "draft" | "scheduled" | "published" | "withdrawn";

export interface PublishingAdapter {
  platform: Platform;
  label: string;
  /** Where the affiliate link goes on this platform (captions aren't clickable everywhere). */
  linkPlacement: string;
  /** Caption length the platform accepts. */
  captionLimit: number;
  /** Hosts a post URL on this platform may use. */
  postHosts: string[];
  connection(): SourceConnection;
  /** API posting. Absent until OAuth and the platform's app review are in place. */
  publish?(input: { videoPath: string; caption: string }): Promise<{ externalId: string; externalUrl: string }>;
}

const tiktok: PublishingAdapter = {
  platform: "tiktok",
  label: "TikTok",
  linkPlacement: "ลิงก์ในแคปชันกดไม่ได้ — ใส่ลิงก์ในตะกร้าสินค้า (TikTok Shop) หรือในไบโอ",
  captionLimit: 2200,
  postHosts: ["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"],
  connection: () => ({ state: "not_connected", note: "ยังไม่ได้เชื่อมต่อ — Content Posting API ต้องใช้ OAuth และผ่านการตรวจแอปของ TikTok ก่อนจึงโพสต์แบบสาธารณะได้ ระหว่างนี้โพสต์เองแล้วบันทึกลิงก์" }),
};

const reels: PublishingAdapter = {
  platform: "reels",
  label: "Instagram Reels",
  linkPlacement: "ลิงก์ในแคปชันกดไม่ได้ — ใส่ลิงก์ในไบโอหรือสติกเกอร์ลิงก์ใน Story",
  captionLimit: 2200,
  postHosts: ["instagram.com"],
  connection: () => ({ state: "not_connected", note: "ยังไม่ได้เชื่อมต่อ — ต้องใช้บัญชี Business/Creator ที่ผูกกับ Facebook Page และแอปที่ผ่าน App Review ของ Meta ระหว่างนี้โพสต์เองแล้วบันทึกลิงก์" }),
};

const shorts: PublishingAdapter = {
  platform: "shorts",
  label: "YouTube Shorts",
  linkPlacement: "ใส่ลิงก์ในคำอธิบายได้ (อยู่ในแคปชันด้านล่างแล้ว)",
  captionLimit: 5000,
  postHosts: ["youtube.com", "youtu.be"],
  connection: () => ({ state: "not_connected", note: "ยังไม่ได้เชื่อมต่อ — YouTube Data API ต้องใช้ OAuth และวิดีโอจากแอปที่ยังไม่ผ่านการตรวจจะถูกตั้งเป็นส่วนตัว ระหว่างนี้โพสต์เองแล้วบันทึกลิงก์" }),
};

export const PUBLISHING_ADAPTERS: Record<Platform, PublishingAdapter> = { tiktok, reels, shorts };
export const getPublishingAdapter = (p: Platform) => PUBLISHING_ADAPTERS[p];

export const PUBLICATION_STATUS_LABEL: Record<PublicationStatus, string> = {
  draft: "เตรียมไว้ ยังไม่โพสต์",
  scheduled: "ตั้งเวลาไว้ (โพสต์เอง)",
  published: "เผยแพร่แล้ว",
  withdrawn: "ลบโพสต์แล้ว",
};

export const PUBLICATION_BADGE: Record<PublicationStatus, WorkflowStatus> = { draft: "draft", scheduled: "queued", published: "published", withdrawn: "unavailable" };

/**
 * First caption for a publication: the script's caption, then the disclosure; on platforms
 * where caption links work, the affiliate link too.
 */
export function composeCaption(input: { caption: string; disclosure: string; affiliateUrl: string | null; platform: Platform; aiGenerated?: boolean }): string {
  const parts = [input.caption.trim(), input.disclosure, input.aiGenerated ? AI_CAPTION_NOTE : ""];
  if (input.platform === "shorts" && input.affiliateUrl) parts.push(input.affiliateUrl);
  return parts.filter(Boolean).join("\n\n");
}

/** Returns an error message, or null when `url` looks like a post on `platform`. */
export function checkPostUrl(url: string, platform: Platform): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return "ลิงก์ไม่ถูกต้อง";
  }
  if (u.protocol !== "https:") return "ลิงก์ต้องขึ้นต้นด้วย https://";
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
  const adapter = PUBLISHING_ADAPTERS[platform];
  if (!adapter.postHosts.some((h) => host === h || host.endsWith(`.${h}`))) return `ไม่ใช่ลิงก์ของ ${adapter.label} (${adapter.postHosts[0]})`;
  if (u.pathname === "/" || u.pathname === "") return "ใส่ลิงก์ของโพสต์ ไม่ใช่หน้าแรกของเว็บ";
  return null;
}

export interface PublicationIssue {
  level: "error" | "warn";
  message: string;
}

/** Checks before posting. Errors block "บันทึกว่าเผยแพร่แล้ว"; warnings are shown. */
export function checkPublication(p: { caption: string; disclosure: string; affiliateUrl: string | null; platform: Platform; isLatestRender: boolean }): PublicationIssue[] {
  const issues: PublicationIssue[] = [];
  const limit = PUBLISHING_ADAPTERS[p.platform].captionLimit;
  if (!p.caption.includes(p.disclosure)) issues.push({ level: "error", message: "แคปชันต้องมีข้อความเปิดเผยว่าเป็นลิงก์ affiliate" });
  if (p.caption.length > limit) issues.push({ level: "error", message: `แคปชันยาว ${p.caption.length} ตัวอักษร เกินที่ ${PUBLISHING_ADAPTERS[p.platform].label} รับได้ (${limit})` });
  if (!p.affiliateUrl) issues.push({ level: "warn", message: "ยังไม่มีลิงก์ affiliate — เพิ่มในหน้าสินค้าหรือในช่องด้านล่าง" });
  if (!p.isLatestRender) issues.push({ level: "warn", message: "มีวิดีโอที่ render ใหม่กว่าไฟล์นี้" });
  return issues;
}
