"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { NativeSelect } from "@/components/shared/field";
import { Notice } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveVideoSettings } from "@/features/content/workspace-actions";

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
export function VideoSettings({ projectId, choices, voice, voiceDefault, aiReady }: { projectId: string; choices: SettingChoice[]; voice: string; voiceDefault: string; aiReady: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState(() => Object.fromEntries(choices.map((c) => [c.task, c.value])) as Record<string, string>);
  const [voiceName, setVoiceName] = useState(voice);
  const dirty = choices.some((c) => values[c.task] !== c.value) || voiceName !== voice;

  const save = () =>
    start(async () => {
      setError(null);
      const res = await saveVideoSettings(projectId, { models: values, ttsVoice: voiceName }).catch(() => ({ ok: false as const, error: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ" }));
      if (!res.ok) return setError(res.error);
      toast.success("บันทึกการตั้งค่าของวิดีโอนี้แล้ว");
      router.refresh();
    });

  if (!aiReady) return <Notice tone="info">ยังไม่ได้ตั้งค่า AI (OPENROUTER_API_KEY) — วิดีโอนี้ใช้ template และภาพสินค้าได้ตามปกติ</Notice>;
  return (
    <div className="flex flex-col gap-3">
      {error && <Notice tone="error">{error}</Notice>}
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
