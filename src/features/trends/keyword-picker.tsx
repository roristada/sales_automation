"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { NativeSelect } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { setProductTrendKeyword } from "./actions";

export function TrendKeywordPicker({ productId, keywords, current }: { productId: string; keywords: string[]; current: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const options = current && !keywords.includes(current) ? [current, ...keywords] : keywords;

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          setError(null);
          const res = await setProductTrendKeyword(productId, value);
          if (!res.ok) return setError(res.error);
          toast.success(value ? `ผูกกับ “${value}” แล้ว` : "ยกเลิกการผูกแล้ว");
          router.refresh();
        });
      }}
    >
      <label htmlFor="trend-keyword" className="text-[13px] font-medium">
        คีย์เวิร์ดเทรนด์ของสินค้านี้
      </label>
      <div className="flex flex-wrap gap-2">
        <NativeSelect id="trend-keyword" value={value} onChange={(e) => setValue(e.target.value)} className="w-full sm:w-64">
          <option value="">— ไม่ผูก —</option>
          {options.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </NativeSelect>
        <Button type="submit" variant="outline" disabled={pending || value === (current ?? "")}>
          {pending ? "กำลังบันทึก…" : "บันทึก"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
