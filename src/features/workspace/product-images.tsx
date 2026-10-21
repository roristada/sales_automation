"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Notice } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateProductImages } from "@/features/content/workspace-actions";

/** Shopee's CDN serves a thumbnail when the link ends in "@resize_…"; the plain link is full size. */
const fullSize = (url: string) => url.replace(/@resize_[^/?#]+$/i, "");

/** Main photo (the AI clips' first frame) and extra photos, edited in place. */
export function ProductImages({ productId, imageUrl, gallery, spokenName, spokenDefault }: { productId: string; imageUrl: string; gallery: string[]; spokenName: string; spokenDefault: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [main, setMain] = useState(imageUrl);
  const [extra, setExtra] = useState(gallery.join("\n"));
  const [spoken, setSpoken] = useState(spokenName);
  const [error, setError] = useState<string | null>(null);
  const dirty = main !== imageUrl || extra !== gallery.join("\n") || spoken !== spokenName;
  const shrunk = [main, ...extra.split(/\s+/)].some((u) => u && fullSize(u) !== u);
  const previews = [main, ...extra.split(/\s+/)].filter((u) => /^https?:\/\//i.test(u)).slice(0, 10);

  const save = () =>
    start(async () => {
      setError(null);
      const res = await updateProductImages(productId, { image_url: main, gallery_urls: extra, spoken_name: spoken }).catch(() => ({ ok: false as const, error: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ" }));
      if (!res.ok) return setError(res.error);
      toast.success("บันทึกข้อมูลสินค้าแล้ว");
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-3 text-[13px]">
      {previews.length > 0 && (
        <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="รูปสินค้า">
          {previews.map((u, i) => (
            <li key={`${u}-${i}`} className="shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element -- external product photo */}
              <img src={u} alt={i === 0 ? "รูปหลัก" : `รูปเพิ่มเติม ${i}`} className="size-20 rounded-md border bg-surface-muted object-contain" loading="lazy" />
              <span className="mt-0.5 block text-center text-[11px] text-muted-foreground">{i === 0 ? "รูปหลัก" : `รูป ${i + 1}`}</span>
            </li>
          ))}
        </ul>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ws-spoken">ชื่อเรียกในคลิป</Label>
        <Input id="ws-spoken" value={spoken} onChange={(e) => setSpoken(e.target.value)} placeholder={spokenDefault} maxLength={60} />
        <span className="text-xs text-muted-foreground">ชื่อที่เสียงพากย์และข้อความบนจอใช้ · ว่าง = “{spokenDefault}” (ชื่อเต็มของร้านยังอยู่ในแคปชัน) · มีผลกับสคริปต์ที่สร้างหรือให้ AI เขียนใหม่</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ws-image">ลิงก์รูปหลัก</Label>
        <Input id="ws-image" type="url" value={main} onChange={(e) => setMain(e.target.value)} placeholder="https://…jpg" />
        <span className="text-xs text-muted-foreground">ใช้เป็นเฟรมแรกของคลิป AI (ระบบจัดลงกรอบ 9:16 ให้) · รูปพื้นเรียบไม่มีตัวหนังสือได้ผลดีที่สุด</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ws-gallery">ลิงก์รูปเพิ่มเติม (บรรทัดละ 1 ลิงก์)</Label>
        <Textarea id="ws-gallery" rows={3} value={extra} onChange={(e) => setExtra(e.target.value)} />
      </div>
      {shrunk && (
        <Notice tone="warning">
          บางลิงก์เป็นรูปย่อ (ลงท้าย @resize…) —{" "}
          <button
            type="button"
            className="font-medium text-primary underline"
            onClick={() => {
              setMain(fullSize(main));
              setExtra(
                extra
                  .split(/\n/)
                  .map((l) => fullSize(l.trim()))
                  .join("\n"),
              );
            }}
          >
            ใช้รูปขนาดเต็ม
          </button>
        </Notice>
      )}
      <Button type="button" size="sm" className="self-start" onClick={save} disabled={pending || !dirty}>
        {pending ? "กำลังบันทึก…" : "บันทึกข้อมูลสินค้า"}
      </Button>
    </div>
  );
}
