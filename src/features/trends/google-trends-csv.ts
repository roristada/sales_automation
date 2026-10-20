import Papa from "papaparse";
import { parseDateCell } from "@/features/products/schema";

/**
 * Parses the "Interest over time" CSV downloaded from the Google Trends website
 * (English or Thai UI). Shape:
 *
 *   Category: All categories            ← optional
 *                                        ← blank
 *   Week,หูฟัง: (Thailand),ลำโพง: (Thailand)
 *   2025-10-19,45,<1
 *
 * Values are relative interest 0–100 within this export. "<1" is kept as 0 + belowOne.
 * Any bad row rejects the whole file: a partial series would mislead.
 */

export type Granularity = "day" | "week" | "month";

export interface TrendPoint {
  periodStart: string; // YYYY-MM-DD
  value: number;
  belowOne: boolean;
}

export interface TrendSeries {
  keyword: string;
  region: string | null;
  points: TrendPoint[];
}

export interface ParsedTrends {
  category: string | null;
  granularity: Granularity;
  periodStart: string;
  periodEnd: string;
  series: TrendSeries[];
}

export type ParseResult = { ok: true; data: ParsedTrends } | { ok: false; errors: string[] };

export const MAX_TREND_KEYWORDS = 5;
const MAX_POINTS = 2000;

const TIME_HEADERS: Record<string, Granularity | null> = {
  week: "week",
  day: "day",
  month: "month",
  สัปดาห์: "week",
  วัน: "day",
  เดือน: "month",
  // Unknown granularity: inferred from the dates.
  time: null,
  date: null,
  เวลา: null,
  วันที่: null,
};

function inferGranularity(dates: string[]): Granularity | null {
  if (dates.length < 2) return null;
  const days = (Date.parse(dates[1]) - Date.parse(dates[0])) / 86_400_000;
  if (days === 1) return "day";
  if (days === 7) return "week";
  if (days >= 28 && days <= 31) return "month";
  return null;
}

export function parseGoogleTrendsCsv(text: string): ParseResult {
  const rows = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" }).data.map((r) => r.map((c) => c.trim()));

  let category: string | null = null;
  const headerIndex = rows.findIndex((r) => r.length >= 2 && r[0].toLowerCase() in TIME_HEADERS);
  if (headerIndex === -1) return { ok: false, errors: ["ไม่พบหัวตาราง (เช่น Week/สัปดาห์ ตามด้วยคีย์เวิร์ด) — ใช้ไฟล์จากปุ่มดาวน์โหลดของกราฟ “ความสนใจตามช่วงเวลา”"] };
  for (const r of rows.slice(0, headerIndex)) {
    const m = /^(?:category|หมวดหมู่)\s*:\s*(.+)$/i.exec(r.join(",").trim());
    if (m) category = m[1].trim();
  }

  const header = rows[headerIndex];
  const series: TrendSeries[] = header.slice(1).map((h) => {
    const m = /^(.*?):\s*\((.*)\)$/.exec(h);
    return { keyword: (m ? m[1] : h).trim(), region: m ? m[2].trim() || null : null, points: [] };
  });
  const errors: string[] = [];
  if (series.some((s) => !s.keyword)) errors.push("มีคอลัมน์คีย์เวิร์ดที่ไม่มีชื่อ");
  if (series.length > MAX_TREND_KEYWORDS) errors.push(`ไฟล์หนึ่งมีคีย์เวิร์ดได้ไม่เกิน ${MAX_TREND_KEYWORDS} คำ`);

  const body = rows.slice(headerIndex + 1);
  if (!body.length) errors.push("ไฟล์ไม่มีข้อมูล");
  if (body.length > MAX_POINTS) errors.push(`ข้อมูลยาวเกิน ${MAX_POINTS} ช่วงเวลา`);
  const dates: string[] = [];
  body.forEach((r, i) => {
    const line = headerIndex + i + 2; // 1-based line in the file, header counted
    const date = parseDateCell(r[0]);
    if (!date || date === "invalid") return void errors.push(`บรรทัด ${line}: วันที่ “${r[0]}” ไม่ถูกต้อง`);
    if (r.length !== header.length) return void errors.push(`บรรทัด ${line}: จำนวนคอลัมน์ไม่ตรงกับหัวตาราง`);
    const day = date.slice(0, 10);
    dates.push(day);
    series.forEach((s, j) => {
      const raw = r[j + 1];
      if (raw === "<1") return void s.points.push({ periodStart: day, value: 0, belowOne: true });
      const n = Number(raw);
      if (raw === "" || !Number.isFinite(n) || n < 0 || n > 100) return void errors.push(`บรรทัด ${line}: ค่า “${raw}” ของ ${s.keyword} ต้องเป็น 0–100 หรือ <1`);
      s.points.push({ periodStart: day, value: n, belowOne: false });
    });
  });
  if (errors.length) return { ok: false, errors: errors.slice(0, 10) };

  if (new Set(dates).size !== dates.length) return { ok: false, errors: ["มีวันที่ซ้ำกันในไฟล์"] };
  if (dates.some((d, i) => i > 0 && d < dates[i - 1])) return { ok: false, errors: ["วันที่ต้องเรียงจากเก่าไปใหม่"] };

  const granularity = TIME_HEADERS[header[0].toLowerCase()] ?? inferGranularity(dates);
  if (!granularity) return { ok: false, errors: ["ระบุช่วงเวลาของข้อมูลไม่ได้ (รายวัน/รายสัปดาห์/รายเดือน)"] };

  return { ok: true, data: { category, granularity, periodStart: dates[0], periodEnd: dates[dates.length - 1], series } };
}
