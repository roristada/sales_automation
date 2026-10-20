import { describe, expect, it } from "vitest";
import { normalizeStatus, parseConversionsCsv, parseDuration, parseOrderTime, parsePostMetricsCsv } from "./csv";
import { postKey, publicationKeys } from "./post-key";
import { summarize } from "./summary";

describe("postKey", () => {
  it("normalises platform links to one key per post", () => {
    expect(postKey("https://www.tiktok.com/@me/video/7312345678901234567?is_from_webapp=1")).toBe("tiktok:7312345678901234567");
    expect(postKey("https://m.tiktok.com/v/video/7312345678901234567")).toBe("tiktok:7312345678901234567");
    expect(postKey("https://youtube.com/shorts/AbC_d-12345")).toBe("shorts:AbC_d-12345");
    expect(postKey("https://youtu.be/AbC_d-12345")).toBe("shorts:AbC_d-12345");
    expect(postKey("https://www.youtube.com/watch?v=AbC_d-12345")).toBe("shorts:AbC_d-12345");
    expect(postKey("https://www.instagram.com/reel/Cxyz123/")).toBe("reels:Cxyz123");
    expect(postKey("https://www.instagram.com/someone/p/Cxyz123/")).toBe("reels:Cxyz123");
    expect(postKey("https://vt.tiktok.com/ZSabc/")).toBe("url:vt.tiktok.com/ZSabc");
    expect(postKey("7312345678901234567")).toBe("id:7312345678901234567");
    expect(postKey("  ")).toBeNull();
  });

  it("finds a publication by its URL, the ID inside it, or the typed ID", () => {
    expect(publicationKeys({ external_url: "https://www.tiktok.com/@me/video/731", external_id: "x9" }).sort()).toEqual(["id:731", "id:x9", "tiktok:731"]);
  });
});

describe("parseDuration / parseOrderTime / normalizeStatus", () => {
  it("reads common duration formats", () => {
    expect(parseDuration("83")).toBe(83);
    expect(parseDuration("8.5s")).toBe(8.5);
    expect(parseDuration("1:23")).toBe(83);
    expect(parseDuration("1:02:03")).toBe(3723);
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("abc")).toBe("invalid");
  });

  it("treats zone-less report times as Thai time", () => {
    expect(parseOrderTime("2026-10-20 13:45:00")).toBe("2026-10-20T06:45:00.000Z");
    expect(parseOrderTime("20/10/2569 13:45")).toBe("2026-10-20T06:45:00.000Z");
    expect(parseOrderTime("")).toBeNull();
    expect(parseOrderTime("yesterday")).toBe("invalid");
  });

  it("maps English and Thai order statuses", () => {
    expect(normalizeStatus("Completed")).toBe("completed");
    expect(normalizeStatus("สำเร็จ")).toBe("completed");
    expect(normalizeStatus("Pending")).toBe("pending");
    expect(normalizeStatus("รอดำเนินการ")).toBe("pending");
    expect(normalizeStatus("Cancelled")).toBe("cancelled");
    expect(normalizeStatus("ยกเลิก")).toBe("cancelled");
    expect(normalizeStatus("")).toBe("unknown");
    expect(normalizeStatus("weird")).toBe("unknown");
  });
});

describe("parsePostMetricsCsv", () => {
  it("reads a TikTok-style export, keeps missing values null, reports bad rows", () => {
    const csv = [
      "﻿Video link,Video views,Likes,Comments,Shares,Average watch time,Link clicks",
      "https://www.tiktok.com/@me/video/111,\"1,234\",56,7,,0:09,3",
      "https://www.tiktok.com/@me/video/222,abc,1,1,1,5,1",
      ",10,1,1,1,5,1",
    ].join("\n");
    const r = parsePostMetricsCsv(csv, "2026-10-20");
    if (!r.ok) throw new Error(r.error);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ post_key: "tiktok:111", captured_on: "2026-10-20", views: 1234, likes: 56, comments: 7, shares: null, saves: null, avg_watch_s: 9 });
    expect(r.errors.map((e) => e.line)).toEqual([3, 4]);
    expect(r.errors[0].message).toMatch(/ยอดดู/);
  });

  it("reads a YouTube Studio export (Content = video ID, Total row, watch hours, date column)", () => {
    const csv = ["Content,Video title,Date,Views,Watch time (hours),Average view duration", "Total,,,,10,", "AbC_d-12345,ทดสอบ,2026-10-19,200,0.5,0:00:09"].join("\n");
    const r = parsePostMetricsCsv(csv, "2026-10-20");
    if (!r.ok) throw new Error(r.error);
    expect(r.rows).toEqual([expect.objectContaining({ post_key: "id:AbC_d-12345", title: "ทดสอบ", captured_on: "2026-10-19", views: 200, watch_time_s: 1800, avg_watch_s: 9 })]);
    expect(r.errors).toEqual([]);
  });

  it("rejects files without a post column or any metric", () => {
    expect(parsePostMetricsCsv("Name,Price\na,1", "2026-10-20").ok).toBe(false);
    expect(parsePostMetricsCsv("Video link,Notes\nhttps://x.test/a,1", "2026-10-20").ok).toBe(false);
  });
});

describe("parseConversionsCsv", () => {
  it("reads a Shopee-style report with Sub_ids; net commission wins over item commission", () => {
    const csv = [
      "Order id,Order Status,Purchase Time,Item id,Item Name,Purchase Value(฿),Item Commission(฿),Net Commission(฿),Sub_id1,Sub_id2",
      "2510AB,Completed,2026-10-20 13:45:00,99,หูฟัง,\"1,290.00\",50,45.5,SAabc123,",
      "2510AB,Completed,2026-10-20 13:45:00,98,สายชาร์จ,100,5,4,,",
      "2510CD,Cancelled,2026-10-20 14:00:00,97,พัดลม,300,10,0,,",
      ",Pending,,,x,1,1,1,,",
    ].join("\n");
    const r = parseConversionsCsv(csv);
    if (!r.ok) throw new Error(r.error);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toMatchObject({ order_id: "2510AB", item_key: "99", status: "completed", order_value_thb: 1290, commission_thb: 45.5, sub_ids: ["saabc123"], ordered_at: "2026-10-20T06:45:00.000Z" });
    expect(r.rows[2].status).toBe("cancelled");
    expect(r.errors).toEqual([{ line: 5, message: "ไม่มีรหัสคำสั่งซื้อ" }]);
  });

  it("reads Thai headers and needs order id + commission", () => {
    const r = parseConversionsCsv("รหัสคำสั่งซื้อ,สถานะคำสั่งซื้อ,ค่าคอมมิชชันสุทธิ\nA1,รอดำเนินการ,12");
    expect(r.ok && r.rows[0]).toMatchObject({ order_id: "A1", status: "pending", commission_thb: 12, sub_ids: [] });
    expect(parseConversionsCsv("Order id,Status\nA1,ok").ok).toBe(false);
  });
});

describe("summarize", () => {
  const publications = [
    { id: "p1", projectId: "c1" },
    { id: "p2", projectId: "c2" },
    { id: "p3", projectId: "c2" },
  ];
  const m = (publicationId: string | null, postKey: string, capturedOn: string, views: number | null) => ({ publicationId, postKey, capturedOn, views, likes: null, comments: null, shares: null, saves: null, avgWatchS: null });

  it("keeps attributed commission apart from totals and uses the latest snapshot", () => {
    const { byPublication, totals } = summarize({
      publications,
      metrics: [m("p1", "tiktok:1", "2026-10-18", 100), m("p1", "tiktok:1", "2026-10-20", 250), m(null, "tiktok:9", "2026-10-20", 999)],
      conversions: [
        { publicationId: "p1", status: "completed", commission: 40, orderValue: 400 },
        { publicationId: "p1", status: "pending", commission: 10, orderValue: 100 },
        { publicationId: null, status: "completed", commission: 25, orderValue: 250 },
        { publicationId: "p1", status: "cancelled", commission: 0, orderValue: 90 },
      ],
      projectCosts: new Map([
        ["c1", 1.5],
        ["c2", 2],
      ]),
    });
    const p1 = byPublication.get("p1")!;
    expect(p1.latest).toMatchObject({ capturedOn: "2026-10-20", views: 250, snapshots: 2 });
    expect(p1.commission.completed).toEqual({ orders: 1, commission: 40 });
    expect(p1.commission.pending).toEqual({ orders: 1, commission: 10 });
    expect(p1.net).toBe(38.5);
    expect(totals.all.completed).toEqual({ orders: 2, commission: 65 });
    expect(totals.attributed.completed.commission).toBe(40);
    expect(totals.unattributed.completed.commission).toBe(25);
    expect(totals.matchedViews).toBe(250); // unmatched post's 999 is not counted
    expect(totals.matchedPosts).toBe(1);
    expect(totals.unmatchedPosts).toBe(1);
    expect(totals.cost).toBe(3.5);
  });

  it("leaves missing data null instead of 0", () => {
    const { byPublication, totals } = summarize({ publications, metrics: [], conversions: [], projectCosts: new Map() });
    const p2 = byPublication.get("p2")!;
    expect(p2.latest).toBeNull();
    expect(p2.cost).toBeNull();
    expect(p2.net).toBeNull();
    expect(p2.costShared).toBe(true); // p2 and p3 are the same content
    expect(totals.matchedViews).toBeNull();
  });
});
