"use client";

import { Clapperboard, Play, RotateCcw, Square } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Notice } from "@/components/shared/states";
import { StatusBadge, type WorkflowStatus } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { renderBatch, runBatchItem } from "./batch-actions";
import { BATCH_STATUS_LABEL, type BatchItemStatus, runnableItems } from "./batch";

export interface BatchRow {
  id: string;
  productName: string;
  status: BatchItemStatus;
  error: string | null;
  costThb: number;
  storyboardId: string | null;
  /** draft / approved; null before drafting. */
  scriptStatus: string | null;
  /** Latest render: queued / processing / completed / failed / canceled; null for none. */
  renderStatus: string | null;
}

const BADGE: Record<BatchItemStatus, WorkflowStatus> = { pending: "queued", working: "processing", drafted: "draft", written: "draft", failed: "failed" };
const RENDER_LABEL: Record<string, string> = { queued: "รอ render", processing: "กำลัง render", completed: "render แล้ว", failed: "render ล้มเหลว", canceled: "ยกเลิก render" };
const baht = (n: number) => `฿${n.toLocaleString("th-TH", { maximumFractionDigits: 4 })}`;

/** Runs a batch one item at a time (so progress shows and a failure stays with its product). */
export function BatchRunner({ batchId, useAi, rows, autoStart, voiceAvailable }: { batchId: string; useAi: boolean; rows: BatchRow[]; autoStart: boolean; voiceAvailable: boolean }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ tone: "error" | "warning" | "success"; text: string } | null>(null);
  const [voice, setVoice] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const stop = useRef(false);
  const started = useRef(false);

  const run = async (includeFailed: boolean) => {
    const todo = runnableItems(rows, useAi, includeFailed);
    if (!todo.length) return;
    stop.current = false;
    setRunning(true);
    setNotice(null);
    for (const item of todo) {
      if (stop.current) break;
      setCurrent(item.id);
      const res = await runBatchItem(item.id).catch(() => ({ ok: false as const, error: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ" }));
      if (!res.ok) setNotice({ tone: "warning", text: `${item.productName}: ${res.error}` });
      router.refresh();
    }
    setCurrent(null);
    setRunning(false);
    router.refresh();
  };

  useEffect(() => {
    if (autoStart && !started.current) {
      started.current = true;
      void run(false);
    }
    // Only on first mount, from "สร้าง … วิดีโอ".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const render = (confirmed = false) =>
    start(async () => {
      setConfirm(null);
      const res = await renderBatch(batchId, { voice, confirmed }).catch(() => ({ ok: false as const, error: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ" }));
      if (!res.ok) return "needsConfirm" in res ? setConfirm(res.error) : setNotice({ tone: "error", text: res.error });
      const { queued, errors } = res.data;
      if (queued) toast.success(`เข้าคิว render ${queued} วิดีโอ`);
      setNotice(errors.length ? { tone: "warning", text: errors.join(" · ") } : queued ? null : { tone: "warning", text: "ยังไม่มีสคริปต์ที่อนุมัติแล้วและยังไม่ได้ render" });
      router.refresh();
    });

  const left = runnableItems(rows, useAi, false).length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const approved = rows.filter((r) => r.scriptStatus === "approved").length;
  const total = rows.reduce((n, r) => n + r.costThb, 0);

  return (
    <div className="flex flex-col gap-4">
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <Button variant="outline" onClick={() => (stop.current = true)}>
            <Square aria-hidden /> หยุดหลังงานนี้
          </Button>
        ) : (
          <>
            <Button onClick={() => void run(false)} disabled={!left}>
              <Play aria-hidden /> {left ? `ทำต่อ (${left} งาน)` : "ทำครบทุกงานแล้ว"}
            </Button>
            {failed > 0 && (
              <Button variant="outline" onClick={() => void run(true)}>
                <RotateCcw aria-hidden /> ลองงานที่ไม่สำเร็จอีกครั้ง ({failed})
              </Button>
            )}
          </>
        )}
        <span className="text-[13px] text-muted-foreground">
          อนุมัติแล้ว {approved}/{rows.length} · ค่า AI ชุดนี้ {baht(total)}
        </span>
      </div>

      <ol className="divide-y rounded-lg border bg-surface text-[13px]" aria-label="งานในชุด">
        {rows.map((r, i) => (
          <li key={r.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="font-medium break-words">
                {i + 1}. {r.productName}
              </p>
              <p className="text-xs text-muted-foreground">
                {r.scriptStatus === "approved" ? "สคริปต์อนุมัติแล้ว" : r.storyboardId ? "รอตรวจ claim และอนุมัติ" : "ยังไม่ได้สร้างสคริปต์"}
                {r.renderStatus && ` · ${RENDER_LABEL[r.renderStatus] ?? r.renderStatus}`}
                {r.costThb > 0 && ` · ${baht(r.costThb)}`}
              </p>
              {r.error && <p className={r.status === "failed" ? "text-xs text-destructive" : "text-xs text-warning"}>{r.error}</p>}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <StatusBadge status={current === r.id ? "processing" : BADGE[r.status]} label={current === r.id ? "กำลังทำ" : BATCH_STATUS_LABEL[r.status]} />
              {r.storyboardId && (
                <Button asChild size="sm" variant="outline">
                  <Link href={`/workspace/${r.storyboardId}`}>{r.scriptStatus === "approved" ? "ทำวิดีโอต่อ" : "ตรวจและอนุมัติ"}</Link>
                </Button>
              )}
            </div>
          </li>
        ))}
      </ol>

      <section aria-labelledby="batch-render-h" className="flex flex-col gap-2 rounded-lg border bg-surface px-4 py-3">
        <h2 id="batch-render-h" className="text-[13px] font-semibold">
          Render ทุกงานที่อนุมัติแล้ว
        </h2>
        <p className="text-xs text-muted-foreground">เฉพาะสคริปต์ที่อนุมัติแล้วและยังไม่เคย render · ฉากที่ตั้งเป็นคลิป AI ต้องมีคลิปที่อนุมัติก่อน (สร้างใน Video Studio ของแต่ละงาน)</p>
        {voiceAvailable && (
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} className="accent-primary" /> ใส่เสียงพากย์ AI
          </label>
        )}
        {confirm && (
          <Notice tone="warning">
            {confirm}
            <Button size="sm" className="mt-2" onClick={() => render(true)} disabled={pending}>
              ยืนยันและ render
            </Button>
          </Notice>
        )}
        <Button variant="outline" className="self-start" onClick={() => render()} disabled={pending || running || !approved}>
          <Clapperboard aria-hidden /> {pending ? "กำลังเข้าคิว…" : `Render (${approved} งานที่อนุมัติ)`}
        </Button>
      </section>
    </div>
  );
}
