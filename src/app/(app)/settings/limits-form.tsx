"use client";

import { useActionState } from "react";
import { Field } from "@/components/shared/field";
import { Notice } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type LimitsState, saveSpendingLimits } from "./actions";

export function LimitsForm({ daily, monthly }: { daily: number | null; monthly: number | null }) {
  const [state, action, pending] = useActionState<LimitsState, FormData>(saveSpendingLimits, {});
  return (
    <form action={action} className="flex max-w-md flex-col gap-4" noValidate>
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="daily_thb" label="เพดานรายวัน (บาท)" optional hint="เว้นว่าง = ไม่จำกัด" error={state.fieldErrors?.daily_thb}>
          {(a) => <Input {...a} name="daily_thb" type="number" inputMode="decimal" min={0} step="any" defaultValue={daily ?? ""} />}
        </Field>
        <Field id="monthly_thb" label="เพดานรายเดือน (บาท)" optional hint="เว้นว่าง = ไม่จำกัด" error={state.fieldErrors?.monthly_thb}>
          {(a) => <Input {...a} name="monthly_thb" type="number" inputMode="decimal" min={0} step="any" defaultValue={monthly ?? ""} />}
        </Field>
      </div>
      {state.message && <Notice tone="success">{state.message}</Notice>}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "กำลังบันทึก…" : "บันทึกเพดาน"}
      </Button>
    </form>
  );
}
