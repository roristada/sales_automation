"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { recomputeOutdatedScores } from "./actions";

export function RecomputeScoresButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await recomputeOutdatedScores();
            if (!res.ok) return setError(res.error);
            toast.success(`คำนวณคะแนนแล้ว ${res.data.scored.toLocaleString("th-TH")} รายการ`);
            router.refresh();
          })
        }
      >
        <RefreshCw className={pending ? "animate-spin" : undefined} aria-hidden /> {pending ? "กำลังคำนวณ…" : "คำนวณคะแนน"}
      </Button>
      {error && (
        <span role="alert" className="text-destructive">
          {error}
        </span>
      )}
    </span>
  );
}
