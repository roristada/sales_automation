/**
 * Cost estimates and spending caps (PLAN.md M5: over the cap → stop with a message).
 * Rates are THB per unit, from env so a paid setup (e.g. a Remotion company license billed per
 * render, a TTS or LLM provider) can be priced without code changes. Local rendering under the
 * Remotion Free License costs nothing, so its default rate is 0.
 */

export const PROVIDER_LABEL: Record<string, string> = {
  render: "Render วิดีโอ (บนเครื่องนี้)",
  tts: "เสียงพากย์ (TTS)",
  llm: "AI ช่วยเขียน (API)",
};

export function renderRateThbPerSecond(): number {
  const v = Number(process.env.RENDER_COST_THB_PER_VIDEO_SECOND ?? "0");
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

export function estimateRenderCost(videoSeconds: number, rate = renderRateThbPerSecond()): number {
  return Math.round(videoSeconds * rate * 10_000) / 10_000;
}

export interface Limits {
  daily_thb: number | null;
  monthly_thb: number | null;
}

export interface Spent {
  today_thb: number;
  month_thb: number;
}

export type BudgetCheck = { ok: true } | { ok: false; message: string };

const baht = (n: number) => `฿${n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Free work is never blocked; paid work is blocked if it would push spend past a cap. */
export function checkBudget(limits: Limits | null, spent: Spent, estimate: number): BudgetCheck {
  if (estimate <= 0 || !limits) return { ok: true };
  for (const [cap, used, label] of [
    [limits.daily_thb, spent.today_thb, "รายวัน"],
    [limits.monthly_thb, spent.month_thb, "รายเดือน"],
  ] as const) {
    if (cap !== null && used + estimate > cap) {
      return { ok: false, message: `เกินงบ${label} ${baht(cap)} (ใช้ไปแล้ว ${baht(used)} งานนี้ประมาณ ${baht(estimate)}) — ปรับเพดานได้ที่หน้าตั้งค่า` };
    }
  }
  return { ok: true };
}
