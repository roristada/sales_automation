"use client";

import { FileUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Notice } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { deleteTrendImport, importTrendCsv } from "./actions";

const MAX_BYTES = 500_000;

export function TrendUpload() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{ message: string; details?: string[] } | null>(null);

  function onFile(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (file.size > MAX_BYTES) return setError({ message: "ไฟล์ใหญ่เกินไปสำหรับไฟล์เทรนด์ (สูงสุด 500 KB)" });
    startTransition(async () => {
      const text = await file.text();
      const res = await importTrendCsv({ fileName: file.name, text, fileDate: new Date(file.lastModified).toISOString() }).catch(() => ({
        ok: false as const,
        error: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ",
      }));
      if (input.current) input.current.value = "";
      if (!res.ok) return setError({ message: res.error, details: "details" in res ? res.details : undefined });
      toast.success(`นำเข้าเทรนด์แล้ว: ${res.data.keywords.join(", ")}`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <label htmlFor="trend-file" className="sr-only">
          ไฟล์ CSV จาก Google Trends
        </label>
        <input id="trend-file" ref={input} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} disabled={pending} />
        <Button type="button" onClick={() => input.current?.click()} disabled={pending}>
          <FileUp aria-hidden /> {pending ? "กำลังนำเข้า…" : "นำเข้า CSV จาก Google Trends"}
        </Button>
      </div>
      {error && (
        <Notice tone="error">
          {error.message}
          {error.details && (
            <ul className="mt-1 list-disc pl-5 text-muted-foreground">
              {error.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}
    </div>
  );
}

export function DeleteTrendImportButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive-subtle hover:text-destructive">
          ลบ
        </Button>
      }
      title="ลบข้อมูลเทรนด์ชุดนี้?"
      description={<>“{label}” และค่าทุกช่วงเวลาในไฟล์นี้จะถูกลบ สินค้าที่ผูกคีย์เวิร์ดไว้จะใช้ไฟล์ก่อนหน้า (ถ้ามี)</>}
      confirmLabel="ลบ"
      onConfirm={async () => {
        const res = await deleteTrendImport(id);
        if (!res.ok) return res.error;
        toast.success("ลบแล้ว");
        router.refresh();
      }}
    />
  );
}
