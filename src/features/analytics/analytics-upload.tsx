"use client";

import { FileUp, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Notice } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { deletePerformanceImport, type ImportSummary, importConversions, importPostMetrics, rematchPerformance } from "./actions";

const MAX_BYTES = 2_500_000;
const offline = { ok: false as const, error: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ" };

const KIND = {
  post_metrics: { label: "นำเข้าผลโพสต์ (CSV)", inputLabel: "ไฟล์ CSV ผลโพสต์จาก TikTok Studio / YouTube Studio / Instagram", run: importPostMetrics },
  affiliate_conversions: { label: "นำเข้ารายงาน Conversion (CSV)", inputLabel: "ไฟล์ CSV รายงาน Conversion จาก Shopee Affiliate", run: importConversions },
} as const;

export function AnalyticsUpload({ kind }: { kind: keyof typeof KIND }) {
  const k = KIND[kind];
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportSummary | null>(null);

  function onFile(file: File | undefined) {
    setError(null);
    setResult(null);
    if (!file) return;
    if (file.size > MAX_BYTES) return setError("ไฟล์ใหญ่เกิน 2.5 MB — แบ่งเป็นหลายไฟล์");
    start(async () => {
      const text = await file.text();
      const res = await k.run({ fileName: file.name, text, fileDate: new Date(file.lastModified).toISOString() }).catch(() => offline);
      if (input.current) input.current.value = "";
      if (!res.ok) return setError(res.error);
      setResult(res.data);
      toast.success(`นำเข้าแล้ว ${res.data.saved.toLocaleString()} แถว`);
      router.refresh();
    });
  }

  const id = `file-${kind}`;
  return (
    <div className="flex flex-col gap-2">
      <div>
        <label htmlFor={id} className="sr-only">
          {k.inputLabel}
        </label>
        <input id={id} ref={input} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} disabled={pending} />
        <Button type="button" variant={kind === "post_metrics" ? "default" : "outline"} onClick={() => input.current?.click()} disabled={pending}>
          <FileUp aria-hidden /> {pending ? "กำลังนำเข้า…" : k.label}
        </Button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {result && (
        <Notice tone={result.failed ? "warning" : "success"}>
          บันทึก {result.saved.toLocaleString()} จาก {result.total.toLocaleString()} แถว · จับคู่กับวิดีโอในระบบ {result.matched.toLocaleString()} แถว
          {result.failed > 0 && ` · ข้าม ${result.failed.toLocaleString()} แถว`}
          {result.errors.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-muted-foreground">
              {result.errors.slice(0, 5).map((e) => (
                <li key={e.line}>
                  บรรทัด {e.line}: {e.message}
                </li>
              ))}
            </ul>
          )}
        </Notice>
      )}
    </div>
  );
}

export function RematchButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await rematchPerformance().catch(() => offline);
          if (!res.ok) return void toast.error(res.error);
          const n = res.data.metrics + res.data.conversions;
          toast.success(n ? `จับคู่เพิ่ม ${n.toLocaleString()} แถว` : "ไม่มีแถวที่จับคู่เพิ่มได้");
          router.refresh();
        })
      }
    >
      <RefreshCw aria-hidden /> จับคู่ใหม่
    </Button>
  );
}

export function DeleteImportButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive-subtle hover:text-destructive">
          ลบ
        </Button>
      }
      title="ลบไฟล์นำเข้านี้?"
      description={<>ข้อมูลจาก “{label}” จะถูกลบ (แถวที่ไฟล์ใหม่กว่าอัปเดตไปแล้วจะอยู่กับไฟล์นั้น)</>}
      confirmLabel="ลบ"
      onConfirm={async () => {
        const res = await deletePerformanceImport(id).catch(() => offline);
        if (!res.ok) return res.error;
        toast.success("ลบแล้ว");
        router.refresh();
      }}
    />
  );
}
