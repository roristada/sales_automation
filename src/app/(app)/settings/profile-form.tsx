"use client";

import { useActionState } from "react";
import { Field } from "@/components/shared/field";
import { Notice } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type ProfileState, updateProfile } from "./actions";

export function ProfileForm({ displayName }: { displayName: string }) {
  const [state, action, pending] = useActionState<ProfileState, FormData>(updateProfile, {});
  return (
    <form action={action} className="flex max-w-sm flex-col gap-4">
      <Field id="display_name" label="ชื่อที่แสดง" optional hint="ใช้ทักทายในหน้าภาพรวมและแถบเมนู" error={state.error}>
        {(a11y) => <Input {...a11y} name="display_name" defaultValue={displayName} maxLength={80} />}
      </Field>
      {state.message && <Notice tone="success">{state.message}</Notice>}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "กำลังบันทึก…" : "บันทึกโปรไฟล์"}
      </Button>
    </form>
  );
}
