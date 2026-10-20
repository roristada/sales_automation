import { cn } from "@/lib/utils";
import { CONFIDENCE_LABEL, type Confidence } from "./opportunity-score";

const CONFIDENCE_TONE: Record<Confidence, string> = {
  high: "text-muted-foreground",
  medium: "text-muted-foreground",
  low: "text-warning",
};

/**
 * Compact score for lists: number + confidence in words (colour is never the only signal).
 * `computed` false = no stored score yet; `score` null = not enough real data to score.
 */
export function ScoreCell({ score, confidence, computed }: { score: number | null; confidence: Confidence | null; computed: boolean }) {
  if (!computed) return <span className="text-xs text-muted-foreground">ยังไม่คำนวณ</span>;
  if (score === null || confidence === null) return <span className="text-xs text-muted-foreground">ข้อมูลไม่พอ</span>;
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="font-medium tabular-nums">{score}</span>
      <span className={cn("text-[11px]", CONFIDENCE_TONE[confidence])}>{CONFIDENCE_LABEL[confidence]}</span>
    </span>
  );
}

/** Horizontal bar for a 0–100 component score. */
export function ScoreBar({ value, label }: { value: number; label: string }) {
  return (
    <div role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label={label} className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
      <div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
    </div>
  );
}
