"use client";

import { CheckCircle2, CopyPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Notice } from "@/components/shared/states";
import { TrustBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { approveStoryboard, createNewVersion } from "./actions";
import type { AiPromptContext } from "./ai-assist-dialog";
import { AiScriptDialog } from "./ai-script-dialog";
import type { MediaAsset } from "./scene-media";
import { type EditorFact, type EditorScene, StudioEditor } from "./studio-editor";
import { estimateTotalSeconds, type ValidationIssue } from "./validate";

export interface StudioShellProps {
  storyboardId: string;
  productId: string;
  hook: string;
  caption: string;
  cta: string;
  disclosure: string;
  scenes: EditorScene[];
  facts: EditorFact[];
  issues: ValidationIssue[];
  locked: boolean;
  targetSeconds: number;
  approvedAt: string | null;
  llmNote: string;
  promptContext: AiPromptContext;
  assets: MediaAsset[];
}

export function StudioShell(p: StudioShellProps) {
  const router = useRouter();
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const blocks = p.issues.filter((i) => i.level === "block");
  const warns = p.issues.filter((i) => i.level === "warn");
  const claims = p.scenes.flatMap((s) => s.claims);
  const verified = claims.filter((c) => c.review_status === "verified").length;
  const est = estimateTotalSeconds(p.scenes);
  const usedFacts = p.facts.filter((f) => f.key.startsWith("fact:") || f.value);

  const approve = () =>
    start(async () => {
      setError(null);
      const res = await approveStoryboard(p.storyboardId).catch(() => ({ ok: false as const, error: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ" }));
      if (!res.ok) {
        setError(res.error);
        router.refresh();
        return;
      }
      toast.success("อนุมัติสคริปต์แล้ว");
      router.refresh();
    });

  const newVersion = () =>
    start(async () => {
      const res = await createNewVersion(p.storyboardId).catch(() => ({ ok: false as const, error: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ" }));
      if (!res.ok) return void toast.error(res.error);
      toast.success("สร้างเวอร์ชันใหม่แล้ว");
      router.push(`/studio/${res.data.id}`);
    });

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 lg:order-1">
        <StudioEditor
          storyboardId={p.storyboardId}
          hook={p.hook}
          caption={p.caption}
          cta={p.cta}
          disclosure={p.disclosure}
          scenes={p.scenes}
          facts={p.facts}
          issues={p.issues}
          locked={p.locked}
          promptContext={p.promptContext}
          assets={p.assets}
          onDirtyChange={setDirty}
        />
      </div>

      {/* Approval first on small screens; reference panels only beside the editor on large ones. */}
      <aside aria-label="ตรวจก่อนอนุมัติ" className="order-first flex flex-col gap-4 lg:sticky lg:top-4 lg:order-2">
        <section className="rounded-lg border bg-surface p-4">
          {p.locked ? (
            <>
              <p className="flex items-center gap-1.5 font-semibold text-success">
                <CheckCircle2 className="size-4" aria-hidden /> อนุมัติแล้ว
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground">สคริปต์นี้ล็อกไว้และพร้อมทำวิดีโอ ถ้าต้องแก้ ให้สร้างเวอร์ชันใหม่</p>
              <Button asChild className="mt-3 w-full">
                <Link href={`/videos/${p.storyboardId}`}>ไปทำวิดีโอ</Link>
              </Button>
              <Button className="mt-3 w-full" variant="outline" disabled={pending} onClick={newVersion}>
                <CopyPlus aria-hidden /> {pending ? "กำลังสร้าง…" : "สร้างเวอร์ชันใหม่เพื่อแก้ไข"}
              </Button>
            </>
          ) : (
            <>
              <h2 className="font-semibold">ตรวจก่อนอนุมัติ</h2>
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[13px]">
                <dt className="text-muted-foreground">ต้องแก้</dt>
                <dd className={cn("text-right font-medium tabular-nums", blocks.length ? "text-destructive" : "text-success")}>{blocks.length}</dd>
                <dt className="text-muted-foreground">ควรดู</dt>
                <dd className="text-right tabular-nums">{warns.length}</dd>
                <dt className="text-muted-foreground">Claim ตรวจแล้ว</dt>
                <dd className="text-right tabular-nums">
                  {verified}/{claims.length}
                </dd>
                <dt className="text-muted-foreground">ความยาวโดยประมาณ</dt>
                <dd className="text-right tabular-nums">
                  {est}/{p.targetSeconds} วิ
                </dd>
              </dl>
              <p className="mt-1 text-xs text-muted-foreground">ความยาวประมาณจากจำนวนตัวอักษร เวลาจริงคำนวณจากเสียงพากย์ตอนทำวิดีโอ</p>
              {error && (
                <Notice tone="error" className="mt-3">
                  {error}
                </Notice>
              )}
              {p.promptContext.aiReady && (
                <div className="mt-3">
                  <AiScriptDialog storyboardId={p.storyboardId} facts={p.facts} disabled={pending || dirty} />
                </div>
              )}
              {dirty && <p className="mt-3 text-[13px] text-warning">มีการแก้ไขที่ยังไม่ได้บันทึก — บันทึกก่อนอนุมัติ</p>}
              <Button className="mt-3 w-full" disabled={pending || dirty || blocks.length > 0} onClick={approve}>
                <CheckCircle2 aria-hidden /> {pending ? "กำลังตรวจ…" : "อนุมัติสคริปต์"}
              </Button>
              {blocks.length > 0 && <p className="mt-2 text-xs text-muted-foreground">แก้รายการ “ต้องแก้” ให้หมดก่อน รายการอยู่ในแต่ละฉาก</p>}
              {p.issues
                .filter((i) => !i.sceneId)
                .map((i, n) => (
                  <p key={n} className={cn("mt-2 text-xs lg:hidden", i.level === "block" ? "text-destructive" : "text-warning")}>
                    <span className="text-foreground">{i.message}</span>
                  </p>
                ))}
              <Link href={`/products/${p.productId}?tab=facts`} className="mt-2 inline-block text-xs text-primary hover:underline lg:hidden">
                เพิ่มหรือแก้ข้อเท็จจริง
              </Link>
            </>
          )}
        </section>

        {!p.locked && (blocks.some((i) => !i.sceneId) || warns.some((i) => !i.sceneId)) && (
          <section className="hidden rounded-lg border bg-surface p-4 text-[13px] lg:block">
            <h2 className="mb-2 font-semibold">ทั้งสคริปต์</h2>
            <ul className="flex flex-col gap-1">
              {p.issues
                .filter((i) => !i.sceneId)
                .map((i, n) => (
                  <li key={n} className={i.level === "block" ? "text-destructive" : "text-warning"}>
                    <span className="text-foreground">{i.message}</span>
                  </li>
                ))}
            </ul>
          </section>
        )}

        <section className="hidden rounded-lg border bg-surface p-4 text-[13px] lg:block">
          <h2 className="font-semibold">ข้อเท็จจริงที่อ้างอิงได้</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {usedFacts.map((f) => (
              <li key={f.key}>
                <span className="text-muted-foreground">{f.label}</span>
                <span className="block">{f.value ? (f.value.length > 80 ? `${f.value.slice(0, 79)}…` : f.value) : "—"}</span>
                {f.status !== "user_provided" && <TrustBadge status={f.status} />}
              </li>
            ))}
          </ul>
          <Link href={`/products/${p.productId}?tab=facts`} className="mt-3 inline-block text-primary hover:underline">
            เพิ่มหรือแก้ข้อเท็จจริง
          </Link>
        </section>

        <section className="hidden rounded-lg border bg-surface p-4 text-[13px] lg:block">
          <h2 className="font-semibold">AI ช่วยเขียน</h2>
          <p className="mt-1 text-muted-foreground">{p.llmNote}</p>
        </section>
      </aside>
    </div>
  );
}
