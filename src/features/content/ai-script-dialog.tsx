"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Notice } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { applyAiScript } from "./actions";
import { aiDraftScript } from "./ai-actions";
import type { ScriptDraft } from "./ai-script";

/**
 * "ให้ AI เขียนทั้งสคริปต์": one API call writes hook, every scene, CTA and caption. The draft is
 * previewed first; applying replaces the current text and claims, and every claim starts "pending".
 */
export function AiScriptDialog({ storyboardId, facts, disabled }: { storyboardId: string; facts: { key: string; label: string }[]; disabled?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [draft, setDraft] = useState<{ draft: ScriptDraft; warnings: string[]; costThb: number } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [writing, startWrite] = useTransition();
  const [applying, startApply] = useTransition();
  const labelOf = useMemo(() => new Map(facts.map((f) => [f.key, f.label])), [facts]);

  function write(confirmed = false) {
    startWrite(async () => {
      setError(null);
      setConfirm(null);
      const res = await aiDraftScript(storyboardId, { instruction, confirmed }).catch(() => ({ ok: false as const, error: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ" }));
      if (!res.ok) {
        if ("needsConfirm" in res && res.needsConfirm) setConfirm(res.error);
        else setError(res.error);
        return;
      }
      setDraft(res.data);
    });
  }

  function apply() {
    if (!draft) return;
    startApply(async () => {
      setError(null);
      const res = await applyAiScript(storyboardId, draft.draft).catch(() => ({ ok: false as const, error: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ" }));
      if (!res.ok) return setError(res.error);
      toast.success("ใช้สคริปต์จาก AI แล้ว — ตรวจ claim ทุกข้อก่อนอนุมัติ");
      setOpen(false);
      setDraft(null);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full" disabled={disabled} title={disabled ? "บันทึกหรือยกเลิกการแก้ไขก่อน" : undefined}>
          <Sparkles aria-hidden /> ให้ AI เขียนทั้งสคริปต์
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>ให้ AI เขียนทั้งสคริปต์</DialogTitle>
          <DialogDescription>AI เขียน hook ทุกฉาก CTA และแคปชัน จากข้อเท็จจริงที่ยืนยันแล้วเท่านั้น ดูตัวอย่างก่อนกดใช้ — claim ทุกข้อต้องตรวจก่อนอนุมัติ</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Label htmlFor="ai-script-instruction" className="text-[13px] font-normal">
            ต้องการแนวไหน <span className="text-muted-foreground">(ไม่บังคับ)</span>
          </Label>
          <Input id="ai-script-instruction" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="เช่น เปิดด้วยคำถาม, เน้นคนทำงานออฟฟิศ, ตลกนิดๆ" maxLength={300} />
          <Button type="button" className="self-start" onClick={() => write()} disabled={writing}>
            <Sparkles aria-hidden /> {writing ? "AI กำลังเขียน…" : draft ? "เขียนใหม่" : "เขียนเลย"}
          </Button>
          <p className="text-xs text-muted-foreground">เรียก AI ผ่าน OpenRouter ตามโมเดล “เขียนสคริปต์” ในหน้าตั้งค่า ปกติไม่ถึง ฿1 ต่อครั้ง</p>
          {confirm && (
            <Notice tone="warning">
              {confirm}{" "}
              <Button size="sm" variant="outline" onClick={() => write(true)} disabled={writing}>
                ยืนยันและเขียน
              </Button>
            </Notice>
          )}
          {error && <Notice tone="error">{error}</Notice>}

          {draft && (
            <div className="flex flex-col gap-3 rounded-md border bg-surface-muted p-3 text-[13px]" aria-label="ตัวอย่างสคริปต์จาก AI">
              <p className="text-xs text-muted-foreground">ค่าใช้จ่ายครั้งนี้ ฿{draft.costThb.toFixed(4)}</p>
              <p>
                <span className="text-muted-foreground">Hook: </span>
                <span className="font-medium">{draft.draft.hook || "—"}</span>
              </p>
              <ol className="flex flex-col gap-2">
                {draft.draft.scenes.map((s, i) => (
                  <li key={i} className="rounded border bg-surface p-2">
                    <p className="text-xs font-semibold">ฉากที่ {i + 1}</p>
                    <p className="whitespace-pre-wrap">{s.narration}</p>
                    {s.on_screen_text && <p className="text-xs text-muted-foreground">บนจอ: {s.on_screen_text}</p>}
                    {s.visual_note && <p className="text-xs text-muted-foreground">ภาพ: {s.visual_note}</p>}
                    {s.claims.length > 0 && (
                      <ul className="mt-1 text-xs">
                        {s.claims.map((c, j) => (
                          <li key={j}>
                            • {c.text} <span className="text-muted-foreground">→ {c.factKey ? labelOf.get(c.factKey) : "ยังไม่อ้างอิง"}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
              <p>
                <span className="text-muted-foreground">CTA: </span>
                {draft.draft.cta || "—"}
              </p>
              <p className="whitespace-pre-wrap">
                <span className="text-muted-foreground">แคปชัน: </span>
                {draft.draft.caption || "—"}
              </p>
              {draft.warnings.map((w) => (
                <p key={w} className="text-xs text-warning">
                  {w}
                </p>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center">
          <p className="text-xs text-muted-foreground sm:mr-auto">ข้อความ claim hook CTA และแคปชันเดิมจะถูกแทนที่ (ข้อความเปิดเผย affiliate คงเดิม)</p>
          <Button type="button" onClick={apply} disabled={!draft || applying || writing}>
            {applying ? "กำลังบันทึก…" : "ใช้สคริปต์นี้"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
