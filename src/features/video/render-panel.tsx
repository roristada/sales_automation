"use client";

import { Clapperboard, RotateCcw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Notice } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cancelRender, queueRender } from "./actions";

export interface ActiveJob {
  id: string;
  status: "queued" | "processing";
  progress: number;
  stage: string | null;
  attempt: number;
  createdAt: string;
  errorMessage: string | null;
}

const STAGE: Record<string, string> = {
  claimed: "เริ่มงาน",
  loading: "โหลดสคริปต์และรูป",
  bundling: "เตรียมเทมเพลต",
  rendering: "กำลัง render",
  thumbnail: "ทำภาพปก",
  checking: "ตรวจคุณภาพไฟล์",
  saving: "บันทึกไฟล์",
};
/** A queued job nobody picked up after this long probably means the worker isn't running. */
const WORKER_HINT_AFTER_MS = 15_000;

/** Render / rerender / cancel, with live status (polls while a job is active). */
export function RenderPanel({ storyboardId, active, hasOutput }: { storyboardId: string; active: ActiveJob | null; hasOutput: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      setNow(Date.now());
      router.refresh();
    }, 2000);
    return () => clearInterval(t);
  }, [active, router]);

  const queue = () =>
    start(async () => {
      setError(null);
      const res = await queueRender(storyboardId).catch(() => ({ ok: false as const, error: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ" }));
      if (!res.ok) return setError(res.error);
      toast.success(res.data.existing ? "มีงาน render ของสคริปต์นี้อยู่แล้ว" : "เข้าคิว render แล้ว");
      router.refresh();
    });

  const cancel = () =>
    start(async () => {
      if (!active) return;
      const res = await cancelRender(active.id, storyboardId);
      if (!res.ok) return setError(res.error);
      toast.success("ยกเลิกแล้ว");
      router.refresh();
    });

  if (active) {
    const waiting = active.status === "queued" && now - Date.parse(active.createdAt) > WORKER_HINT_AFTER_MS;
    const pct = Math.round(active.progress * 100);
    return (
      <div className="flex flex-col gap-3" aria-live="polite">
        <p className="text-[13px] font-medium">
          {active.status === "queued" ? "รอคิว" : `${STAGE[active.stage ?? ""] ?? "กำลังทำงาน"} · ${pct}%`}
          {active.attempt > 1 && <span className="font-normal text-muted-foreground"> (ลองครั้งที่ {active.attempt})</span>}
        </p>
        <Progress value={active.status === "queued" ? 0 : pct} aria-label="ความคืบหน้าการ render" />
        {active.errorMessage && <p className="text-xs text-warning">ครั้งก่อนล้มเหลว: {active.errorMessage}</p>}
        {waiting && (
          <Notice tone="warning">
            ยังไม่มีตัว render รับงาน — เปิด terminal ในโฟลเดอร์โปรเจกต์แล้วรัน <code>npm run worker</code>
          </Notice>
        )}
        <Button variant="outline" onClick={cancel} disabled={pending}>
          <X aria-hidden /> ยกเลิก
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <Notice tone="error">{error}</Notice>}
      <Button onClick={queue} disabled={pending}>
        {hasOutput ? <RotateCcw aria-hidden /> : <Clapperboard aria-hidden />} {pending ? "กำลังเข้าคิว…" : hasOutput ? "Render ใหม่" : "Render วิดีโอ"}
      </Button>
      <p className="text-xs text-muted-foreground">MP4 1080×1920 30fps · ไม่มีเสียงพากย์ (ยังไม่ได้เชื่อมต่อ TTS) · มีซับไทยและไฟล์ SRT/VTT</p>
    </div>
  );
}
