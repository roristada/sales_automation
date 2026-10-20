"use client";

import { Copy, ExternalLink, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Notice } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { applyAiSceneText } from "./actions";
import { buildScenePrompt, parseSceneReply, type PromptContext, promptFacts, type PromptScene } from "./ai-prompt";
import type { Fact } from "./facts";

export type AiPromptContext = Omit<PromptContext, "instruction">;

/**
 * Manual AI help: copy a prompt to use in any AI chat (e.g. a Claude subscription at claude.ai),
 * then paste the reply back. No API key; the reply is checked like any other text.
 */
export function AiAssistDialog({ sceneId, scene, facts, context, disabled }: { sceneId: string; scene: PromptScene; facts: Fact[]; context: AiPromptContext; disabled?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [reply, setReply] = useState("");
  // Fact codes as offered in the copied prompt, so a later fact change can't shift F-numbers.
  const [codes, setCodes] = useState<Map<string, string> | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const currentCodes = useMemo(() => new Map(promptFacts(facts).map(({ code, fact }) => [code, fact.key])), [facts]);
  const labelOf = useMemo(() => new Map(facts.map((f) => [f.key, f.label])), [facts]);
  const parsed = reply.trim() ? parseSceneReply(reply, codes ?? currentCodes) : null;
  const n = scene.position + 1;

  async function copyPrompt() {
    const text = buildScenePrompt({ ...context, instruction }, scene, facts);
    try {
      await navigator.clipboard.writeText(text);
      setCodes(currentCodes);
      toast.success("คัดลอกคำสั่งแล้ว — วางในแชท AI");
    } catch {
      toast.error("คัดลอกไม่สำเร็จ — เบราว์เซอร์ไม่อนุญาตให้เข้าถึงคลิปบอร์ด");
    }
  }

  function apply() {
    if (!parsed?.ok) return;
    start(async () => {
      setError(null);
      const res = await applyAiSceneText(sceneId, parsed.value).catch(() => ({ ok: false as const, error: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ" }));
      if (!res.ok) return setError(res.error);
      toast.success(`ใช้ข้อความจาก AI ในฉากที่ ${n} แล้ว — ตรวจ claim อีกครั้ง`);
      setOpen(false);
      setReply("");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" disabled={disabled} aria-label={`AI ช่วยเขียนฉากที่ ${n}`} title={disabled ? "บันทึกหรือยกเลิกการแก้ไขก่อน" : undefined}>
          <Sparkles aria-hidden /> <span className="hidden sm:inline">AI ช่วยเขียน</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>AI ช่วยเขียนฉากที่ {n}</DialogTitle>
          <DialogDescription>คัดลอกคำสั่งไปใช้ในแชท AI ที่คุณมี (เช่น Claude ที่ claude.ai) แล้ววางคำตอบกลับมาที่นี่ คำสั่งมีข้อเท็จจริงของสินค้าและกฎห้ามแต่งข้อมูลอยู่แล้ว</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold">1. คัดลอกคำสั่ง</h3>
            <Label htmlFor={`ai-instruction-${sceneId}`} className="text-[13px] font-normal">
              ต้องการให้ปรับอย่างไร <span className="text-muted-foreground">(ไม่บังคับ)</span>
            </Label>
            <Input id={`ai-instruction-${sceneId}`} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="เช่น สั้นลง, เป็นกันเองขึ้น, เปิดด้วยคำถาม" maxLength={200} />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={copyPrompt}>
                <Copy aria-hidden /> คัดลอกคำสั่ง
              </Button>
              <Button asChild variant="ghost">
                <a href="https://claude.ai/new" target="_blank" rel="noopener noreferrer">
                  เปิด claude.ai <ExternalLink aria-hidden />
                  <span className="sr-only">(เปิดในแท็บใหม่)</span>
                </a>
              </Button>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold">2. วางคำตอบจาก AI</h3>
            <Label htmlFor={`ai-reply-${sceneId}`} className="sr-only">
              คำตอบจาก AI
            </Label>
            <Textarea id={`ai-reply-${sceneId}`} value={reply} onChange={(e) => setReply(e.target.value)} rows={6} placeholder={"คำพูด: …\nข้อความบนจอ: …\nภาพ: …\nCLAIM: … | F1"} />
            {parsed && !parsed.ok && (
              <Notice tone="error">
                <ul className="list-disc pl-4">
                  {parsed.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </Notice>
            )}
            {parsed?.ok && (
              <div className="rounded-md border bg-surface-muted p-3 text-[13px]">
                <dl className="grid gap-1 sm:grid-cols-[110px_1fr]">
                  <dt className="text-muted-foreground">คำพูด</dt>
                  <dd className="whitespace-pre-wrap">{parsed.value.narration}</dd>
                  <dt className="text-muted-foreground">ข้อความบนจอ</dt>
                  <dd>{parsed.value.on_screen_text || "—"}</dd>
                  <dt className="text-muted-foreground">ภาพ</dt>
                  <dd>{parsed.value.visual_note || "—"}</dd>
                  <dt className="text-muted-foreground">Claim</dt>
                  <dd>
                    {parsed.value.claims.length ? (
                      <ul className="flex flex-col gap-0.5">
                        {parsed.value.claims.map((c, i) => (
                          <li key={i}>
                            {c.text} <span className="text-muted-foreground">→ {c.factKey ? labelOf.get(c.factKey) : "ยังไม่อ้างอิง"}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      "ไม่มี"
                    )}
                  </dd>
                </dl>
                {parsed.warnings.map((w) => (
                  <p key={w} className="mt-1 text-xs text-warning">
                    {w}
                  </p>
                ))}
              </div>
            )}
          </section>
          {error && <Notice tone="error">{error}</Notice>}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center">
          <p className="text-xs text-muted-foreground sm:mr-auto">ข้อความและ claim เดิมของฉากนี้จะถูกแทนที่ claim ใหม่ทุกข้อต้องตรวจก่อนอนุมัติ</p>
          <Button type="button" onClick={apply} disabled={pending || !parsed?.ok}>
            {pending ? "กำลังบันทึก…" : "ใช้ข้อความนี้"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
