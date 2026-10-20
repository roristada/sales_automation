import type { Granularity, TrendPoint } from "./google-trends-csv";

/**
 * Plain-language reading of one Google Trends series. Compares the average of the most recent
 * complete periods with the periods before them. Values are relative to this export only.
 */

export type Direction = "rising" | "flat" | "falling";

export interface TrendSummary {
  /** Latest complete period (the last period is dropped when it was still in progress). */
  latest: TrendPoint | null;
  /** Last period was still in progress when the data was retrieved; excluded from the summary. */
  partialDropped: boolean;
  /** % change of recent average vs previous average; null when not enough data or previous is 0. */
  changePct: number | null;
  direction: Direction | null;
  peak: TrendPoint | null;
  /** Number of periods in each comparison window. */
  window: number;
  /** Why there is no direction, when there isn't one. */
  note: string | null;
}

const WINDOW: Record<Granularity, number> = { day: 7, week: 4, month: 3 };
const PERIOD_DAYS: Record<Granularity, number> = { day: 1, week: 7, month: 28 };
/** Change smaller than this is "flat". */
export const FLAT_THRESHOLD_PCT = 15;

const avg = (xs: TrendPoint[]) => xs.reduce((s, p) => s + p.value, 0) / xs.length;

export function summarizeTrend(points: TrendPoint[], granularity: Granularity, retrievedAt: Date): TrendSummary {
  const window = WINDOW[granularity];
  let complete = points;
  let partialDropped = false;
  const last = points[points.length - 1];
  if (last) {
    const end = Date.parse(last.periodStart) + PERIOD_DAYS[granularity] * 86_400_000;
    if (end > retrievedAt.getTime()) {
      complete = points.slice(0, -1);
      partialDropped = true;
    }
  }

  const latest = complete[complete.length - 1] ?? null;
  const peak = complete.reduce<TrendPoint | null>((best, p) => (!best || p.value > best.value ? p : best), null);
  const base = { latest, partialDropped, peak, window };

  if (complete.length < window * 2) return { ...base, changePct: null, direction: null, note: `ข้อมูลน้อยกว่า ${window * 2} ช่วง เทียบแนวโน้มไม่ได้` };
  const recent = avg(complete.slice(-window));
  const previous = avg(complete.slice(-window * 2, -window));
  if (previous === 0) {
    return recent === 0
      ? { ...base, changePct: null, direction: "flat", note: "ไม่มีความสนใจในทั้งสองช่วง" }
      : { ...base, changePct: null, direction: "rising", note: "ช่วงก่อนหน้าไม่มีความสนใจ คำนวณ % ไม่ได้" };
  }
  const changePct = Math.round(((recent - previous) / previous) * 100);
  const direction: Direction = changePct >= FLAT_THRESHOLD_PCT ? "rising" : changePct <= -FLAT_THRESHOLD_PCT ? "falling" : "flat";
  return { ...base, changePct, direction, note: null };
}

export const DIRECTION_LABEL: Record<Direction, string> = { rising: "กำลังขึ้น", flat: "ทรงตัว", falling: "กำลังลง" };
export const GRANULARITY_LABEL: Record<Granularity, string> = { day: "รายวัน", week: "รายสัปดาห์", month: "รายเดือน" };
const UNIT: Record<Granularity, string> = { day: "วัน", week: "สัปดาห์", month: "เดือน" };

export function windowLabel(window: number, g: Granularity) {
  return `${window} ${UNIT[g]}ล่าสุด เทียบกับ ${window} ${UNIT[g]}ก่อนหน้า`;
}
