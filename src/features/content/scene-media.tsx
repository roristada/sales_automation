"use client";

import { Film, ImageIcon, Package } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Chip } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { type AssetLicense, LICENSE_LABEL, licenseVerdict } from "@/features/assets/licensing";
import { cn } from "@/lib/utils";
import { setSceneAsset } from "./actions";

export interface MediaAsset {
  id: string;
  name: string;
  kind: string;
  license: string;
  attribution: string | null;
  source: string;
  ai_generated: boolean;
  duration_s: number | null;
}

const TONE = { ok: "success", warn: "warning", block: "danger" } as const;

function Thumb({ asset, className }: { asset: MediaAsset; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center overflow-hidden rounded-md bg-surface-muted", className)}>
      {asset.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element -- private, auth-checked file route
        <img src={`/api/assets/${asset.id}`} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <Film className="size-5 text-muted-foreground" aria-hidden />
      )}
    </div>
  );
}

/** What the scene shows: a library asset, or the product photo by default. */
export function SceneMedia({ sceneId, sceneNumber, assetId, assets, locked }: { sceneId: string; sceneNumber: number; assetId: string | null; assets: MediaAsset[]; locked: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const current = assetId ? assets.find((a) => a.id === assetId) : undefined;

  const choose = (id: string | null) =>
    start(async () => {
      const res = await setSceneAsset(sceneId, id);
      if (!res.ok) return void toast.error(res.error);
      setOpen(false);
      toast.success(id ? "ใส่ไฟล์ในฉากแล้ว" : "กลับไปใช้รูปสินค้าแล้ว");
      router.refresh();
    });

  const label = current ? (
    <span className="flex min-w-0 items-center gap-2">
      <Thumb asset={current} className="size-10 shrink-0" />
      <span className="min-w-0">
        <span className="block truncate">{current.name}</span>
        <Chip tone={TONE[licenseVerdict(current).level]}>{LICENSE_LABEL[current.license as AssetLicense]}</Chip>
      </span>
    </span>
  ) : (
    <span className="flex items-center gap-2 text-muted-foreground">
      <Package className="size-4" aria-hidden /> {assetId ? "ไฟล์ถูกลบหรือเข้าถึงไม่ได้" : "รูปสินค้า (ค่าเริ่มต้น)"}
    </span>
  );

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[13px] font-medium">ภาพในวิดีโอ</p>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-[13px]">
        {label}
        {!locked && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" aria-label={`เลือกภาพสำหรับฉากที่ ${sceneNumber}`}>
                <ImageIcon aria-hidden /> เลือกจากคลังไฟล์
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>ภาพสำหรับฉากที่ {sceneNumber}</DialogTitle>
                <DialogDescription>ไฟล์ที่เลือกจะเต็มจอในฉากนี้แทนรูปสินค้า ไฟล์ที่ห้ามใช้เชิงพาณิชย์จะทำให้อนุมัติไม่ได้</DialogDescription>
              </DialogHeader>
              <Button variant="ghost" className="self-start" disabled={pending || !assetId} onClick={() => choose(null)}>
                <Package aria-hidden /> ใช้รูปสินค้า (ค่าเริ่มต้น)
              </Button>
              {assets.length ? (
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {assets.map((a) => {
                    const v = licenseVerdict(a);
                    return (
                      <li key={a.id}>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => choose(a.id)}
                          aria-pressed={a.id === assetId}
                          className={cn(
                            "flex w-full flex-col gap-1 rounded-md border p-1.5 text-left text-xs hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                            a.id === assetId && "border-primary bg-primary-subtle",
                          )}
                        >
                          <Thumb asset={a} className="aspect-video w-full" />
                          <span className="truncate font-medium">{a.name}</span>
                          <span className="flex flex-wrap gap-1">
                            <Chip tone={TONE[v.level]}>{LICENSE_LABEL[a.license as AssetLicense]}</Chip>
                            {a.kind === "video" && a.duration_s && <Chip>{a.duration_s.toFixed(1)} วิ</Chip>}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-[13px] text-muted-foreground">
                  คลังไฟล์ยังว่าง —{" "}
                  <Link href="/assets" className="text-primary hover:underline">
                    อัปโหลดรูปหรือคลิป
                  </Link>
                </p>
              )}
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  );
}
