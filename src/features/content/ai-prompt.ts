import type { Fact } from "./facts";

/**
 * Manual AI help without an API key: build a prompt the user pastes into any AI chat
 * (e.g. their Claude subscription at claude.ai), then parse the reply they paste back.
 * The reply goes through the same checks as any text: claims start "pending", origin "ai".
 */

export interface PromptScene {
  position: number;
  total: number;
  kindLabel: string;
  narration: string;
  on_screen_text: string;
  visual_note: string;
  estSeconds: number;
}

export interface PromptContext {
  productName: string;
  templateName: string;
  platformLabel: string;
  targetSeconds: number;
  instruction: string;
}

/** Facts offered to the AI, numbered F1..Fn. Unavailable facts are left out. */
export function promptFacts(facts: Fact[]): { code: string; fact: Fact }[] {
  return facts.filter((f) => f.status !== "unavailable" && f.value).map((fact, i) => ({ code: `F${i + 1}`, fact }));
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** Thai speech at ~11 base characters per second (same estimate as validate.ts). */
const charsFor = (seconds: number) => Math.max(15, Math.round(seconds * 11));

export function buildScenePrompt(ctx: PromptContext, scene: PromptScene, facts: Fact[]): string {
  const list = promptFacts(facts);
  // The scene's fair share of the target length, or its current length if that is longer.
  const seconds = Math.round(Math.max(scene.estSeconds, ctx.targetSeconds / Math.max(1, scene.total)) * 10) / 10;
  const factLines = list.length
    ? list
        .map(({ code, fact }) => {
          const note = fact.status === "stale" ? " (ข้อมูลเก่า — หลีกเลี่ยง)" : fact.status === "ai_estimate" ? " (ค่าประมาณ — หลีกเลี่ยง)" : "";
          return `[${code}] ${fact.label}: ${clip(fact.value!, 300)}${note}`;
        })
        .join("\n")
    : "(ไม่มี — ห้ามกล่าวถึงคุณสมบัติ ราคา หรือตัวเลขใดๆ)";

  return `ช่วยเขียนบทสำหรับวิดีโอสั้นแนวตั้ง (${ctx.platformLabel} ความยาวทั้งคลิปประมาณ ${ctx.targetSeconds} วินาที) ที่แนะนำสินค้าผ่านลิงก์ affiliate

สินค้า: ${ctx.productName}
รูปแบบคลิป: ${ctx.templateName}
ฉากนี้: ฉากที่ ${scene.position + 1} จาก ${scene.total} (${scene.kindLabel})
ความยาวฉากนี้: ประมาณ ${seconds} วินาที (บทพูดไม่เกินประมาณ ${charsFor(seconds)} ตัวอักษร)

ข้อเท็จจริงที่ใช้ได้ (ห้ามใช้ข้อมูลอื่นนอกจากนี้):
${factLines}

ข้อความฉากปัจจุบัน:
คำพูด: ${scene.narration || "-"}
ข้อความบนจอ: ${scene.on_screen_text || "-"}
ภาพ: ${scene.visual_note || "-"}

สิ่งที่ต้องการ: ${ctx.instruction.trim() || "เขียนใหม่ให้เป็นธรรมชาติ น่าฟัง กระชับ"}

กฎ:
- ภาษาไทยแบบพูด เป็นกันเอง กระชับ
- พูดถึงคุณสมบัติ ราคา หรือตัวเลขได้เฉพาะที่อยู่ในข้อเท็จจริงด้านบน ห้ามเพิ่มสเปก ตัวเลข หรือผลลัพธ์ที่ไม่มีในรายการ
- ห้ามอ้างว่าดีที่สุด ขายดี รับประกันผล หรือเปรียบเทียบกับแบรนด์อื่น
- ถ้าพูดถึงราคา ให้บอกว่าราคาอาจเปลี่ยนได้
- ไม่ต้องเขียนข้อความเปิดเผยลิงก์ affiliate (ระบบใส่ให้แล้ว)
- ทุกประโยคที่กล่าวถึงข้อเท็จจริง ให้ใส่บรรทัด CLAIM พร้อมรหัสข้อเท็จจริงที่ใช้

ตอบในรูปแบบนี้เท่านั้น ไม่ต้องอธิบายเพิ่ม:
คำพูด: <บทพูด>
ข้อความบนจอ: <ข้อความสั้น ไม่เกิน 60 ตัวอักษร>
ภาพ: <ภาพที่ควรถ่าย>
CLAIM: <ประโยคที่กล่าวถึงข้อเท็จจริง> | <รหัส เช่น F1>`;
}

export interface ParsedReply {
  narration: string;
  on_screen_text: string;
  visual_note: string;
  claims: { text: string; factKey: string | null }[];
}

export type ParseReplyResult = { ok: true; value: ParsedReply; warnings: string[] } | { ok: false; errors: string[] };

const FIELDS: [RegExp, keyof Omit<ParsedReply, "claims">][] = [
  [/^(?:คำพูด|บทพูด|narration)\s*[:：]\s*/i, "narration"],
  [/^(?:ข้อความบนจอ|ข้อความบนหน้าจอ|on[- ]?screen(?: text)?)\s*[:：]\s*/i, "on_screen_text"],
  [/^(?:ภาพ|ภาพที่ใช้|visual)\s*[:：]\s*/i, "visual_note"],
];
const CLAIM = /^claim\s*[:：]\s*/i;
const LIMITS = { narration: 1000, on_screen_text: 200, visual_note: 500 } as const;

/**
 * Parses an AI reply in the format the prompt asks for. Tolerates markdown (``` fences, **bold**,
 * bullets) and multi-line narration. `codes` maps F-codes to fact keys as offered in the prompt.
 */
export function parseSceneReply(reply: string, codes: Map<string, string>): ParseReplyResult {
  const out: ParsedReply = { narration: "", on_screen_text: "", visual_note: "", claims: [] };
  const errors: string[] = [];
  const warnings: string[] = [];
  let current: keyof Omit<ParsedReply, "claims"> | null = null;

  for (const rawLine of reply.split(/\r?\n/)) {
    const line = rawLine
      .replace(/^```.*$/, "")
      .replace(/\*\*/g, "")
      .replace(/^\s*[-*•]\s+/, "")
      .trim();
    if (!line) continue;

    if (CLAIM.test(line)) {
      current = null;
      const body = line.replace(CLAIM, "");
      const bar = body.lastIndexOf("|");
      const text = (bar >= 0 ? body.slice(0, bar) : body).trim();
      const ref = bar >= 0 ? body.slice(bar + 1).trim() : "";
      if (!text) continue;
      const code = /F\s*(\d+)/i.exec(ref);
      if (code) {
        const key = codes.get(`F${code[1]}`);
        if (!key) errors.push(`CLAIM “${clip(text, 40)}” อ้างรหัส F${code[1]} ซึ่งไม่มีในรายการข้อเท็จจริง`);
        out.claims.push({ text: text.slice(0, 300), factKey: key ?? null });
      } else {
        warnings.push(`CLAIM “${clip(text, 40)}” ไม่มีรหัสข้อเท็จจริง — ต้องเลือกเองก่อนอนุมัติ`);
        out.claims.push({ text: text.slice(0, 300), factKey: null });
      }
      continue;
    }

    const field = FIELDS.find(([re]) => re.test(line));
    if (field) {
      current = field[1];
      const value = line.replace(field[0], "");
      out[current] = value === "-" ? "" : value;
    } else if (current === "narration") {
      out.narration = `${out.narration} ${line}`.trim();
    }
  }

  if (!out.narration) errors.push("ไม่พบบรรทัด “คำพูด:” ในคำตอบ — ตรวจว่าวางคำตอบครบ");
  for (const k of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    if (out[k].length > LIMITS[k]) errors.push(`${k === "narration" ? "คำพูด" : k === "on_screen_text" ? "ข้อความบนจอ" : "ภาพ"} ยาวเกิน ${LIMITS[k]} ตัวอักษร`);
  }
  if (out.claims.length > 20) errors.push("CLAIM มากเกิน 20 ข้อ");
  return errors.length ? { ok: false, errors } : { ok: true, value: out, warnings };
}
