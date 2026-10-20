"use client";

import { CalendarClock, Download, RefreshCw, Send, Trash2, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { CopyButton } from "@/components/shared/copy-button";
import { Field, NativeSelect } from "@/components/shared/field";
import { Notice } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { type Platform, PLATFORM_LABEL, PLATFORMS } from "@/features/content/templates";
import {
  createPublication,
  deletePublication,
  type DetailsInput,
  type DetailsResult,
  markPublished,
  type PublishedInput,
  type PublishedResult,
  saveDetails,
  setSchedule,
  switchToLatestRender,
  withdrawPublication,
} from "./actions";

const offline = { ok: false as const, error: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ" };

/** `<input type="datetime-local">` value in the viewer's time zone. */
function toLocalInput(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Video Studio: start a publication for the latest render (or open the existing one). */
export function PreparePublication({ outputId, defaultPlatform }: { outputId: string; defaultPlatform: Platform }) {
  const router = useRouter();
  const [platform, setPlatform] = useState<Platform>(defaultPlatform);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <Field id="pub-platform" label="แพลตฟอร์ม">
        {(a) => (
          <NativeSelect {...a} value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABEL[p]}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await createPublication(outputId, platform).catch(() => offline);
            if (!res.ok) return setError(res.error);
            router.push(`/publishing/${res.data.id}`);
          })
        }
      >
        <Send aria-hidden /> {pending ? "กำลังเตรียม…" : "เตรียมเผยแพร่"}
      </Button>
    </div>
  );
}

/** Caption, affiliate link and notes. Caption and link lock once posted. */
export function DetailsForm({ id, initial, posted, captionLimit }: { id: string; initial: DetailsInput; posted: boolean; captionLimit: number }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [result, setResult] = useState<DetailsResult | null>(null);
  const [pending, start] = useTransition();
  const dirty = values.caption !== initial.caption || values.affiliate_url !== initial.affiliate_url || values.notes !== initial.notes;
  const fe = result && !result.ok ? result.fieldErrors : undefined;
  const set = (k: keyof DetailsInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues((v) => ({ ...v, [k]: e.target.value }));

  const download = () => {
    const url = URL.createObjectURL(new Blob([`﻿${values.caption}\n`], { type: "text/plain;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "caption.txt" });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveDetails(id, values).catch(() => offline);
          setResult(res);
          if (res.ok) {
            toast.success("บันทึกแล้ว");
            router.refresh();
          }
        });
      }}
    >
      <Field
        id="caption"
        label="แคปชัน"
        required={!posted}
        error={fe?.caption}
        hint={
          <span className={values.caption.length > captionLimit ? "font-medium text-destructive" : undefined}>
            {values.caption.length.toLocaleString()} / {captionLimit.toLocaleString()} ตัวอักษร{posted ? " · โพสต์แล้ว แก้ไม่ได้" : " · ต้องคงข้อความเปิดเผย affiliate ไว้"}
          </span>
        }
      >
        {(a) => <Textarea {...a} rows={6} value={values.caption} onChange={set("caption")} readOnly={posted} />}
      </Field>
      <div className="flex flex-wrap gap-2">
        <CopyButton value={values.caption} label="คัดลอกแคปชัน" />
        <Button type="button" variant="outline" size="sm" onClick={download}>
          <Download aria-hidden /> ดาวน์โหลด .txt
        </Button>
      </div>
      <Field id="affiliate_url" label="ลิงก์ affiliate" optional error={fe?.affiliate_url} hint="ค่าเริ่มต้นมาจากหน้าสินค้า">
        {(a) => <Input {...a} type="url" inputMode="url" value={values.affiliate_url} onChange={set("affiliate_url")} readOnly={posted} />}
      </Field>
      {values.affiliate_url && (
        <div>
          <CopyButton value={values.affiliate_url} label="คัดลอกลิงก์" />
        </div>
      )}
      <Field id="notes" label="หมายเหตุ" optional error={fe?.notes}>
        {(a) => <Textarea {...a} rows={2} value={values.notes} onChange={set("notes")} />}
      </Field>
      {result && !result.ok && !fe && <Notice tone="error">{result.error}</Notice>}
      <Button type="submit" disabled={pending || !dirty} className="self-start">
        {pending ? "กำลังบันทึก…" : "บันทึก"}
      </Button>
    </form>
  );
}

/** Plan a time to post. A reminder only: nothing is posted automatically. */
export function ScheduleForm({ id, scheduledFor }: { id: string; scheduledFor: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(() => (scheduledFor ? toLocalInput(scheduledFor) : ""));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (iso: string | null) =>
    start(async () => {
      setError(null);
      const res = await setSchedule(id, iso).catch(() => offline);
      if (!res.ok) return setError(res.error);
      toast.success(iso ? "ตั้งเวลาแล้ว" : "ยกเลิกเวลาแล้ว");
      if (!iso) setValue("");
      router.refresh();
    });
  return (
    <div className="flex flex-col gap-3">
      <Field id="scheduled_for" label="วันเวลาที่จะโพสต์" hint="ใช้เป็นตัวเตือนในรายการ ระบบไม่โพสต์ให้อัตโนมัติ">
        {(a) => <Input {...a} type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />}
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={pending || !value} onClick={() => run(new Date(value).toISOString())}>
          <CalendarClock aria-hidden /> ตั้งเวลา
        </Button>
        {scheduledFor && (
          <Button type="button" variant="ghost" disabled={pending} onClick={() => run(null)}>
            ยกเลิกเวลา
          </Button>
        )}
      </div>
    </div>
  );
}

/** After posting by hand: record the post URL. Only then is the item shown as published. */
export function MarkPublishedForm({ id, platformLabel, blocked }: { id: string; platformLabel: string; blocked: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState<PublishedInput>({ external_url: "", external_id: "", published_at: toLocalInput(null) });
  const [result, setResult] = useState<PublishedResult | null>(null);
  const [pending, start] = useTransition();
  const fe = result && !result.ok ? result.fieldErrors : undefined;
  const set = (k: keyof PublishedInput) => (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [k]: e.target.value }));
  return (
    <form
      className="flex flex-col gap-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const iso = Number.isNaN(Date.parse(values.published_at)) ? values.published_at : new Date(values.published_at).toISOString();
          const res = await markPublished(id, { ...values, published_at: iso }).catch(() => offline);
          setResult(res);
          if (res.ok) {
            toast.success("บันทึกการเผยแพร่แล้ว");
            router.refresh();
          }
        });
      }}
    >
      <Field id="external_url" label={`ลิงก์โพสต์บน ${platformLabel}`} required error={fe?.external_url} hint="คัดลอกจากปุ่มแชร์ของโพสต์">
        {(a) => <Input {...a} type="url" inputMode="url" placeholder="https://" value={values.external_url} onChange={set("external_url")} />}
      </Field>
      <Field id="external_id" label="รหัสโพสต์" optional error={fe?.external_id}>
        {(a) => <Input {...a} value={values.external_id} onChange={set("external_id")} />}
      </Field>
      <Field id="published_at" label="เผยแพร่เมื่อ" required error={fe?.published_at}>
        {(a) => <Input {...a} type="datetime-local" value={values.published_at} onChange={set("published_at")} />}
      </Field>
      {result && !result.ok && !fe && <Notice tone="error">{result.error}</Notice>}
      <Button type="submit" disabled={pending || blocked} className="self-start">
        <Send aria-hidden /> {pending ? "กำลังบันทึก…" : "บันทึกว่าเผยแพร่แล้ว"}
      </Button>
    </form>
  );
}

export function SwitchRenderButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await switchToLatestRender(id).catch(() => offline);
          if (!res.ok) return void toast.error(res.error);
          toast.success("เปลี่ยนเป็นวิดีโอล่าสุดแล้ว");
          router.refresh();
        })
      }
    >
      <RefreshCw aria-hidden /> ใช้วิดีโอล่าสุด
    </Button>
  );
}

export function WithdrawButton({ id }: { id: string }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button type="button" variant="outline" size="sm">
          <Undo2 aria-hidden /> บันทึกว่าลบโพสต์แล้ว
        </Button>
      }
      title="บันทึกว่าลบโพสต์นี้แล้ว?"
      description="ใช้เมื่อคุณลบโพสต์บนแพลตฟอร์มแล้ว ระบบไม่ได้ลบโพสต์ให้ รายการนี้จะเก็บไว้เป็นประวัติ และโพสต์คอนเทนต์นี้ใหม่บนแพลตฟอร์มเดิมได้"
      confirmLabel="บันทึกว่าลบแล้ว"
      onConfirm={async () => {
        const res = await withdrawPublication(id).catch(() => offline);
        if (!res.ok) return res.error;
        router.refresh();
      }}
    />
  );
}

export function DeletePublicationButton({ id }: { id: string }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button type="button" variant="ghost" size="sm" className="text-destructive">
          <Trash2 aria-hidden /> ลบรายการ
        </Button>
      }
      title="ลบรายการเผยแพร่นี้?"
      description="ลบเฉพาะรายการที่ยังไม่ได้โพสต์ วิดีโอและสคริปต์ยังอยู่"
      confirmLabel="ลบรายการ"
      onConfirm={async () => {
        const res = await deletePublication(id).catch(() => offline);
        if (!res.ok) return res.error;
        toast.success("ลบรายการแล้ว");
        router.push("/publishing");
      }}
    />
  );
}
