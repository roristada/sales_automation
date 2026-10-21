"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { Field, NativeSelect } from "@/components/shared/field";
import { Notice } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { type CreateProjectState, createContentProject } from "./actions";
import { DEFAULT_DURATION, DURATIONS, PLATFORM_LABEL, PLATFORMS } from "./templates";

export interface ProductOption {
  id: string;
  name: string;
  price: "ok" | "stale" | "missing";
  factCount: number;
}

export interface TemplateOption {
  id: string;
  name: string;
  description: string;
  needs: { price: boolean; facts: number };
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <fieldset className="border-t pt-6 first-of-type:border-0 first-of-type:pt-0">
      <legend className="flex items-center gap-2 text-base font-semibold">
        <span className="flex size-6 items-center justify-center rounded-full bg-primary-subtle text-xs text-primary" aria-hidden>
          {n}
        </span>
        {title}
      </legend>
      <div className="mt-3">{children}</div>
    </fieldset>
  );
}

/** Guided flow (design.md §9.4): product → template → platform/duration → generate draft. */
export function NewProjectForm({ products, templates, initialProductId }: { products: ProductOption[]; templates: TemplateOption[]; initialProductId: string | null }) {
  const [state, action, pending] = useActionState<CreateProjectState, FormData>(createContentProject, {});
  const [productId, setProductId] = useState(initialProductId ?? "");
  const [templateId, setTemplateId] = useState("");
  const product = products.find((p) => p.id === productId);

  return (
    <form action={action} className="flex max-w-3xl flex-col gap-8" noValidate>
      {state.error && <Notice tone="error">{state.error}</Notice>}

      <Step n={1} title="เลือกสินค้า">
        <Field id="product_id" label="สินค้า" required error={state.fieldErrors?.product_id}>
          {(a11y) => (
            <NativeSelect {...a11y} name="product_id" value={productId} onChange={(e) => setProductId(e.target.value)} className="w-full">
              <option value="">— เลือกสินค้า —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        {product && (
          <p className="mt-2 text-[13px] text-muted-foreground">
            ข้อเท็จจริง {product.factCount} ข้อ · ราคา {product.price === "ok" ? "มี" : product.price === "stale" ? "เก่ากว่า 14 วัน" : "ไม่มี"} ·{" "}
            <Link href={`/products/${product.id}?tab=facts`} className="text-primary hover:underline">
              เพิ่มข้อเท็จจริง
            </Link>
          </p>
        )}
      </Step>

      <Step n={2} title="เลือกรูปแบบคอนเทนต์">
        <div role="radiogroup" aria-label="รูปแบบคอนเทนต์" aria-describedby={state.fieldErrors?.template_id ? "template-error" : undefined} className="grid gap-2 sm:grid-cols-2">
          {templates.map((t) => {
            const short = product && t.needs.facts > product.factCount;
            const noPrice = product && t.needs.price && product.price !== "ok";
            return (
              <label
                key={t.id}
                className={cn(
                  "flex cursor-pointer flex-col gap-1 rounded-lg border bg-surface p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-subtle has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                )}
              >
                <span className="flex items-center gap-2">
                  <input type="radio" name="template_id" value={t.id} checked={templateId === t.id} onChange={() => setTemplateId(t.id)} className="accent-primary" />
                  <span className="font-medium">{t.name}</span>
                </span>
                <span className="text-[13px] text-muted-foreground">{t.description}</span>
                {(short || noPrice) && (
                  <span className="text-xs text-warning">
                    {[short && `ใช้ข้อเท็จจริง ${t.needs.facts} ข้อ (มี ${product!.factCount}) ส่วนที่ขาดจะเป็นช่องให้เติม`, noPrice && (product!.price === "stale" ? "ราคาเก่า ต้องอัปเดตก่อนอนุมัติ" : "ไม่มีราคา")]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
              </label>
            );
          })}
        </div>
        {state.fieldErrors?.template_id && (
          <p id="template-error" className="mt-1.5 text-xs font-medium text-destructive">
            {state.fieldErrors.template_id}
          </p>
        )}
      </Step>

      <Step n={3} title="แพลตฟอร์มและความยาว">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="platform" label="แพลตฟอร์ม" required error={state.fieldErrors?.platform}>
            {(a11y) => (
              <NativeSelect {...a11y} name="platform" defaultValue="tiktok" className="w-full">
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {PLATFORM_LABEL[p]}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field id="target_duration_s" label="ความยาวเป้าหมาย" required error={state.fieldErrors?.target_duration_s} hint="วิดีโอแนวตั้ง 9:16">
            {(a11y) => (
              <NativeSelect {...a11y} name="target_duration_s" defaultValue={String(DEFAULT_DURATION)} className="w-full">
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {d} วินาที
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        </div>
        <details className="group mt-4">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden />
            ตั้งค่าเพิ่มเติม <span className="font-normal text-muted-foreground">(ไม่บังคับ)</span>
          </summary>
          <div className="mt-3">
            <Field id="title" label="ชื่อโปรเจกต์" optional error={state.fieldErrors?.title} hint="เว้นว่างเพื่อใช้ชื่อรูปแบบ + ชื่อสินค้า">
              {(a11y) => <Input {...a11y} name="title" maxLength={200} />}
            </Field>
          </div>
        </details>
      </Step>

      <div className="flex flex-col gap-2 border-t pt-6">
        <p className="text-[13px] text-muted-foreground">ระบบสร้างฉบับร่างจาก template และข้อเท็จจริงของสินค้า แล้วเปิด Script Studio ให้ตรวจและแก้ก่อนอนุมัติ</p>
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "กำลังสร้าง…" : "สร้างฉบับร่าง"}
          </Button>
          <Button asChild variant="ghost">
            <Link href="/content">ยกเลิก</Link>
          </Button>
        </div>
      </div>
    </form>
  );
}
