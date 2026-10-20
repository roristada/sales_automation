"use client";

import { CheckCircle2, ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Field } from "@/components/shared/field";
import { Notice } from "@/components/shared/states";
import { TrustBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DataStatus } from "@/features/products/schema";
import { confirmFact, deleteFact, type FactFormState, saveFact } from "./actions";
import { FactExtractDialog } from "./fact-extract-dialog";

export interface FactRow {
  id: string;
  label: string;
  value: string;
  status: string;
  source_url: string | null;
}

function FactForm({ productId, fact, onDone }: { productId: string; fact?: FactRow; onDone: () => void }) {
  const [state, action, pending] = useActionState<FactFormState, FormData>(saveFact.bind(null, productId, fact?.id ?? null), {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) {
      toast.success(fact ? "บันทึกข้อเท็จจริงแล้ว" : "เพิ่มข้อเท็จจริงแล้ว");
      form.current?.reset();
      onDone();
    } else if (state.fieldErrors) form.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
  }, [state, fact, onDone]);
  const prefix = fact ? `fact-${fact.id}` : "fact-new";
  return (
    <form ref={form} action={action} className="flex flex-col gap-3 rounded-lg border bg-surface p-4" noValidate>
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
        <Field id={`${prefix}-label`} label="หัวข้อ" required error={state.fieldErrors?.label} hint="เช่น แบตเตอรี่, น้ำหนัก">
          {(a11y) => <Input {...a11y} name="label" defaultValue={fact?.label} maxLength={80} />}
        </Field>
        <Field id={`${prefix}-value`} label="รายละเอียด" required error={state.fieldErrors?.value} hint="เขียนตามที่ตรวจสอบได้ เช่น ใช้งานได้ 20 ชั่วโมง">
          {(a11y) => <Input {...a11y} name="value" defaultValue={fact?.value} maxLength={300} />}
        </Field>
      </div>
      <Field id={`${prefix}-source`} label="แหล่งที่มา (ลิงก์)" error={state.fieldErrors?.source_url} hint="หน้าสินค้าหรือสเปกที่ยืนยันข้อเท็จจริงนี้">
        {(a11y) => <Input {...a11y} name="source_url" type="url" defaultValue={fact?.source_url ?? ""} />}
      </Field>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "กำลังบันทึก…" : fact ? "บันทึก" : "เพิ่มข้อเท็จจริง"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          ยกเลิก
        </Button>
      </div>
    </form>
  );
}

/** Product facts list with add/edit/delete. Scripts may only state what is listed here. */
export function FactsEditor({ productId, productName, description, facts }: { productId: string; productName: string; description: string | null; facts: FactRow[] }) {
  const router = useRouter();
  const unconfirmed = facts.filter((f) => f.status === "ai_estimate").length;
  const confirm = async (f: FactRow) => {
    const res = await confirmFact(productId, f.id).catch(() => ({ ok: false as const, error: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ" }));
    if (!res.ok) return void toast.error(res.error);
    toast.success(`ยืนยัน “${f.label}” แล้ว`);
    router.refresh();
  };
  const [editing, setEditing] = useState<string | "new" | null>(facts.length ? null : "new");
  const done = () => {
    setEditing(null);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      {unconfirmed > 0 && (
        <Notice tone="warning">
          {unconfirmed} ข้อดึงมาโดย AI ยังไม่ได้ยืนยัน — เปิดหน้าสินค้าเทียบทีละข้อ ถูกต้องกด “ยืนยันแล้ว” ไม่ถูกให้แก้ไขหรือลบ สคริปต์ใช้ข้อที่ยังไม่ยืนยันไม่ได้
        </Notice>
      )}
      {facts.length > 0 && (
        <ul className="divide-y rounded-lg border bg-surface">
          {facts.map((f) =>
            editing === f.id ? (
              <li key={f.id} className="p-2">
                <FactForm productId={productId} fact={f} onDone={done} />
              </li>
            ) : (
              <li key={f.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[13px] text-muted-foreground">{f.label}</p>
                  <p className="font-medium">{f.value}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <TrustBadge status={f.status as DataStatus} />
                    {f.source_url ? (
                      <a href={f.source_url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-primary hover:underline">
                        แหล่งที่มา <ExternalLink className="size-3" aria-hidden />
                        <span className="sr-only">(เปิดในแท็บใหม่)</span>
                      </a>
                    ) : (
                      <span>ไม่ได้ระบุแหล่งที่มา</span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {f.status === "ai_estimate" && (
                    <Button variant="outline" size="sm" onClick={() => confirm(f)} aria-label={`ยืนยัน ${f.label}`}>
                      <CheckCircle2 aria-hidden /> ยืนยันแล้ว
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setEditing(f.id)} aria-label={`แก้ไข ${f.label}`}>
                    <Pencil aria-hidden /> แก้ไข
                  </Button>
                  <ConfirmDialog
                    trigger={
                      <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive-subtle hover:text-destructive" aria-label={`ลบ ${f.label}`}>
                        <Trash2 aria-hidden /> ลบ
                      </Button>
                    }
                    title="ลบข้อเท็จจริงนี้?"
                    description={<>“{f.label}: {f.value}” จะถูกลบ ถ้ามี claim ในสคริปต์อ้างอิงอยู่ ต้องลบ claim นั้นก่อน</>}
                    confirmLabel="ลบ"
                    onConfirm={async () => {
                      const res = await deleteFact(productId, f.id);
                      if (!res.ok) return res.error;
                      toast.success("ลบแล้ว");
                      router.refresh();
                    }}
                  />
                </div>
              </li>
            ),
          )}
        </ul>
      )}
      {editing === "new" && <FactForm productId={productId} onDone={done} />}
      <div className="flex flex-wrap gap-2">
        {editing !== "new" && (
          <Button variant="outline" onClick={() => setEditing("new")}>
            <Plus aria-hidden /> เพิ่มข้อเท็จจริง
          </Button>
        )}
        <FactExtractDialog productId={productId} productName={productName} description={description} existing={facts.map((f) => ({ label: f.label, value: f.value }))} />
      </div>
    </div>
  );
}
