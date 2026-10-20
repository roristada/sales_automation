"use client";

import { ArrowDown, ArrowUp, Check, Lock, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { NativeSelect } from "@/components/shared/field";
import { Notice } from "@/components/shared/states";
import { Chip, TrustBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { DataStatus } from "@/features/products/schema";
import { cn } from "@/lib/utils";
import { addClaim, addScene, deleteClaim, deleteScene, moveScene, regenerateScene, updateClaim, updateScene, updateStoryboardText } from "./actions";
import { AiAssistDialog, type AiPromptContext } from "./ai-assist-dialog";
import { claimFactKey } from "./facts";
import { type MediaAsset, SceneMedia } from "./scene-media";
import { estimateSceneSeconds, type ValidationIssue } from "./validate";

export interface EditorFact {
  key: string;
  label: string;
  value: string | null;
  status: DataStatus;
}
export interface EditorClaim {
  id: string;
  text: string;
  fact_id: string | null;
  product_field: string | null;
  review_status: string;
}
export interface EditorScene {
  id: string;
  position: number;
  kind: string;
  narration: string;
  on_screen_text: string;
  visual_note: string;
  text_origin: string;
  asset_id: string | null;
  updated_at: string;
  claims: EditorClaim[];
}

const KIND_LABEL: Record<string, string> = {
  intro: "แนะนำสินค้า",
  feature: "จุดเด่น",
  price: "ราคา",
  cta: "ปิดท้าย / CTA",
  problem: "ปัญหา",
  solution: "ทางแก้",
  unbox: "แกะกล่อง",
  in_box: "ของในกล่อง",
  step: "ขั้นตอน",
  custom: "ฉากเพิ่มเอง",
};
const ORIGIN: Record<string, { label: string; tone: "neutral" | "info" | "warning" }> = {
  template: { label: "จาก template", tone: "neutral" },
  user: { label: "แก้ไขแล้ว", tone: "info" },
  ai: { label: "AI เขียน · ต้องตรวจ", tone: "warning" },
};
const REVIEW: Record<string, { label: string; tone: "neutral" | "success" | "danger" }> = {
  pending: { label: "รอตรวจ", tone: "neutral" },
  verified: { label: "ตรวจแล้ว", tone: "success" },
  rejected: { label: "ปฏิเสธ", tone: "danger" },
};

/** Tracks unsaved sections so leaving the page and approving can warn about them. */
const DirtyContext = createContext<(id: string, dirty: boolean) => void>(() => {});

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) =>
    start(async () => {
      const res = await fn().catch(() => ({ ok: false, error: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ" }));
      if (!res.ok) {
        toast.error(res.error ?? "ไม่สำเร็จ");
        return;
      }
      if (success) toast.success(success);
      router.refresh();
    });
  return { pending, run };
}

function IssueList({ issues }: { issues: ValidationIssue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="flex flex-col gap-1 text-[13px]">
      {issues.map((i, n) => (
        <li key={n} className={cn("flex items-start gap-1.5", i.level === "block" ? "text-destructive" : "text-warning")}>
          <span className="mt-0.5 shrink-0 text-[11px] font-medium">{i.level === "block" ? "ต้องแก้" : "ควรดู"}</span>
          <span className="text-foreground">{i.message}</span>
        </li>
      ))}
    </ul>
  );
}

function FactSelect({ id, value, facts, onChange, disabled }: { id: string; value: string; facts: EditorFact[]; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="w-full sm:w-56">
      <option value="">— ยังไม่อ้างอิง —</option>
      {facts.map((f) => (
        <option key={f.key} value={f.key} disabled={f.status === "unavailable"}>
          {f.label}: {f.value ? (f.value.length > 40 ? `${f.value.slice(0, 39)}…` : f.value) : "ไม่มีข้อมูล"}
          {f.status === "stale" ? " (เก่า)" : f.status === "ai_estimate" ? " (AI ประมาณ)" : ""}
        </option>
      ))}
    </NativeSelect>
  );
}

function ClaimRow({ claim, facts, locked }: { claim: EditorClaim; facts: EditorFact[]; locked: boolean }) {
  const { pending, run } = useRun();
  const [text, setText] = useState(claim.text);
  const key = claimFactKey(claim) ?? "";
  const fact = facts.find((f) => f.key === key);
  const review = REVIEW[claim.review_status] ?? REVIEW.pending;

  if (locked) {
    return (
      <li className="flex flex-col gap-1 px-3 py-2">
        <span>{claim.text}</span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Chip tone={review.tone}>{review.label}</Chip>
          {fact ? `อ้างอิง: ${fact.label} — ${fact.value ?? "ไม่มีข้อมูล"}` : "ไม่ได้อ้างอิง"}
        </span>
      </li>
    );
  }
  return (
    <li className="flex flex-col gap-2 px-3 py-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Label htmlFor={`claim-${claim.id}`} className="sr-only">
          ข้อความ claim
        </Label>
        <Input
          id={`claim-${claim.id}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text.trim() && text !== claim.text && run(() => updateClaim(claim.id, { text }))}
          maxLength={300}
          className="min-w-0 flex-1"
        />
        <Label htmlFor={`claim-fact-${claim.id}`} className="sr-only">
          ข้อเท็จจริงที่อ้างอิง
        </Label>
        <FactSelect id={`claim-fact-${claim.id}`} value={key} facts={facts} disabled={pending} onChange={(v) => run(() => updateClaim(claim.id, { factKey: v || null }))} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Chip tone={review.tone}>{review.label}</Chip>
        {fact?.value && <span className="min-w-0 text-muted-foreground">อ้างอิง: {fact.value.length > 80 ? `${fact.value.slice(0, 79)}…` : fact.value}</span>}
        {fact && fact.status !== "user_provided" && <TrustBadge status={fact.status} />}
        <span className="ml-auto flex gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={pending || claim.review_status === "verified" || !key}
            title={!key ? "เลือกข้อเท็จจริงก่อน" : undefined}
            onClick={() => run(() => updateClaim(claim.id, { review_status: "verified" }))}
          >
            <Check aria-hidden /> ตรงกับข้อเท็จจริง
          </Button>
          <Button size="sm" variant="ghost" disabled={pending || claim.review_status === "rejected"} onClick={() => run(() => updateClaim(claim.id, { review_status: "rejected" }))}>
            <X aria-hidden /> ปฏิเสธ
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive-subtle hover:text-destructive" disabled={pending} onClick={() => run(() => deleteClaim(claim.id))} aria-label="ลบ claim">
            <Trash2 aria-hidden />
          </Button>
        </span>
      </div>
    </li>
  );
}

function AddClaim({ sceneId, facts }: { sceneId: string; facts: EditorFact[] }) {
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [factKey, setFactKey] = useState("");
  if (!open) {
    return (
      <Button size="sm" variant="ghost" className="self-start" onClick={() => setOpen(true)}>
        <Plus aria-hidden /> เพิ่ม claim
      </Button>
    );
  }
  return (
    <form
      className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        run(async () => {
          const res = await addClaim(sceneId, { text, factKey: factKey || null });
          if (res.ok) {
            setText("");
            setFactKey("");
            setOpen(false);
          }
          return res;
        });
      }}
    >
      <Label htmlFor={`new-claim-${sceneId}`} className="sr-only">
        ข้อความ claim ใหม่
      </Label>
      <Input id={`new-claim-${sceneId}`} value={text} onChange={(e) => setText(e.target.value)} placeholder="ข้อความที่ฉากนี้กล่าวอ้าง" maxLength={300} className="min-w-0 flex-1" autoFocus />
      <Label htmlFor={`new-claim-fact-${sceneId}`} className="sr-only">
        ข้อเท็จจริงที่อ้างอิง
      </Label>
      <FactSelect id={`new-claim-fact-${sceneId}`} value={factKey} facts={facts} onChange={setFactKey} />
      <span className="flex gap-1">
        <Button type="submit" size="sm" disabled={pending || !text.trim()}>
          เพิ่ม
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          ยกเลิก
        </Button>
      </span>
    </form>
  );
}

function SceneCard({
  scene,
  count,
  facts,
  issues,
  locked,
  promptContext,
  assets,
}: {
  scene: EditorScene;
  count: number;
  facts: EditorFact[];
  issues: ValidationIssue[];
  locked: boolean;
  promptContext: AiPromptContext;
  assets: MediaAsset[];
}) {
  const { pending, run } = useRun();
  const markDirty = useContext(DirtyContext);
  const [v, setV] = useState({ narration: scene.narration, on_screen_text: scene.on_screen_text, visual_note: scene.visual_note });
  const dirty = v.narration !== scene.narration || v.on_screen_text !== scene.on_screen_text || v.visual_note !== scene.visual_note;
  useEffect(() => markDirty(scene.id, dirty), [dirty, markDirty, scene.id]);
  useEffect(() => () => markDirty(scene.id, false), [markDirty, scene.id]);
  const origin = ORIGIN[scene.text_origin] ?? ORIGIN.template;
  const n = scene.position + 1;
  const hasBlock = issues.some((i) => i.level === "block");

  return (
    <li id={`scene-${scene.id}`} className={cn("rounded-lg border bg-surface", hasBlock && "border-destructive/40")}>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <h3 className="font-semibold">ฉากที่ {n}</h3>
        <span className="text-[13px] text-muted-foreground">{KIND_LABEL[scene.kind] ?? scene.kind}</span>
        <span className="text-xs text-muted-foreground tabular-nums">~{estimateSceneSeconds(v.narration)} วิ</span>
        <Chip tone={origin.tone}>{origin.label}</Chip>
        {!locked && (
          <span className="ml-auto flex gap-0.5">
            <AiAssistDialog
              sceneId={scene.id}
              scene={{
                position: scene.position,
                total: count,
                kindLabel: KIND_LABEL[scene.kind] ?? scene.kind,
                narration: scene.narration,
                on_screen_text: scene.on_screen_text,
                visual_note: scene.visual_note,
                estSeconds: estimateSceneSeconds(scene.narration),
              }}
              facts={facts}
              context={promptContext}
              disabled={pending || dirty}
            />
            <Button size="sm" variant="ghost" disabled={pending || n === 1} onClick={() => run(() => moveScene(scene.id, "up"))} aria-label={`เลื่อนฉากที่ ${n} ขึ้น`}>
              <ArrowUp aria-hidden />
            </Button>
            <Button size="sm" variant="ghost" disabled={pending || n === count} onClick={() => run(() => moveScene(scene.id, "down"))} aria-label={`เลื่อนฉากที่ ${n} ลง`}>
              <ArrowDown aria-hidden />
            </Button>
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="ghost" disabled={pending} aria-label={`สร้างฉากที่ ${n} ใหม่จาก template`}>
                  <RotateCcw aria-hidden /> <span className="hidden sm:inline">สร้างใหม่</span>
                </Button>
              }
              title={`สร้างฉากที่ ${n} ใหม่จาก template?`}
              description="ข้อความและ claim ของฉากนี้จะถูกแทนด้วยฉบับจาก template ตามข้อเท็จจริงล่าสุด ฉากอื่นไม่เปลี่ยน"
              confirmLabel="สร้างใหม่"
              onConfirm={async () => {
                const res = await regenerateScene(scene.id);
                if (!res.ok) return res.error;
                setV({ narration: scene.narration, on_screen_text: scene.on_screen_text, visual_note: scene.visual_note });
                run(async () => ({ ok: true }), "สร้างฉากใหม่แล้ว");
              }}
            />
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive-subtle hover:text-destructive" disabled={pending || count === 1} aria-label={`ลบฉากที่ ${n}`}>
                  <Trash2 aria-hidden />
                </Button>
              }
              title={`ลบฉากที่ ${n}?`}
              description="ข้อความและ claim ทั้งหมดของฉากนี้จะถูกลบ"
              confirmLabel="ลบฉาก"
              onConfirm={async () => {
                const res = await deleteScene(scene.id);
                if (!res.ok) return res.error;
                run(async () => ({ ok: true }), "ลบฉากแล้ว");
              }}
            />
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3 p-4">
        {issues.length > 0 && <IssueList issues={issues} />}
        {locked ? (
          <dl className="grid gap-2 text-[13px] sm:grid-cols-[120px_1fr]">
            <dt className="text-muted-foreground">คำพูด</dt>
            <dd className="whitespace-pre-wrap">{scene.narration || "—"}</dd>
            <dt className="text-muted-foreground">ข้อความบนจอ</dt>
            <dd>{scene.on_screen_text || "—"}</dd>
            <dt className="text-muted-foreground">ภาพ</dt>
            <dd className="text-muted-foreground">{scene.visual_note || "—"}</dd>
          </dl>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => updateScene(scene.id, v), `บันทึกฉากที่ ${n} แล้ว`);
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`narration-${scene.id}`} className="text-[13px]">
                คำพูด (เสียงพากย์)
              </Label>
              <Textarea id={`narration-${scene.id}`} value={v.narration} onChange={(e) => setV({ ...v, narration: e.target.value })} rows={3} maxLength={1000} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`onscreen-${scene.id}`} className="text-[13px]">
                  ข้อความบนจอ
                </Label>
                <Input id={`onscreen-${scene.id}`} value={v.on_screen_text} onChange={(e) => setV({ ...v, on_screen_text: e.target.value })} maxLength={200} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`visual-${scene.id}`} className="text-[13px]">
                  ภาพที่ใช้
                </Label>
                <Input id={`visual-${scene.id}`} value={v.visual_note} onChange={(e) => setV({ ...v, visual_note: e.target.value })} maxLength={500} />
              </div>
            </div>
            {dirty && (
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm" disabled={pending}>
                  {pending ? "กำลังบันทึก…" : "บันทึกฉาก"}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setV({ narration: scene.narration, on_screen_text: scene.on_screen_text, visual_note: scene.visual_note })}>
                  ยกเลิกการแก้
                </Button>
                <span className="text-xs text-warning">ยังไม่ได้บันทึก</span>
              </div>
            )}
          </form>
        )}

        <SceneMedia sceneId={scene.id} sceneNumber={n} assetId={scene.asset_id} assets={assets} locked={locked} />

        <div className="rounded-md border">
          <p className="border-b bg-surface-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">Claim ในฉากนี้ ({scene.claims.length}) — ทุกข้อต้องอ้างอิงข้อเท็จจริงและตรวจแล้ว</p>
          {scene.claims.length > 0 ? (
            <ul className="divide-y text-[13px]">
              {scene.claims.map((c) => (
                <ClaimRow key={`${c.id}-${c.text}`} claim={c} facts={facts} locked={locked} />
              ))}
            </ul>
          ) : (
            <p className="px-3 py-2 text-[13px] text-muted-foreground">ไม่มี claim — ถ้าฉากนี้กล่าวถึงคุณสมบัติ ราคา หรือตัวเลข ให้เพิ่ม claim</p>
          )}
          {!locked && <AddClaim sceneId={scene.id} facts={facts} />}
        </div>
      </div>
    </li>
  );
}

function TextSection({ storyboardId, hook, caption, cta, locked, issues }: { storyboardId: string; hook: string; caption: string; cta: string; locked: boolean; issues: ValidationIssue[] }) {
  const { pending, run } = useRun();
  const markDirty = useContext(DirtyContext);
  const [v, setV] = useState({ hook, caption, cta });
  const dirty = v.hook !== hook || v.caption !== caption || v.cta !== cta;
  useEffect(() => markDirty("text", dirty), [dirty, markDirty]);

  if (locked) {
    return (
      <dl className="grid gap-2 rounded-lg border bg-surface p-4 text-[13px] sm:grid-cols-[120px_1fr]">
        <dt className="text-muted-foreground">Hook</dt>
        <dd className="font-medium">{hook}</dd>
        <dt className="text-muted-foreground">แคปชัน</dt>
        <dd className="whitespace-pre-wrap">{caption}</dd>
        <dt className="text-muted-foreground">CTA</dt>
        <dd>{cta}</dd>
      </dl>
    );
  }
  return (
    <form
      className="flex flex-col gap-3 rounded-lg border bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateStoryboardText(storyboardId, v), "บันทึกแล้ว");
      }}
    >
      {issues.length > 0 && <IssueList issues={issues} />}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="hook" className="text-[13px]">
          Hook (3 วินาทีแรก)
        </Label>
        <Input id="hook" value={v.hook} onChange={(e) => setV({ ...v, hook: e.target.value })} maxLength={300} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="caption" className="text-[13px]">
          แคปชันโพสต์
        </Label>
        <Textarea id="caption" value={v.caption} onChange={(e) => setV({ ...v, caption: e.target.value })} rows={2} maxLength={2200} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cta" className="text-[13px]">
          CTA
        </Label>
        <Input id="cta" value={v.cta} onChange={(e) => setV({ ...v, cta: e.target.value })} maxLength={300} />
      </div>
      {dirty && (
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "กำลังบันทึก…" : "บันทึก"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setV({ hook, caption, cta })}>
            ยกเลิกการแก้
          </Button>
          <span className="text-xs text-warning">ยังไม่ได้บันทึก</span>
        </div>
      )}
    </form>
  );
}

export function StudioEditor({
  storyboardId,
  hook,
  caption,
  cta,
  disclosure,
  scenes,
  facts,
  issues,
  locked,
  promptContext,
  assets,
  onDirtyChange,
}: {
  storyboardId: string;
  hook: string;
  caption: string;
  cta: string;
  disclosure: string;
  scenes: EditorScene[];
  facts: EditorFact[];
  issues: ValidationIssue[];
  locked: boolean;
  promptContext: AiPromptContext;
  assets: MediaAsset[];
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { pending, run } = useRun();
  const dirtySet = useRef(new Set<string>());
  const markDirty = useCallback(
    (id: string, dirty: boolean) => {
      const had = dirtySet.current.size > 0;
      if (dirty) dirtySet.current.add(id);
      else dirtySet.current.delete(id);
      const has = dirtySet.current.size > 0;
      if (had !== has) onDirtyChange?.(has);
    },
    [onDirtyChange],
  );
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtySet.current.size) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const textIssues = issues.filter((i) => !i.sceneId && /^(Hook|แคปชัน|CTA)/.test(i.message));

  return (
    <DirtyContext.Provider value={markDirty}>
      <div className="flex flex-col gap-8">
        <section aria-labelledby="text-h">
          <h2 id="text-h" className="mb-3 text-base font-semibold">
            Hook แคปชัน และ CTA
          </h2>
          <TextSection key={`${hook}|${caption}|${cta}`} storyboardId={storyboardId} hook={hook} caption={caption} cta={cta} locked={locked} issues={textIssues} />
        </section>

        <section aria-labelledby="scenes-h">
          <h2 id="scenes-h" className="mb-3 text-base font-semibold">
            ฉาก ({scenes.length})
          </h2>
          <ol className="flex flex-col gap-3">
            {scenes.map((s) => (
              <SceneCard key={`${s.id}-${s.updated_at}`} scene={s} count={scenes.length} facts={facts} issues={issues.filter((i) => i.sceneId === s.id)} locked={locked} promptContext={promptContext} assets={assets} />
            ))}
          </ol>
          {!locked && (
            <Button variant="outline" className="mt-3" disabled={pending} onClick={() => run(() => addScene(storyboardId, scenes.length - 2), "เพิ่มฉากแล้ว")}>
              <Plus aria-hidden /> เพิ่มฉากก่อนฉากปิดท้าย
            </Button>
          )}
        </section>

        <section aria-labelledby="disclosure-h">
          <h2 id="disclosure-h" className="mb-3 flex items-center gap-1.5 text-base font-semibold">
            <Lock className="size-4 text-muted-foreground" aria-hidden /> การเปิดเผยลิงก์ affiliate
          </h2>
          <Notice tone="info">
            <p>{disclosure}</p>
            <p className="mt-1 text-xs text-muted-foreground">ข้อความนี้ใส่ในแคปชันและท้ายวิดีโอเสมอ แก้หรือลบไม่ได้</p>
          </Notice>
        </section>
      </div>
    </DirtyContext.Provider>
  );
}
