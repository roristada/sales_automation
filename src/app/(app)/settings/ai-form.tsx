"use client";

import { useActionState, useState, useTransition } from "react";
import { Field, NativeSelect } from "@/components/shared/field";
import { Notice } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type AiSettingsState, saveAiSettings, testOpenRouter, type TestAiResult } from "./actions";

export interface TaskChoice {
  task: string;
  label: string;
  hint: string;
  current: string;
  /** The current pick isn't in the live catalog any more. */
  missing: boolean;
  options: { id: string; label: string }[];
}

export function AiSettingsForm({ tasks, perVideoCap, confirmOver, catalogError }: { tasks: TaskChoice[]; perVideoCap: number | null; confirmOver: number; catalogError?: string }) {
  const [state, action, pending] = useActionState<AiSettingsState, FormData>(saveAiSettings, {});
  return (
    <form action={action} className="flex max-w-2xl flex-col gap-4" noValidate>
      {state.error && <Notice tone="error">{state.error}</Notice>}
      {catalogError && <Notice tone="warning">{catalogError} — แสดงเฉพาะโมเดลที่เลือกไว้</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        {tasks.map((t) => (
          <Field key={t.task} id={`model_${t.task}`} label={t.label} hint={t.missing ? undefined : t.hint} error={t.missing ? `ไม่พบ ${t.current} ใน catalog ตอนนี้ — อาจถูกปิดแล้ว เลือกรุ่นใหม่` : undefined}>
            {(a) => (
              <NativeSelect {...a} name={`model_${t.task}`} defaultValue={t.current} className="w-full min-w-0">
                {t.missing && <option value={t.current}>{t.current} (ไม่พบใน catalog)</option>}
                {t.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        ))}
      </div>
      <div className="grid max-w-md gap-4 sm:grid-cols-2">
        <Field id="per_video_cap_thb" label="เพดานต่อวิดีโอ (บาท)" optional hint="เว้นว่าง = ไม่จำกัด" error={state.fieldErrors?.per_video_cap_thb}>
          {(a) => <Input {...a} name="per_video_cap_thb" type="number" inputMode="decimal" min={0} step="any" defaultValue={perVideoCap ?? ""} />}
        </Field>
        <Field id="confirm_over_thb" label="ยืนยันก่อนเมื่องานเดียวเกิน (บาท)" error={state.fieldErrors?.confirm_over_thb}>
          {(a) => <Input {...a} name="confirm_over_thb" type="number" inputMode="decimal" min={0} step="any" defaultValue={confirmOver} />}
        </Field>
      </div>
      {state.message && <Notice tone="success">{state.message}</Notice>}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "กำลังบันทึก…" : "บันทึกการตั้งค่า AI"}
      </Button>
    </form>
  );
}

const thb = (n: number) => `฿${n.toLocaleString("th-TH", { maximumFractionDigits: 4 })}`;

export function TestAiButton({ disabled }: { disabled: boolean }) {
  const [result, setResult] = useState<TestAiResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="outline" className="self-start" disabled={disabled || pending} onClick={() => start(async () => setResult(await testOpenRouter()))}>
        {pending ? "กำลังเรียก AI…" : "ทดสอบเรียก AI จริง (≈ ฿0.01)"}
      </Button>
      {result &&
        (result.ok ? (
          <Notice tone="success">
            {result.model} ตอบว่า “{result.reply}” · ค่าใช้จ่ายจริง {thb(result.costThb)} (บันทึกแล้ว)
          </Notice>
        ) : (
          <Notice tone="error">{result.error}</Notice>
        ))}
    </div>
  );
}
