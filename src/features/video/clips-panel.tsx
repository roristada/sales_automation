"use client";

import { Check, Clapperboard, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { NativeSelect } from "@/components/shared/field";
import { Notice } from "@/components/shared/states";
import { Chip } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { VideoModel } from "@/features/ai/openrouter";
import { AI_CLIP_LABEL, clipSpec, GENERATION_STATUS_LABEL, MAX_PROMPT_CHARS, VIDEO_TASK_LABEL, VIDEO_TASKS, type VideoTask, VISUAL_MODE_LABEL, VISUAL_MODES, type VisualMode } from "@/features/ai/clips";
import { TRANSITION_LABEL, type TransitionChoice, TRANSITIONS } from "./timeline";
import { cancelSceneClip, planSceneVisuals, queueSceneClip, reuseSceneClip, reviewSceneClip, saveScenePlan } from "./clip-actions";

export interface ClipGeneration {
  id: string;
  status: string;
  reviewStatus: string;
  model: string;
  durationS: number;
  assetId: string | null;
  costThb: number | null;
  estThb: number;
  error: string | null;
  /** Worker's check of the clip's shape (not 9:16, black bars); null = fills the frame. */
  qualityNote: string | null;
  createdAt: string;
}

export interface ClipScene {
  id: string;
  n: number;
  kindLabel: string;
  narration: string;
  /** `model`: this scene's pick; null = the model set for its task in Settings. */
  plan: { mode: VisualMode; video_task: VideoTask; prompt: string; duration_s: number; transition: TransitionChoice; model: string | null };
  generations: ClipGeneration[];
}

/** Video models a scene can pick per task, and the one Settings uses. */
export type VideoChoices = Record<VideoTask, { defaultModel: string; models: (Pick<VideoModel, "id" | "name" | "durations" | "resolutions" | "pricing">)[] }>;

/** An approved clip of the same product in another script (version), reusable for free (AI-6). */
export interface ReusableClip {
  id: string;
  label: string;
}

const thb = (n: number) => `฿${n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const TONE: Record<string, "neutral" | "info" | "success" | "danger" | "warning"> = { queued: "neutral", generating: "info", succeeded: "warning", failed: "danger", canceled: "neutral" };

/**
 * AI clips per scene (docs/AI_VIDEO_PLAN.md AI-3): plan each scene (motion graphics or an AI clip
 * and its prompt), generate or regenerate one scene at a time, watch the result, approve or reject.
 */
export function ClipsPanel({
  storyboardId,
  scenes,
  aiReady,
  approved,
  reusable = [],
  choices,
  usdThb,
  hasFrame,
}: {
  storyboardId: string;
  scenes: ClipScene[];
  aiReady: boolean;
  approved: boolean;
  reusable?: ReusableClip[];
  choices: VideoChoices;
  usdThb: number;
  /** The product has a photo URL to use as the first frame. */
  hasFrame: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const busy = scenes.some((s) => s.generations.some((g) => g.status === "queued" || g.status === "generating"));

  // Clips take ~30 s to several minutes: refresh while any is in flight.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(t);
  }, [busy, router]);

  const plan = () =>
    start(async () => {
      setError(null);
      const res = await planSceneVisuals(storyboardId).catch(() => ({ ok: false as const, error: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ" }));
      if (!res.ok) return setError(res.error);
      toast.success(`วางแผนภาพแล้ว — คลิป AI ${res.data.aiScenes} ฉาก · ค่าใช้จ่าย ฿${res.data.costThb.toFixed(4)}`);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-4">
      {/* Transitions are free and work without AI; only the AI buttons need the key. */}
      {!aiReady && <Notice tone="info">ยังไม่ได้ตั้งค่า AI ผ่าน OpenRouter — ใส่ OPENROUTER_API_KEY ใน .env.local เพื่อสร้างคลิป AI ต่อฉาก (ตอนนี้วิดีโอใช้ภาพสินค้า + motion graphics) · ทรานซิชันตั้งได้เลย</Notice>}
      <div className={aiReady ? "flex flex-wrap items-center gap-3" : "hidden"}>
        <Button type="button" variant="outline" onClick={plan} disabled={pending}>
          <Sparkles aria-hidden /> {pending ? "AI กำลังวางแผน…" : "ให้ AI วางแผนภาพทุกฉาก"}
        </Button>
        <p className="text-xs text-muted-foreground">AI เลือกว่าฉากไหนควรเป็นคลิป AI และเขียน prompt ภาษาอังกฤษจากข้อเท็จจริงที่ยืนยันแล้ว (ไม่ถึง ฿0.10) — แก้เองได้ทุกฉาก</p>
      </div>
      {!approved && <Notice tone="warning">อนุมัติสคริปต์ก่อน จึงจะสร้างคลิป AI ได้ (วางแผนภาพไว้ก่อนได้)</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <ol className="flex flex-col gap-3">
        {scenes.map((s) => (
          <SceneClip key={`${s.id}-${s.plan.mode}-${s.plan.video_task}-${s.plan.prompt.length}-${s.plan.duration_s}-${s.plan.transition}-${s.plan.model ?? ""}`} scene={s} approved={approved} reusable={reusable} choices={choices} usdThb={usdThb} hasFrame={hasFrame} />
        ))}
      </ol>
    </div>
  );
}

function SceneClip({ scene, approved, reusable, choices, usdThb, hasFrame }: { scene: ClipScene; approved: boolean; reusable: ReusableClip[]; choices: VideoChoices; usdThb: number; hasFrame: boolean }) {
  const router = useRouter();
  const [v, setV] = useState(scene.plan);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [reuseId, setReuseId] = useState(reusable[0]?.id ?? "");
  const dirty = v.mode !== scene.plan.mode || v.video_task !== scene.plan.video_task || v.prompt !== scene.plan.prompt || v.duration_s !== scene.plan.duration_s || v.transition !== scene.plan.transition || v.model !== scene.plan.model;
  const latest = scene.generations[0];
  const inFlight = latest && (latest.status === "queued" || latest.status === "generating");
  const chosen = scene.generations.find((g) => g.reviewStatus === "approved");
  const choice = choices[v.video_task];
  const modelId = v.model ?? choice.defaultModel;
  const info = choice.models.find((m) => m.id === modelId);
  const spec = v.mode === "ai_video" && info ? clipSpec(info, v.duration_s, v.video_task === "video_product" && hasFrame) : null;
  const est = spec ? { model: modelId, seconds: spec.duration, thb: Math.round(spec.estUsd * usdThb * 100) / 100, priced: spec.priced } : null;
  const id = (k: string) => `clip-${scene.id}-${k}`;

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) =>
    start(async () => {
      setError(null);
      const res = await fn().catch(() => ({ ok: false, error: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ" }));
      if (!res.ok) return setError(res.error ?? "ไม่สำเร็จ");
      if (done) toast.success(done);
      router.refresh();
    });

  const generate = (confirmed = false) =>
    start(async () => {
      setError(null);
      setConfirm(null);
      const res = await queueSceneClip(scene.id, confirmed).catch(() => ({ ok: false as const, error: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ" }));
      if (!res.ok) {
        if ("needsConfirm" in res && res.needsConfirm) setConfirm(res.error);
        else setError(res.error);
        return;
      }
      toast.success(`เข้าคิวสร้างคลิปแล้ว (ประมาณ ${thb(res.data.estThb)}) — ต้องเปิด npm run worker ไว้`);
      router.refresh();
    });

  return (
    <li className="rounded-lg border bg-surface" aria-labelledby={id("h")}>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <h3 id={id("h")} className="font-semibold">
          ฉากที่ {scene.n}
        </h3>
        <span className="text-[13px] text-muted-foreground">{scene.kindLabel}</span>
        {chosen ? <Chip tone="success">ใช้คลิป AI ที่อนุมัติแล้ว</Chip> : v.mode === "ai_video" ? <Chip tone="neutral">ยังไม่มีคลิปที่อนุมัติ</Chip> : null}
      </div>
      <div className="flex flex-col gap-3 p-4 text-[13px]">
        <p className="line-clamp-2 text-muted-foreground">“{scene.narration || "—"}”</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={id("mode")}>ภาพของฉากนี้</Label>
            <NativeSelect id={id("mode")} value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value as VisualMode })}>
              {VISUAL_MODES.map((m) => (
                <option key={m} value={m}>
                  {VISUAL_MODE_LABEL[m]}
                </option>
              ))}
            </NativeSelect>
          </div>
          {scene.n > 1 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={id("transition")}>ทรานซิชันเข้าฉากนี้</Label>
              <NativeSelect id={id("transition")} value={v.transition} onChange={(e) => setV({ ...v, transition: e.target.value as TransitionChoice })}>
                {TRANSITIONS.map((t) => (
                  <option key={t} value={t}>
                    {TRANSITION_LABEL[t]}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          {v.mode === "ai_video" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={id("task")}>แบบคลิป</Label>
              <NativeSelect id={id("task")} value={v.video_task} onChange={(e) => setV({ ...v, video_task: e.target.value as VideoTask })}>
                {VIDEO_TASKS.map((t) => (
                  <option key={t} value={t}>
                    {VIDEO_TASK_LABEL[t]}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
        </div>
        {v.mode === "ai_video" && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={id("model")}>โมเดลวิดีโอ</Label>
              <NativeSelect id={id("model")} value={v.model ?? ""} onChange={(e) => setV({ ...v, model: e.target.value || null })} className="max-w-full">
                <option value="">ตามหน้าตั้งค่า ({choice.defaultModel})</option>
                {choice.models
                  .filter((m) => m.id !== choice.defaultModel || v.model === m.id)
                  .map((m) => {
                    const s = clipSpec(m, v.duration_s, v.video_task === "video_product" && hasFrame);
                    return (
                      <option key={m.id} value={m.id}>
                        {m.name} · {s.duration} วิ ≈ {thb(s.estUsd * usdThb)}
                        {s.priced ? "" : " (ประมาณแบบเผื่อ)"}
                      </option>
                    );
                  })}
                {v.model && !choice.models.some((m) => m.id === v.model) && <option value={v.model}>{v.model} (ไม่พบใน catalog)</option>}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={id("prompt")}>Prompt (ภาษาอังกฤษ)</Label>
              <Textarea id={id("prompt")} rows={3} maxLength={MAX_PROMPT_CHARS} value={v.prompt} onChange={(e) => setV({ ...v, prompt: e.target.value })} placeholder="e.g. Slow 360° rotation of the earbuds on a white marble surface, soft studio light, shallow depth of field" />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={id("dur")}>ความยาว (วินาที)</Label>
                <Input id={id("dur")} type="number" min={1} max={20} className="w-24" value={v.duration_s} onChange={(e) => setV({ ...v, duration_s: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })} />
              </div>
              <p className="pb-2 text-xs text-muted-foreground">
                {est ? `${est.model} · ${est.seconds} วิ · ประมาณ ${thb(est.thb)}${est.priced ? "" : " (ราคาตาม token — ประมาณแบบเผื่อ)"}${dirty ? " — บันทึกแผนภาพก่อนกดสร้าง" : ""}` : "ไม่พบโมเดลใน catalog — เลือกรุ่นอื่น"}
              </p>
            </div>
          </>
        )}
        <div className="flex flex-wrap gap-2">
          {dirty && (
            <Button type="button" size="sm" disabled={pending} onClick={() => act(() => saveScenePlan(scene.id, v), "บันทึกแผนภาพแล้ว")}>
              บันทึกแผนภาพ
            </Button>
          )}
          {v.mode === "ai_video" && !dirty && approved && !inFlight && (
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => generate()}>
              <Clapperboard aria-hidden /> {scene.generations.length ? "สร้างใหม่เฉพาะฉากนี้" : "สร้างคลิป AI"}
            </Button>
          )}
          {inFlight && (
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => act(() => cancelSceneClip(latest.id), "ยกเลิกแล้ว")}>
              ยกเลิก
            </Button>
          )}
        </div>
        {v.mode === "ai_video" && !dirty && approved && !inFlight && reusable.length > 0 && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor={id("reuse")}>หรือใช้คลิปที่อนุมัติแล้วของสินค้านี้ (ฟรี)</Label>
              <NativeSelect id={id("reuse")} value={reuseId} onChange={(e) => setReuseId(e.target.value)} className="max-w-full">
                {reusable.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button type="button" size="sm" variant="outline" disabled={pending || !reuseId} onClick={() => act(() => reuseSceneClip(scene.id, reuseId), `ใช้คลิปเดิมในฉากที่ ${scene.n} แล้ว`)}>
              ใช้คลิปนี้ซ้ำ
            </Button>
          </div>
        )}
        {confirm && (
          <Notice tone="warning">
            {confirm}{" "}
            <Button size="sm" variant="outline" onClick={() => generate(true)} disabled={pending}>
              ยืนยันและสร้าง
            </Button>
          </Notice>
        )}
        {error && <Notice tone="error">{error}</Notice>}

        {scene.generations.length > 0 && (
          <ul className="flex flex-col gap-3" aria-label={`คลิปของฉากที่ ${scene.n}`}>
            {scene.generations.map((g) => (
              <li key={g.id} className="flex flex-col gap-2 rounded-md border bg-surface-muted p-3 sm:flex-row sm:items-start">
                {g.assetId && g.status === "succeeded" && (
                  <figure className="w-full max-w-[160px] shrink-0">
                    <video controls muted preload="metadata" className="aspect-[9/16] w-full rounded bg-black" src={`/api/assets/${g.assetId}`} />
                    <figcaption className="mt-1 text-[11px] text-warning">{AI_CLIP_LABEL}</figcaption>
                  </figure>
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone={g.reviewStatus === "approved" ? "success" : g.reviewStatus === "rejected" ? "danger" : TONE[g.status]}>
                      {g.reviewStatus === "approved" ? "อนุมัติแล้ว" : g.reviewStatus === "rejected" ? "ไม่ผ่าน" : GENERATION_STATUS_LABEL[g.status]}
                    </Chip>
                    <span className="text-xs break-all text-muted-foreground">
                      {g.model} · {g.durationS} วิ · {g.costThb !== null ? `จริง ${thb(g.costThb)}` : `ประมาณ ${thb(g.estThb)}`}
                    </span>
                  </div>
                  {g.status === "failed" && g.error && <p className="text-xs text-destructive">{g.error}</p>}
                  {g.status === "succeeded" && g.qualityNote && <p className="text-xs text-warning">{g.qualityNote}</p>}
                  {g.status === "generating" && <p className="text-xs text-muted-foreground">ปกติใช้ 30 วินาที ถึงหลายนาที หน้านี้อัปเดตเอง</p>}
                  {g.status === "succeeded" && (
                    <div className="flex flex-wrap gap-2">
                      {g.reviewStatus !== "approved" && (
                        <Button type="button" size="sm" disabled={pending} onClick={() => act(() => reviewSceneClip(g.id, "approved"), `ใช้คลิปนี้ในฉากที่ ${scene.n}`)}>
                          <Check aria-hidden /> ใช้คลิปนี้
                        </Button>
                      )}
                      {g.reviewStatus !== "rejected" && (
                        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => act(() => reviewSceneClip(g.id, "rejected"), "ทำเครื่องหมายไม่ผ่านแล้ว")}>
                          <X aria-hidden /> ไม่ผ่าน (สินค้าเพี้ยน/ไม่ตรง)
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}
