import { clipSpec } from "@/features/ai/clips";
import { TASK_GROUP } from "@/features/analytics/costs";
import type { VideoStudioData } from "@/features/video/studio-data";

const baht = (n: number) => `฿${n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface VideoCost {
  /** Charged so far, by kind (what OpenRouter reported). */
  spent: { text: number; clips: number; voice: number };
  /** Clips queued or generating, at their estimate. */
  generating: number;
  /** AI scenes planned but without a clip yet, at the estimate for their model. */
  clipsToMake: number;
  /** Voice-over if the next render has it (cached lines are free). */
  voice: number;
}

/** What this video has cost and will cost, from its AI log and its plan. */
export function videoCost(d: VideoStudioData, calls: { task: string; cost_thb: number | string }[]): VideoCost {
  const spent = { text: 0, clips: 0, voice: 0 };
  for (const c of calls) spent[TASK_GROUP[c.task] ?? "text"] += Number(c.cost_thb);
  let generating = 0;
  let clipsToMake = 0;
  for (const s of d.clipScenes) {
    if (s.plan.mode !== "ai_video") continue;
    const flight = s.generations.filter((g) => g.status === "queued" || g.status === "generating");
    generating += flight.reduce((n, g) => n + g.estThb, 0);
    if (flight.length || s.generations.some((g) => g.reviewStatus === "approved")) continue;
    const choice = d.videoChoices[s.plan.video_task];
    const info = choice.models.find((m) => m.id === (s.plan.model ?? choice.defaultModel));
    if (info) clipsToMake += clipSpec(info, s.plan.duration_s, s.plan.video_task === "video_product" && d.hasFrame).estUsd * d.usdThb;
  }
  return { spent, generating, clipsToMake, voice: d.voiceOption?.estThb ?? 0 };
}

/** Spent so far, what's coming, and when money is actually charged. */
export function CostCard({ cost, cap }: { cost: VideoCost; cap: number | null }) {
  const spentTotal = cost.spent.text + cost.spent.clips + cost.spent.voice;
  const expected = spentTotal + cost.generating + cost.clipsToMake + cost.voice;
  const over = cap !== null && expected > cap;
  const rows: [string, number, string?][] = [
    ["ข้อความ (AI เขียน/วางแผน)", cost.spent.text],
    ["คลิป AI", cost.spent.clips],
    ["เสียงพากย์", cost.spent.voice],
  ];
  return (
    <section aria-labelledby="cost-h" className="rounded-lg border bg-surface p-3 text-[13px]">
      <h2 id="cost-h" className="mb-2 font-semibold">
        ค่าใช้จ่ายวิดีโอนี้
      </h2>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 tabular-nums">
        {rows.map(([label, n]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right">{baht(n)}</dd>
          </div>
        ))}
        <dt className="font-medium">จ่ายแล้ว</dt>
        <dd className="text-right font-medium">{baht(spentTotal)}</dd>
        {cost.generating > 0 && (
          <>
            <dt className="text-muted-foreground">กำลังสร้างคลิป</dt>
            <dd className="text-right">≈ {baht(cost.generating)}</dd>
          </>
        )}
        {cost.clipsToMake > 0 && (
          <>
            <dt className="text-muted-foreground">คลิปที่ยังไม่สร้าง</dt>
            <dd className="text-right">≈ {baht(cost.clipsToMake)}</dd>
          </>
        )}
        {cost.voice > 0 && (
          <>
            <dt className="text-muted-foreground">เสียงพากย์ (ถ้าใส่)</dt>
            <dd className="text-right">≈ {baht(cost.voice)}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Render</dt>
        <dd className="text-right">ฟรี</dd>
        <dt className="border-t pt-1 font-semibold">รวมทั้งวิดีโอ</dt>
        <dd className={over ? "border-t pt-1 text-right font-semibold text-destructive" : "border-t pt-1 text-right font-semibold"}>≈ {baht(expected)}</dd>
      </dl>
      <p className="mt-1 text-xs text-muted-foreground">{cap === null ? "ไม่จำกัดต่อวิดีโอ" : `เพดานต่อวิดีโอ ${baht(cap)}${over ? " — จะเกินเพดาน" : ""}`}</p>
      <details className="mt-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-primary">เสียเงินตอนไหน</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>AI เขียนสคริปต์/วางแผนภาพ — ทันทีที่กด (หลักสตางค์)</li>
          <li>คลิป AI — ตอนกดสร้างคลิป (หรือจัดภาพอัตโนมัติ) ไม่ใช่ตอน render · เสร็จในราว 1 นาที</li>
          <li>เสียงพากย์ — ตอน render ถ้าติ๊กใส่เสียง ประโยคเดิมไม่เสียซ้ำ</li>
          <li>Render — ฟรี (ทำบนเครื่องนี้)</li>
        </ul>
      </details>
    </section>
  );
}
