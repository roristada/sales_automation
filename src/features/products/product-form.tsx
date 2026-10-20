"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { Field } from "@/components/shared/field";
import { Notice } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ProductFormState } from "./actions";
import type { ProductInput } from "./schema";

type FieldDef = {
  name: keyof ProductInput;
  label: string;
  type?: "text" | "url" | "number" | "date" | "textarea";
  hint?: string;
  required?: boolean;
  wide?: boolean;
};

/** Grouped into logical sections; rarely needed fields sit in a collapsible section (design.md §8 Forms). */
const SECTIONS: { title: string; description?: string; collapsible?: boolean; fields: FieldDef[] }[] = [
  {
    title: "ข้อมูลหลัก",
    fields: [
      { name: "name", label: "ชื่อสินค้า", required: true, wide: true },
      { name: "product_url", label: "ลิงก์สินค้า", type: "url", hint: "ใช้ตรวจว่าสินค้าซ้ำกับที่มีอยู่หรือไม่" },
      { name: "affiliate_url", label: "ลิงก์ Affiliate", type: "url", hint: "ลิงก์ที่ใช้ใส่ในคอนเทนต์" },
    ],
  },
  {
    title: "ราคาและค่าคอม",
    description: "เว้นว่างถ้าไม่ทราบ ระบบจะแสดงเป็น “ไม่มีข้อมูล” ไม่ใช่ 0",
    fields: [
      { name: "price", label: "ราคา (บาท)", type: "number" },
      { name: "commission_rate", label: "อัตราค่าคอม (%)", type: "number" },
      { name: "commission_amount", label: "ค่าคอมต่อชิ้น (บาท)", type: "number" },
      { name: "retrieved_at", label: "วันที่ได้ข้อมูลราคา/ค่าคอม", type: "date", hint: "ใช้ตัดสินว่าข้อมูลเก่าหรือไม่" },
    ],
  },
  {
    title: "รายละเอียดเพิ่มเติม",
    collapsible: true,
    fields: [
      { name: "category", label: "หมวดหมู่" },
      { name: "marketplace", label: "Marketplace", hint: "เช่น shopee, lazada" },
      { name: "source_product_id", label: "รหัสสินค้าที่ Marketplace" },
      { name: "image_url", label: "ลิงก์รูปภาพ", type: "url", hint: "รูปหลัก ใช้ในการ์ดสินค้าและวิดีโอ" },
      { name: "gallery_urls", label: "ลิงก์รูปเพิ่มเติม", type: "textarea", wide: true, hint: "บรรทัดละ 1 ลิงก์ สูงสุด 9 รูป — วิดีโอจะสลับรูปเหล่านี้ในแต่ละฉาก" },
      { name: "description", label: "รายละเอียดสินค้า", type: "textarea", wide: true },
      { name: "notes", label: "หมายเหตุ", type: "textarea", wide: true, hint: "เห็นเฉพาะคุณ" },
    ],
  },
];

export type ProductFormValues = Partial<Record<keyof ProductInput, string | number | null>>;

export function ProductForm({
  action,
  defaults = {},
  cancelHref,
  submitLabel,
}: {
  action: (prev: ProductFormState, formData: FormData) => Promise<ProductFormState>;
  defaults?: ProductFormValues;
  cancelHref: string;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useRef<HTMLFormElement>(null);
  const dirty = useRef(false);

  // Focus the first invalid field after a failed submit.
  useEffect(() => {
    if (state.fieldErrors) formRef.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
  }, [state]);

  // Protect against accidental loss of unsaved work.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current && !pending) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [pending]);

  const valueOf = (f: FieldDef) => {
    const raw = state.values ? state.values[f.name] : defaults[f.name];
    if (raw === null || raw === undefined) return "";
    return f.type === "date" ? String(raw).slice(0, 10) : String(raw);
  };

  return (
    <form
      ref={formRef}
      action={formAction}
      onChange={() => (dirty.current = true)}
      onSubmit={() => (dirty.current = false)}
      className="flex max-w-3xl flex-col gap-8"
      noValidate
    >
      {state.error && (
        <Notice tone="error">
          {state.error}
          {state.duplicateOf && (
            <>
              {" "}
              <Link href={`/products/${state.duplicateOf}`} className="font-medium text-primary hover:underline">
                ดูสินค้าเดิม
              </Link>
            </>
          )}
        </Notice>
      )}

      {SECTIONS.map((section) => {
        const fields = (
          <div className="grid gap-4 sm:grid-cols-2">
            {section.fields.map((f) => (
              <Field
                key={f.name}
                id={f.name}
                label={f.label}
                required={f.required}
                hint={f.hint}
                error={state.fieldErrors?.[f.name]}
                className={f.wide ? "sm:col-span-2" : undefined}
              >
                {(a11y) =>
                  f.type === "textarea" ? (
                    <Textarea {...a11y} name={f.name} defaultValue={valueOf(f)} rows={4} />
                  ) : (
                    <Input
                      {...a11y}
                      name={f.name}
                      defaultValue={valueOf(f)}
                      type={f.type ?? "text"}
                      inputMode={f.type === "number" ? "decimal" : undefined}
                      step={f.type === "number" ? "any" : undefined}
                      min={f.type === "number" ? 0 : undefined}
                    />
                  )
                }
              </Field>
            ))}
          </div>
        );

        if (section.collapsible) {
          const hasContent = section.fields.some((f) => valueOf(f) !== "" || state.fieldErrors?.[f.name]);
          return (
            <details key={section.title} open={hasContent} className="group border-t pt-6">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-sm text-base font-semibold focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden />
                {section.title}
                <span className="text-[13px] font-normal text-muted-foreground">(ไม่บังคับ)</span>
              </summary>
              <div className="mt-4">{fields}</div>
            </details>
          );
        }
        return (
          // Border on a wrapper: a bordered <fieldset> draws its legend on top of the border line.
          <div key={section.title} className="border-t pt-6 first-of-type:border-0 first-of-type:pt-0">
            <fieldset>
              <legend className="text-base font-semibold">{section.title}</legend>
              {section.description && <p className="mt-1 text-[13px] text-muted-foreground">{section.description}</p>}
              <div className="mt-4">{fields}</div>
            </fieldset>
          </div>
        );
      })}

      <div className="flex gap-2 border-t pt-6">
        <Button type="submit" disabled={pending}>
          {pending ? "กำลังบันทึก…" : submitLabel}
        </Button>
        <Button asChild variant="ghost">
          <Link href={cancelHref}>ยกเลิก</Link>
        </Button>
      </div>
    </form>
  );
}
