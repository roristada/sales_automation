import { describe, expect, it } from "vitest";
import { parseGoogleTrendsCsv, type TrendPoint } from "./google-trends-csv";
import { summarizeTrend } from "./summary";

const english = `Category: All categories

Week,หูฟังไร้สาย: (Thailand),ลำโพง: (Thailand)
2026-08-30,40,<1
2026-09-06,42,3
2026-09-13,55,2
`;

describe("parseGoogleTrendsCsv", () => {
  it("parses the English export with keyword, region and <1", () => {
    const r = parseGoogleTrendsCsv(english);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ category: "All categories", granularity: "week", periodStart: "2026-08-30", periodEnd: "2026-09-13" });
    expect(r.data.series.map((s) => [s.keyword, s.region])).toEqual([
      ["หูฟังไร้สาย", "Thailand"],
      ["ลำโพง", "Thailand"],
    ]);
    expect(r.data.series[1].points[0]).toEqual({ periodStart: "2026-08-30", value: 0, belowOne: true });
    expect(r.data.series[0].points[2].value).toBe(55);
  });

  it("parses the Thai UI export with Buddhist-era dates and a BOM", () => {
    const r = parseGoogleTrendsCsv("﻿หมวดหมู่: ทุกหมวดหมู่\n\nสัปดาห์,พัดลม: (ประเทศไทย)\n30/08/2569,10\n06/09/2569,12\n");
    expect(r.ok && r.data).toMatchObject({ category: "ทุกหมวดหมู่", granularity: "week", periodStart: "2026-08-30" });
    expect(r.ok && r.data.series[0]).toMatchObject({ keyword: "พัดลม", region: "ประเทศไทย" });
  });

  it("infers granularity from dates when the header is generic", () => {
    const r = parseGoogleTrendsCsv("Time,a\n2026-01-01,1\n2026-02-01,2\n2026-03-01,3\n");
    expect(r.ok && r.data.granularity).toBe("month");
  });

  it("rejects bad values, dates and files without a header", () => {
    const bad = parseGoogleTrendsCsv("Week,a: (Thailand)\n2026-09-06,abc\nnot-a-date,5\n");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors).toHaveLength(2);
    expect(parseGoogleTrendsCsv("Week,a\n2026-09-06,101\n").ok).toBe(false);
    expect(parseGoogleTrendsCsv("name,price\nx,1\n").ok).toBe(false);
    expect(parseGoogleTrendsCsv("Week,a\n2026-09-13,1\n2026-09-06,2\n").ok).toBe(false);
  });
});

const weekly = (values: number[], start = "2026-06-07"): TrendPoint[] =>
  values.map((value, i) => ({ periodStart: new Date(Date.parse(start) + i * 7 * 86_400_000).toISOString().slice(0, 10), value, belowOne: false }));

describe("summarizeTrend", () => {
  const later = new Date("2027-01-01");

  it("compares the last 4 weeks with the 4 before", () => {
    const s = summarizeTrend(weekly([20, 20, 20, 20, 30, 30, 30, 30]), "week", later);
    expect(s.changePct).toBe(50);
    expect(s.direction).toBe("rising");
    expect(s.latest?.value).toBe(30);
    expect(s.peak?.value).toBe(30);
  });

  it("treats small changes as flat and big drops as falling", () => {
    expect(summarizeTrend(weekly([50, 50, 50, 50, 55, 55, 55, 55]), "week", later).direction).toBe("flat");
    expect(summarizeTrend(weekly([80, 80, 80, 80, 40, 40, 40, 40]), "week", later).direction).toBe("falling");
  });

  it("drops the in-progress last period", () => {
    const pts = weekly([20, 20, 20, 20, 30, 30, 30, 30, 5]);
    const retrieved = new Date(Date.parse(pts[8].periodStart) + 2 * 86_400_000);
    const s = summarizeTrend(pts, "week", retrieved);
    expect(s.partialDropped).toBe(true);
    expect(s.latest?.value).toBe(30);
    expect(s.changePct).toBe(50);
  });

  it("gives no direction with too little data", () => {
    const s = summarizeTrend(weekly([1, 2, 3]), "week", later);
    expect(s.direction).toBeNull();
    expect(s.note).toMatch(/น้อยกว่า 8/);
  });

  it("does not divide by zero", () => {
    expect(summarizeTrend(weekly([0, 0, 0, 0, 10, 10, 10, 10]), "week", later)).toMatchObject({ direction: "rising", changePct: null });
  });
});
