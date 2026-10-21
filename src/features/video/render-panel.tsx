"use client";

import { Clapperboard, RotateCcw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { NativeSelect } from "@/components/shared/field";
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

export interface VoiceOption {
  /** "google/gemini-3.8-flash-tts · เสียง Kore" */
  label: string;
  /** Estimate if no line is cached yet. */
  estThb: number;
  /** The last render had a voice-over: start with the box ticked. */
  lastUsed: boolean;
}

export interface MusicOption {
  id: string;
  name: string;
  durationS: number | null;
  level: "ok" | "warn" | "block";
  message: string;
}

const STAGE: Record<string, string> = {
  claimed: "เริ่มงาน",
  loading: "โหลดสคริปต์และรูป",
  voice: "สร้างเสียงพากย์",
  bundling: "เตรียมเทมเพลต",
  rendering: "กำลัง render",
  thumbnail: "ทำภาพปก",
  checking: "ตรวจคุณภาพไฟล์",
  saving: "บันทึกไฟล์",
};
/** Without a heartbeat answer: a queued job nobody picked up after this long probably means no worker. */
const WORKER_HINT_AFTER_MS = 15_000;

/** Render / rerender / cancel, with live status (polls while a job is active). */
export function RenderPanel({
  storyboardId,
  active,
  hasOutput,
  workerOnline,
  voice = null,
  music = [],
  lastMusicId = null,
}: {
  storyboardId: string;
  active: ActiveJob | null;
  hasOutput: boolean;
  workerOnline: boolean | null;
  /** Null when OpenRouter isn't set up. */
  voice?: VoiceOption | null;
  music?: MusicOption[];
  lastMusicId?: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [withVoice, setWithVoice] = useState(!!voice?.lastUsed);
  const [musicId, setMusicId] = useState(lastMusicId ?? "");
  const track = music.find((m) => m.id === musicId);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      setNow(Date.now());
      router.refresh();
    }, 2000);
    return () => clearInterval(t);
  }, [active, router]);

  const queue = (confirmed = false) =>
    start(async () => {
      setError(null);
      setConfirm(null);
      const res = await queueRender(storyboardId, { voice: withVoice && !!voice, musicAssetId: musicId || null, confirmed }).catch(() => ({ ok: false as const, error: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ" }));
      if (!res.ok) return "needsConfirm" in res ? setConfirm(res.error) : setError(res.error);
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
    const waiting = active.status === "queued" && (workerOnline === null ? now - Date.parse(active.createdAt) > WORKER_HINT_AFTER_MS : !workerOnline);
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
      <fieldset className="flex flex-col gap-2 text-[13px]">
        <legend className="sr-only">ตัวเลือกเสียง</legend>
        {voice ? (
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={withVoice} onChange={(e) => setWithVoice(e.target.checked)} className="mt-0.5 accent-primary" />
            <span>
              ใส่เสียงพากย์ AI
              <span className="block text-xs text-muted-foreground">
                {voice.label} · ประมาณ ฿{voice.estThb.toLocaleString("th-TH", { maximumFractionDigits: 2 })} (ประโยคที่เคยสร้างแล้วใช้ซ้ำฟรี)
              </span>
            </span>
          </label>
        ) : (
          <p className="text-xs text-muted-foreground">เสียงพากย์ AI: ตั้ง OPENROUTER_API_KEY ก่อน</p>
        )}
        <label className="flex flex-col gap-1">
          <span>เพลงประกอบ</span>
          <NativeSelect value={musicId} onChange={(e) => setMusicId(e.target.value)} className="w-full" aria-label="เพลงประกอบ">
            <option value="">ไม่มีเพลง</option>
            {music.map((m) => (
              <option key={m.id} value={m.id} disabled={m.level === "block"}>
                {m.name}
                {m.durationS ? ` (${Math.round(m.durationS)} วิ)` : ""}
                {m.level === "block" ? " — ห้ามใช้เชิงพาณิชย์" : m.level === "warn" ? " — ตรวจสิทธิ์" : ""}
              </option>
            ))}
          </NativeSelect>
          {track && track.level !== "ok" && <span className="text-xs text-warning">{track.message}</span>}
          {!music.length && <span className="text-xs text-muted-foreground">อัปโหลดเพลงที่มีสิทธิ์ใช้เชิงพาณิชย์ในคลังไฟล์ก่อน</span>}
        </label>
      </fieldset>
      {confirm && (
        <Notice tone="warning">
          {confirm}
          <Button size="sm" className="mt-2" onClick={() => queue(true)} disabled={pending}>
            ยืนยันและ render
          </Button>
        </Notice>
      )}
      <Button onClick={() => queue()} disabled={pending}>
        {hasOutput ? <RotateCcw aria-hidden /> : <Clapperboard aria-hidden />} {pending ? "กำลังเข้าคิว…" : hasOutput ? "Render ใหม่" : "Render วิดีโอ"}
      </Button>
      <p className="text-xs text-muted-foreground">
        MP4 1080×1920 30fps · {withVoice && voice ? "เสียงพากย์ AI จังหวะตามความยาวเสียงจริง" : "ไม่มีเสียงพากย์"}
        {track ? " · มีเพลงประกอบ" : ""} · มีซับไทยและไฟล์ SRT/VTT
      </p>
    </div>
  );
}
