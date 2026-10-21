import { checkBudget, type Limits, type Spent } from "@/features/usage/budget";

/**
 * Spend guard for paid AI jobs (docs/AI_VIDEO_PLAN.md §5): the daily/monthly caps, a cap per
 * video, and a confirmation step for a single job estimated above a threshold.
 */
export interface AiSpendSettings {
  per_video_cap_thb: number | null;
  confirm_over_thb: number;
}

export const DEFAULT_AI_SPEND: AiSpendSettings = { per_video_cap_thb: 150, confirm_over_thb: 30 };

export type AiSpendCheck = { ok: true } | { ok: false; needsConfirm: true; message: string } | { ok: false; needsConfirm: false; message: string };

const baht = (n: number) => `฿${n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function checkAiSpend(input: {
  limits: Limits | null;
  spent: Spent;
  settings: AiSpendSettings;
  /** Already spent on this video's storyboard; omit for work not tied to a video. */
  videoSpent?: number;
  estimate: number;
  confirmed?: boolean;
}): AiSpendCheck {
  const { settings, estimate } = input;
  const budget = checkBudget(input.limits, input.spent, estimate);
  if (!budget.ok) return { ok: false, needsConfirm: false, message: budget.message };
  const cap = settings.per_video_cap_thb;
  if (estimate > 0 && cap !== null && input.videoSpent !== undefined && input.videoSpent + estimate > cap) {
    return {
      ok: false,
      needsConfirm: false,
      message: `เกินเพดานต่อวิดีโอ ${baht(cap)} (วิดีโอนี้ใช้ไปแล้ว ${baht(input.videoSpent)} งานนี้ประมาณ ${baht(estimate)}) — ปรับได้ที่หน้าตั้งค่า`,
    };
  }
  if (estimate > settings.confirm_over_thb && !input.confirmed) {
    return { ok: false, needsConfirm: true, message: `งานนี้ประมาณ ${baht(estimate)} (เกินเกณฑ์ยืนยัน ${baht(settings.confirm_over_thb)}) — ยืนยันก่อนเริ่ม` };
  }
  return { ok: true };
}
