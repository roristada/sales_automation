/** Batch rules shared by the actions and the page (AI-6). */

export const MAX_BATCH_PRODUCTS = 10;

/** A "working" item untouched this long is treated as abandoned (tab closed mid-run). */
export const STALE_WORK_MS = 5 * 60_000;

export type BatchItemStatus = "pending" | "working" | "drafted" | "written" | "failed";

export const BATCH_STATUS_LABEL: Record<BatchItemStatus, string> = {
  pending: "รอทำ",
  working: "กำลังทำ",
  drafted: "ร่างจาก template แล้ว",
  written: "AI เขียนแล้ว",
  failed: "ไม่สำเร็จ",
};

/** THB left of a batch's AI budget; null = no batch budget. */
export function batchBudgetLeft(budget: number | null, itemCosts: number[]): number | null {
  if (budget === null) return null;
  return Math.round((budget - itemCosts.reduce((n, c) => n + c, 0)) * 10_000) / 10_000;
}

/**
 * Items a run should process, in order: not started; drafted but not yet written by AI (unless
 * it stopped there for a reason, e.g. the budget); and failed ones when retrying.
 */
export function runnableItems<T extends { id: string; status: string; error: string | null }>(items: T[], useAi: boolean, includeFailed: boolean): T[] {
  return items.filter((i) => i.status === "pending" || (useAi && i.status === "drafted" && !i.error) || (includeFailed && i.status === "failed"));
}
