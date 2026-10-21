"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Field, NativeSelect } from "@/components/shared/field";
import { Notice } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createBatch } from "./batch-actions";
import { MAX_BATCH_PRODUCTS } from "./batch";
import type { ProductOption, TemplateOption } from "./new-project-form";
import { DEFAULT_DURATION, DURATIONS, type Platform, PLATFORM_LABEL, PLATFORMS } from "./templates";

/** "สร้างหลายวิดีโอ": products → template, platform, length → AI script (optional, with a budget). */
export function BatchForm({ products, templates, aiReady }: { products: ProductOption[]; templates: TemplateOption[]; aiReady: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [platform, setPlatform] = useState<Platform>("tiktok");
  const [duration, setDuration] = useState<number>(DEFAULT_DURATION);
  const [useAi, setUseAi] = useState(aiReady);
  const [budget, setBudget] = useState("5");
  const template = templates.find((t) => t.id === templateId);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_BATCH_PRODUCTS ? p : [...p, id]));

  const submit = () =>
    start(async () => {
      setError(null);
      const res = await createBatch({ productIds: picked, templateId, platform, durationS: duration, useAi, budgetThb: useAi && budget.trim() ? Number(budget) : null }).catch(() => ({
        ok: false as const,
        error: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ",
      }));
      if (!res.ok) return setError(res.error);
      router.push(`/content/batch/${res.data.id}?start=1`);
    });

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {error && <Notice tone="error">{error}</Notice>}
      <fieldset>
        <legend className="mb-2 text-base font-semibold">
          เลือกสินค้า <span className="text-[13px] font-normal text-muted-foreground">({picked.length}/{MAX_BATCH_PRODUCTS})</span>
        </legend>
        {!products.length ? (
          <p className="text-[13px] text-muted-foreground">ยังไม่มีสินค้า — เพิ่มสินค้าก่อน</p>
        ) : (
          <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border bg-surface text-[13px]" aria-label="สินค้า">
            {products.map((p) => {
              const short = template && template.needs.facts > p.factCount;
              const noPrice = template?.needs.price && p.price !== "ok";
              return (
                <li key={p.id}>
                  <label className="flex items-start gap-2 px-3 py-2">
                    <input type="checkbox" checked={picked.includes(p.id)} onChange={() => toggle(p.id)} disabled={!picked.includes(p.id) && picked.length >= MAX_BATCH_PRODUCTS} className="mt-0.5 accent-primary" />
                    <span className="min-w-0">
                      <span className="block break-words">{p.name}</span>
                      <span className="text-xs text-muted-foreground">
                        ข้อเท็จจริง {p.factCount} ข้อ · ราคา {p.price === "ok" ? "มี" : p.price === "stale" ? "เก่า" : "ไม่มี"}
                        {(short || noPrice) && <span className="text-warning"> · {short ? "ข้อเท็จจริงน้อยกว่าที่รูปแบบนี้ใช้" : "รูปแบบนี้ต้องมีราคาล่าสุด"}</span>}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="batch_template" label="รูปแบบคอนเทนต์">
          {(a) => (
            <NativeSelect {...a} value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="w-full">
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field id="batch_platform" label="แพลตฟอร์ม">
          {(a) => (
            <NativeSelect {...a} value={platform} onChange={(e) => setPlatform(e.target.value as Platform)} className="w-full">
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_LABEL[p]}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field id="batch_duration" label="ความยาว">
          {(a) => (
            <NativeSelect {...a} value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="w-full">
              {DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {d} วินาที
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      </div>
      {template && <p className="-mt-3 text-[13px] text-muted-foreground">{template.description}</p>}

      <fieldset className="flex flex-col gap-3 rounded-lg border bg-surface px-4 py-3 text-[13px]">
        <legend className="sr-only">AI</legend>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} disabled={!aiReady} className="mt-0.5 accent-primary" />
          <span>
            ให้ AI เขียนสคริปต์ทุกงาน
            <span className="block text-xs text-muted-foreground">
              {aiReady ? "ใช้เฉพาะข้อเท็จจริงที่ยืนยันแล้ว · ทุก claim ยังต้องตรวจและอนุมัติเองใน Script Studio" : "ตั้ง OPENROUTER_API_KEY ก่อน — ตอนนี้ร่างจาก template อย่างเดียว"}
            </span>
          </span>
        </label>
        {useAi && (
          <Field id="batch_budget" label="งบ AI ของชุดนี้ (บาท)" optional hint="เว้นว่าง = ใช้เพดานปกติ · สคริปต์ละประมาณ ฿0.02–0.1">
            {(a) => <Input {...a} type="number" inputMode="decimal" min={0} step="any" value={budget} onChange={(e) => setBudget(e.target.value)} className="max-w-40" />}
          </Field>
        )}
      </fieldset>

      <Button onClick={submit} disabled={pending || !picked.length} className="self-start">
        {pending ? "กำลังสร้าง…" : `สร้าง ${picked.length || ""} วิดีโอ`}
      </Button>
    </div>
  );
}
