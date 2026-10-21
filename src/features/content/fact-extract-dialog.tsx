"use client";

import { Copy, ExternalLink, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Notice } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addExtractedFacts } from "./actions";
import { aiExtractFacts } from "./ai-actions";
import { buildFactExtractPrompt, type ExtractedFact, MAX_DESCRIPTION_CHARS, MAX_EXTRACTED_FACTS, type ParsedFact, parseFactReply } from "./fact-extract";

/**
 * Facts from the product description with manual AI help (no API key): paste the description,
 * copy a prompt to any AI chat, paste the reply back, pick the facts to keep. They are saved as
 * "AI ประมาณการ" and must be confirmed one by one before a script can use them.
 */
export function FactExtractDialog({
  productId,
  productName,
  description: initialDescription,
  existing,
  aiReady,
  imageCount,
}: {
  productId: string;
  productName: string;
  description: string | null;
  existing: ExtractedFact[];
  /** OpenRouter is configured: offer a direct call next to copy/paste. */
  aiReady: boolean;
  imageCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [reply, setReply] = useState("");
  // Facts from a direct API call; replaced by a pasted reply when the user pastes one.
  const [aiFacts, setAiFacts] = useState<{ facts: ParsedFact[]; note: string } | null>(null);
  const [useImages, setUseImages] = useState(imageCount > 0);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [aiPending, startAi] = useTransition();

  const pasted = useMemo(() => (reply.trim() ? parseFactReply(reply, description, existing) : null), [reply, description, existing]);
  const parsed = pasted ?? (aiFacts ? { facts: aiFacts.facts, error: null } : null);

  function runAi() {
    if (!description.trim()) return setError("วางคำอธิบายสินค้าก่อน");
    startAi(async () => {
      setError(null);
      const res = await aiExtractFacts(productId, { description, useImages: useImages && imageCount > 0 }).catch(() => ({ ok: false as const, error: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ" }));
      if (!res.ok) return setError(res.error);
      setReply("");
      setSkipped(new Set());
      setAiFacts({ facts: res.data.facts, note: `AI อ่าน${res.data.images ? `คำอธิบายและรูป ${res.data.images} รูป` : "คำอธิบาย"} · ค่าใช้จ่าย ฿${res.data.costThb.toFixed(4)}` });
    });
  }
  const chosen = parsed?.facts.filter((f, i) => !f.problem && !skipped.has(i)) ?? [];

  async function copyPrompt() {
    if (!description.trim()) return setError("วางคำอธิบายสินค้าก่อน");
    setError(null);
    try {
      await navigator.clipboard.writeText(buildFactExtractPrompt(productName, description, existing));
      toast.success("คัดลอกคำสั่งแล้ว — วางในแชท AI");
    } catch {
      toast.error("คัดลอกไม่สำเร็จ — เบราว์เซอร์ไม่อนุญาตให้เข้าถึงคลิปบอร์ด");
    }
  }

  function save() {
    start(async () => {
      setError(null);
      const res = await addExtractedFacts(productId, { description, facts: chosen.slice(0, MAX_EXTRACTED_FACTS) }).catch(() => ({ ok: false as const, error: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ" }));
      if (!res.ok) return setError(res.error);
      toast.success(`เพิ่ม ${res.data.added} ข้อแล้ว — ตรวจกับหน้าสินค้าแล้วกด “ยืนยันแล้ว” ทีละข้อ`);
      setOpen(false);
      setReply("");
      setAiFacts(null);
      setSkipped(new Set());
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Sparkles aria-hidden /> ดึงจากรายละเอียด
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>ดึงข้อเท็จจริงจากรายละเอียดสินค้า</DialogTitle>
          <DialogDescription>ใช้แชท AI ที่คุณมี (เช่น Claude ที่ claude.ai) แยกคำอธิบายสินค้าเป็นข้อเท็จจริง ข้อที่ได้จะเป็น “AI ประมาณการ” จนกว่าคุณจะตรวจกับหน้าสินค้าแล้วกดยืนยัน</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-2">
            <Label htmlFor="extract-description" className="text-[13px] font-semibold">
              1. คำอธิบายสินค้า
            </Label>
            <Textarea
              id="extract-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              maxLength={MAX_DESCRIPTION_CHARS}
              placeholder="คัดลอกส่วน “รายละเอียดสินค้า” และ “ข้อมูลจำเพาะ” จากหน้าสินค้ามาวางที่นี่"
            />
            {aiReady && (
              <div className="flex flex-col gap-2 rounded-md border bg-surface-muted p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="button" onClick={runAi} disabled={aiPending}>
                    <Sparkles aria-hidden /> {aiPending ? "AI กำลังอ่าน…" : "ให้ AI ดึงเลย"}
                  </Button>
                  {imageCount > 0 && (
                    <label className="flex items-center gap-2 text-[13px]">
                      <input type="checkbox" checked={useImages} onChange={(e) => setUseImages(e.target.checked)} /> อ่านรูปสินค้าด้วย ({imageCount} รูป — สเปกที่พิมพ์บนรูป)
                    </label>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">เรียก AI ผ่าน OpenRouter (โมเดลตามหน้าตั้งค่า) ปกติไม่ถึง ฿0.10 ต่อครั้ง · หรือคัดลอกคำสั่งไปแชท AI ด้านล่างแทนได้</p>
              </div>
            )}
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
            <Label htmlFor="extract-reply" className="text-[13px] font-semibold">
              2. วางคำตอบจาก AI
            </Label>
            <Textarea id="extract-reply" value={reply} onChange={(e) => {
                setReply(e.target.value);
                setSkipped(new Set());
              }} rows={5} placeholder={"FACT: บลูทูธ | Bluetooth 6.1\nFACT: กันน้ำ | IP55"} />
            {parsed?.error && <Notice tone="error">{parsed.error}</Notice>}
            {!pasted && aiFacts && <p className="text-xs text-muted-foreground">{aiFacts.note}</p>}
            {parsed && !parsed.error && (
              <ul className="divide-y rounded-md border bg-surface text-[13px]" aria-label="ข้อเท็จจริงที่ดึงได้">
                {parsed.facts.map((f, i) => (
                  <li key={i} className="flex items-start gap-3 px-3 py-2">
                    <input
                      type="checkbox"
                      id={`extract-${i}`}
                      className="mt-1"
                      checked={!f.problem && !skipped.has(i)}
                      disabled={!!f.problem}
                      onChange={(e) => {
                        const next = new Set(skipped);
                        if (e.target.checked) next.delete(i);
                        else next.add(i);
                        setSkipped(next);
                      }}
                    />
                    <label htmlFor={`extract-${i}`} className="min-w-0">
                      <span className="text-muted-foreground">{f.label}:</span> <span className={f.problem ? "line-through" : "font-medium"}>{f.value}</span>
                      {f.source === "image" && !f.problem && <span className="block text-xs text-warning">อ่านจากรูป — ตัวเลขตรวจกับคำอธิบายไม่ได้ ดูรูปก่อนยืนยัน</span>}
                      {f.problem && <span className="block text-xs text-warning">ไม่เพิ่ม — {f.problem}</span>}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {error && <Notice tone="error">{error}</Notice>}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center">
          <p className="text-xs text-muted-foreground sm:mr-auto">ข้อที่มีตัวเลขไม่ตรงกับคำอธิบายจะไม่ถูกเพิ่ม สคริปต์ใช้ข้อที่ยังไม่ยืนยันไม่ได้</p>
          <Button type="button" onClick={save} disabled={pending || !chosen.length}>
            {pending ? "กำลังบันทึก…" : `เพิ่ม ${chosen.length} ข้อ`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
