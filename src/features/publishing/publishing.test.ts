import { describe, expect, it } from "vitest";
import { DISCLOSURE } from "@/features/content/templates";
import { checkPostUrl, checkPublication, composeCaption } from "./publishing";

describe("composeCaption", () => {
  it("adds the disclosure; the link only where caption links work", () => {
    const base = { caption: "หูฟัง — รีวิวสั้น ", disclosure: DISCLOSURE, affiliateUrl: "https://s.shopee.co.th/abc" };
    expect(composeCaption({ ...base, platform: "tiktok" })).toBe(`หูฟัง — รีวิวสั้น\n\n${DISCLOSURE}`);
    expect(composeCaption({ ...base, platform: "shorts" })).toBe(`หูฟัง — รีวิวสั้น\n\n${DISCLOSURE}\n\nhttps://s.shopee.co.th/abc`);
    expect(composeCaption({ ...base, caption: "", affiliateUrl: null, platform: "shorts" })).toBe(DISCLOSURE);
    expect(composeCaption({ ...base, platform: "shopee_video" })).toBe(`หูฟัง — รีวิวสั้น

${DISCLOSURE}`);
  });
});

describe("checkPostUrl", () => {
  it("accepts post links of the platform", () => {
    expect(checkPostUrl("https://www.tiktok.com/@me/video/123", "tiktok")).toBeNull();
    expect(checkPostUrl("https://vt.tiktok.com/ZSabc/", "tiktok")).toBeNull();
    expect(checkPostUrl("https://www.instagram.com/reel/Cxyz/", "reels")).toBeNull();
    expect(checkPostUrl("https://youtube.com/shorts/abc", "shorts")).toBeNull();
    expect(checkPostUrl("https://youtu.be/abc", "shorts")).toBeNull();
    expect(checkPostUrl("https://sv.shopee.co.th/share-video/abc", "shopee_video")).toBeNull();
  });

  it("rejects other platforms, look-alike hosts, http and home pages", () => {
    expect(checkPostUrl("https://www.youtube.com/shorts/abc", "tiktok")).toMatch(/TikTok/);
    expect(checkPostUrl("https://tiktok.com.evil.test/video/1", "tiktok")).toMatch(/TikTok/);
    expect(checkPostUrl("https://faketiktok.com/video/1", "tiktok")).toMatch(/TikTok/);
    expect(checkPostUrl("http://www.tiktok.com/@me/video/1", "tiktok")).toMatch(/https/);
    expect(checkPostUrl("https://www.instagram.com/", "reels")).toMatch(/โพสต์/);
    expect(checkPostUrl("not a url", "reels")).toBe("ลิงก์ไม่ถูกต้อง");
    expect(checkPostUrl("https://www.tiktok.com/@me/video/1", "shopee_video")).toMatch(/Shopee/);
  });
});

describe("checkPublication", () => {
  const ok = { caption: `x\n\n${DISCLOSURE}`, disclosure: DISCLOSURE, affiliateUrl: "https://s.shopee.co.th/a", platform: "tiktok" as const, isLatestRender: true };

  it("passes a complete publication", () => {
    expect(checkPublication(ok)).toEqual([]);
  });

  it("blocks a caption without the disclosure or over the platform limit", () => {
    expect(checkPublication({ ...ok, caption: "x" }).filter((i) => i.level === "error")).toHaveLength(1);
    expect(checkPublication({ ...ok, caption: `${"ก".repeat(2200)}${DISCLOSURE}` })[0].message).toMatch(/เกิน/);
    expect(checkPublication({ ...ok, platform: "shorts", caption: `${"ก".repeat(2200)}${DISCLOSURE}` })).toEqual([]);
  });

  it("warns on a missing link and an older render", () => {
    const issues = checkPublication({ ...ok, affiliateUrl: null, isLatestRender: false });
    expect(issues.map((i) => i.level)).toEqual(["warn", "warn"]);
  });
});
