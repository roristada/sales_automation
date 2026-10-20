import type { SourceConnection, SourceMode } from "./types";

export const TREND_SOURCES = ["google_trends_csv", "google_trends_api"] as const;
export type TrendSource = (typeof TREND_SOURCES)[number];

/** A place trend signals come from. Same rules as product sources: no fake data when unavailable. */
export interface TrendSourceAdapter {
  key: TrendSource;
  label: string;
  mode: SourceMode;
  connection(): SourceConnection;
}

export const TREND_ADAPTERS: Record<TrendSource, TrendSourceAdapter> = {
  google_trends_csv: {
    key: "google_trends_csv",
    label: "Google Trends (ไฟล์ CSV)",
    mode: "file",
    connection: () => ({ state: "available", note: "ดาวน์โหลด CSV จากกราฟ “ความสนใจตามช่วงเวลา” บน trends.google.com แล้วนำเข้า" }),
  },
  google_trends_api: {
    key: "google_trends_api",
    label: "Google Trends API",
    mode: "api",
    // Alpha with application-only access; scraping the website is not allowed (PLAN.md §4).
    connection: () => ({ state: "not_available", note: "API ยังอยู่ในช่วง alpha ต้องสมัครขอสิทธิ์จาก Google — ใช้ไฟล์ CSV แทน" }),
  },
};

export const listTrendAdapters = () => Object.values(TREND_ADAPTERS);
