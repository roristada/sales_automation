"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { NativeSelect } from "@/components/shared/field";
import { Notice } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VISUAL_LEVEL, type VisualLevel, VISUAL_LEVELS } from "@/features/ai/clips";
import { saveVideoSettings } from "@/features/content/workspace-actions";
import { DURATIONS } from "@/features/content/templates";
import { cn } from "@/lib/utils";

export interface SettingChoice {
  task: string;
  label: string;
  /** The Settings default, shown as the first option. */
  defaultModel: string;
  /** This video's pick; "" = the default. */
  value: string;
  options: { id: string; label: string }[];
}

/** This video's AI picks over the Settings defaults (all its script versions). */
export function VideoSettings({
  projectId,
  choices,
  voice,
  voiceDefault,
  visualLevel,
  targetSeconds,
  aiReady,
}: {
  projectId: string;
  choices: SettingChoice[];
  voice: string;
  voiceDefault: string;
  visualLevel: VisualLevel;
  targetSeconds: number;
  aiReady: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState(() => Object.fromEntries(choices.map((c) => [c.task, c.value])) as Record<string, string>);
  const [voiceName, setVoiceName] = useState(voice);
  const [level, setLevel] = useState<VisualLevel>(visualLevel);
  const [seconds, setSeconds] = useState(targetSeconds);
  const dirty = choices.some((c) => values[c.task] !== c.value) || voiceName !== voice || level !== visualLevel || seconds !== targetSeconds;

  const save = () =>
    start(async () => {
      setError(null);
      const res = await saveVideoSettings(projectId, { models: values, ttsVoice: voiceName, visualLevel: level, targetSeconds: seconds }).catch(() => ({ ok: false as const, error: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ" }));
      if (!res.ok) return setError(res.error);
      toast.success("บันทึกการตั้งค่าของวิดีโอนี้แล้ว");
      router.refresh();
    });

  if (!aiReady) return <Notice tone="info">ยังไม่ได้ตั้งค่า AI (OPENROUTER_API_KEY) — วิดีโอนี้ใช้ template และภาพสินค้าได้ตามปกติ</Notice>;
  return (
    <div className="flex flex-col gap-3">
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap items-end gap-3 text-[13px]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="vs-length">ความยาวเป้าหมาย</Label>
          <NativeSelect id="vs-length" value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} className="w-36">
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {d} วินาที
              </option>
            ))}
          </NativeSelect>
        </div>
        <p className="pb-2 text-xs text-muted-foreground">ใช้กำหนดความยาวที่ AI เขียน และเตือนเมื่อคลิปยาวเกิน · จำนวนฉากไม่เปลี่ยนตาม — ให้ AI เขียนสคริปต์ใหม่หลังเปลี่ยน</p>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-medium">ระดับภาพ (คลิป AI)</legend>
        <div role="radiogroup" aria-label="ระดับภาพ" className="grid gap-2 sm:grid-cols-3">
          {VISUAL_LEVELS.map((l) => (
            <label key={l} className={cn("flex cursor-pointer items-start gap-2 rounded-lg border bg-surface px-3 py-2 text-[13px]", level === l && "border-primary bg-primary-subtle")}>
              <input type="radio" name="visual_level" value={l} checked={level === l} onChange={() => setLevel(l)} className="mt-1 accent-primary" />
              <span>
                <span className="block font-medium">{VISUAL_LEVEL[l].label}</span>
                <span className="block text-xs text-muted-foreground">{VISUAL_LEVEL[l].hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {choices.map((c) => (
          <div key={c.task} className="flex min-w-0 flex-col gap-1.5 text-[13px]">
            <Label htmlFor={`vs-${c.task}`}>{c.label}</Label>
            <NativeSelect id={`vs-${c.task}`} value={values[c.task]} onChange={(e) => setValues({ ...values, [c.task]: e.target.value })} className="w-full min-w-0">
              <option value="">ค่าเริ่มต้น ({c.defaultModel})</option>
              {c.options
                .filter((o) => o.id !== c.defaultModel)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              {values[c.task] && !c.options.some((o) => o.id === values[c.task]) && <option value={values[c.task]}>{values[c.task]} (ไม่พบใน catalog)</option>}
            </NativeSelect>
          </div>
        ))}
        <div className="flex min-w-0 flex-col gap-1.5 text-[13px]">
          <Label htmlFor="vs-voice">ชื่อเสียงพากย์</Label>
          <Input id="vs-voice" value={voiceName} onChange={(e) => setVoiceName(e.target.value)} placeholder={`ค่าเริ่มต้น (${voiceDefault})`} autoComplete="off" spellCheck={false} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" onClick={save} disabled={pending || !dirty}>
          {pending ? "กำลังบันทึก…" : "บันทึกการตั้งค่าของวิดีโอนี้"}
        </Button>
        <p className="text-xs text-muted-foreground">ใช้กับวิดีโอนี้ทุกเวอร์ชัน · ค่าเริ่มต้นมาจากหน้าตั้งค่า · โมเดลต่อฉากเลือกแยกได้อีกในแต่ละฉาก</p>
      </div>
    </div>
  );
}
