"use client";

import { Pencil, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Field, NativeSelect } from "@/components/shared/field";
import { Notice } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { type AssetFormState, deleteAsset, updateAsset } from "./actions";
import { ACCEPTED_TYPES, ASSET_LICENSES, ASSET_SOURCES, LICENSE_LABEL, licenseVerdict, SOURCE_LABEL } from "./licensing";

export interface ProductOption {
  id: string;
  name: string;
}

export interface AssetMeta {
  name: string;
  source: string;
  license: string;
  source_url: string | null;
  attribution: string | null;
  notes?: string | null;
  ai_generated: boolean;
  product_id: string | null;
}

const VERDICT_TONE = { ok: "text-success", warn: "text-warning", block: "text-destructive" } as const;

/** Shared metadata fields; shows the licensing verdict live as the user picks. */
function MetaFields({ prefix, initial, products, errors, withNotes }: { prefix: string; initial: Partial<AssetMeta>; products: ProductOption[]; errors?: Record<string, string>; withNotes?: boolean }) {
  const [license, setLicense] = useState(initial.license ?? "unknown");
  const [source, setSource] = useState(initial.source ?? "own");
  const [attribution, setAttribution] = useState(initial.attribution ?? "");
  const [ai, setAi] = useState(initial.ai_generated ?? false);
  const verdict = licenseVerdict({ license, attribution, source, ai_generated: ai || source === "ai_generated" });
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${prefix}-source`} label="แหล่งที่มา" required error={errors?.source}>
          {(a) => (
            <NativeSelect {...a} name="source" value={source} onChange={(e) => setSource(e.target.value)} className="w-full">
              {ASSET_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABEL[s]}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field id={`${prefix}-license`} label="สิทธิ์การใช้งาน" required error={errors?.license}>
          {(a) => (
            <NativeSelect {...a} name="license" value={license} onChange={(e) => setLicense(e.target.value)} className="w-full">
              {ASSET_LICENSES.map((l) => (
                <option key={l} value={l}>
                  {LICENSE_LABEL[l]}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      </div>
      <p className={`text-[13px] ${VERDICT_TONE[verdict.level]}`} role="status">
        {verdict.message}
      </p>
      <Field id={`${prefix}-attribution`} label="เครดิต" optional error={errors?.attribution} hint="เช่น “ภาพโดย … จาก …” (จำเป็นสำหรับ CC BY)">
        {(a) => <Input {...a} name="attribution" value={attribution} onChange={(e) => setAttribution(e.target.value)} maxLength={300} />}
      </Field>
      <Field id={`${prefix}-source-url`} label="ลิงก์ต้นฉบับ/สัญญาอนุญาต" optional error={errors?.source_url}>
        {(a) => <Input {...a} name="source_url" type="url" defaultValue={initial.source_url ?? ""} />}
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${prefix}-product`} label="สินค้า" optional>
          {(a) => (
            <NativeSelect {...a} name="product_id" defaultValue={initial.product_id ?? ""} className="w-full">
              <option value="">— ไม่ระบุ —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-[13px]">
          <input type="checkbox" name="ai_generated" checked={ai} onChange={(e) => setAi(e.target.checked)} className="accent-primary" />
          สร้างหรือแต่งด้วย AI
        </label>
      </div>
      {withNotes && (
        <Field id={`${prefix}-notes`} label="หมายเหตุ" optional>
          {(a) => <Textarea {...a} name="notes" defaultValue={initial.notes ?? ""} rows={2} maxLength={1000} />}
        </Field>
      )}
    </>
  );
}

/** Upload with progress (XHR so large clips show real progress). */
export function AssetUpload({ products }: { products: ProductOption[] }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formKey, setFormKey] = useState(0);
  const accept = Object.keys(ACCEPTED_TYPES).join(",");

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setErrors({});
    const data = new FormData(e.currentTarget);
    const file = data.get("file");
    if (!(file instanceof File) || !file.size) return setError("เลือกไฟล์ก่อน");
    const type = ACCEPTED_TYPES[file.type];
    if (!type) return setError("รองรับเฉพาะ JPG, PNG, WebP, MP4, MOV, WebM");
    if (file.size > type.maxBytes) return setError(`ไฟล์ใหญ่เกิน ${type.maxBytes / 1024 / 1024} MB`);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/assets");
    xhr.upload.onprogress = (ev) => ev.lengthComputable && setProgress(Math.round((ev.loaded / ev.total) * 100));
    xhr.onerror = () => {
      setProgress(null);
      setError("อัปโหลดไม่สำเร็จ — ตรวจการเชื่อมต่อแล้วลองใหม่");
    };
    xhr.onload = () => {
      setProgress(null);
      let body: { error?: string; fieldErrors?: Record<string, string>; duplicate?: boolean; name?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // non-JSON error page
      }
      if (xhr.status >= 400) {
        setError(body.error ?? `อัปโหลดไม่สำเร็จ (HTTP ${xhr.status})`);
        setErrors(body.fieldErrors ?? {});
        return;
      }
      toast.success(body.duplicate ? `ไฟล์นี้มีอยู่แล้ว (“${body.name}”) — ไม่ได้เก็บซ้ำ` : "อัปโหลดแล้ว");
      setFormKey((k) => k + 1);
      router.refresh();
    };
    xhr.send(data);
  }

  return (
    <form key={formKey} ref={form} onSubmit={submit} className="flex flex-col gap-3 rounded-lg border bg-surface p-4" noValidate>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="asset-file" label="ไฟล์" required hint="รูป JPG/PNG/WebP ไม่เกิน 20 MB · วิดีโอ MP4/MOV/WebM ไม่เกิน 200 MB">
          {(a) => <Input {...a} name="file" type="file" accept={accept} className="pt-1.5" />}
        </Field>
        <Field id="asset-name" label="ชื่อ" optional hint="เว้นว่างเพื่อใช้ชื่อไฟล์">
          {(a) => <Input {...a} name="name" maxLength={200} />}
        </Field>
      </div>
      <MetaFields prefix="upload" initial={{}} products={products} errors={errors} />
      {progress !== null && <Progress value={progress} aria-label="ความคืบหน้าการอัปโหลด" />}
      <Button type="submit" className="self-start" disabled={progress !== null}>
        <Upload aria-hidden /> {progress !== null ? `กำลังอัปโหลด ${progress}%` : "อัปโหลด"}
      </Button>
    </form>
  );
}

export function EditAssetButton({ id, asset, products, usage }: { id: string; asset: AssetMeta; products: ProductOption[]; usage: { href: string; label: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<AssetFormState, FormData>(updateAsset.bind(null, id), {});
  useEffect(() => {
    if (state.ok) {
      toast.success("บันทึกแล้ว");
      setOpen(false);
      router.refresh();
    }
  }, [state, router]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" aria-label={`แก้ไข ${asset.name}`}>
          <Pencil aria-hidden /> แก้ไข
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>แก้ไขข้อมูลไฟล์</DialogTitle>
          <DialogDescription>ระบุที่มาและสิทธิ์ตามจริง — ระบบไม่ถือว่าไฟล์ใช้เชิงพาณิชย์ได้ถ้าไม่ทราบสิทธิ์</DialogDescription>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-3" noValidate>
          {state.error && <Notice tone="error">{state.error}</Notice>}
          <Field id={`edit-${id}-name`} label="ชื่อ" required error={state.fieldErrors?.name}>
            {(a) => <Input {...a} name="name" defaultValue={asset.name} maxLength={200} />}
          </Field>
          <MetaFields prefix={`edit-${id}`} initial={asset} products={products} errors={state.fieldErrors} withNotes />
          <div className="text-[13px]">
            <p className="font-medium">ใช้อยู่ใน</p>
            {usage.length ? (
              <ul className="mt-1 list-disc pl-5">
                {usage.map((u) => (
                  <li key={u.href + u.label}>
                    <a href={u.href} className="text-primary hover:underline">
                      {u.label}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">ยังไม่ได้ใช้ในฉากใด</p>
            )}
          </div>
          <Button type="submit" className="self-start" disabled={pending}>
            {pending ? "กำลังบันทึก…" : "บันทึก"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteAssetButton({ id, name, used }: { id: string; name: string; used: boolean }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive-subtle hover:text-destructive" aria-label={`ลบ ${name}`}>
          <Trash2 aria-hidden />
        </Button>
      }
      title="ลบไฟล์นี้?"
      description={used ? <>“{name}” ถูกใช้อยู่ในฉาก ต้องเอาออกจากฉากก่อนจึงจะลบได้</> : <>“{name}” จะถูกลบถาวร ย้อนกลับไม่ได้</>}
      confirmLabel="ลบไฟล์"
      onConfirm={async () => {
        const res = await deleteAsset(id);
        if (!res.ok) return res.error;
        toast.success("ลบแล้ว");
        router.refresh();
      }}
    />
  );
}
