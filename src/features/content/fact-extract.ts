import { z } from "zod";

/**
 * Facts from a product description (and, through the API, product images): either a prompt the
 * user pastes into any AI chat plus a parser for the reply, or a direct call with a JSON schema.
 * Extracted facts are saved as "ai_estimate" and can't back a script until the user confirms each
 * one against the source.
 */

export interface ExtractedFact {
  label: string;
  value: string;
  /** Where the AI says it read the fact. Numbers are checked against the text only for "text". */
  source?: "text" | "image";
}

export const MAX_DESCRIPTION_CHARS = 5000;
export const MAX_EXTRACTED_FACTS = 15;

const NUMBER = /\d+(?:[.,]\d+)*/g;
const LINE_BREAK = /\r?\n/;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const digits = (s: string) => s.replace(/,/g, "");

function extractBrief(productName: string, description: string, existing: ExtractedFact[], imageCount = 0): string {
  const have = existing.length ? existing.map((f) => `- ${f.label}: ${f.value}`).join("\n") : "(ยังไม่มี)";
  const images = imageCount ? `\n\nแนบรูปสินค้า ${imageCount} รูป: อ่านข้อความหรือสเปกที่พิมพ์อยู่บนรูปได้ (เช่น "IP55", "40H") แต่ห้ามเดาจากหน้าตาสินค้า` : "";
  return `ช่วยดึง "ข้อเท็จจริงของสินค้า" จากคำอธิบายสินค้าด้านล่าง${imageCount ? "และรูปที่แนบ" : ""} เพื่อใช้เขียนบทวิดีโอรีวิวสั้น

สินค้า: ${productName}

คำอธิบายสินค้า (จากหน้าร้าน):
"""
${description.slice(0, MAX_DESCRIPTION_CHARS)}
"""${images}

ข้อเท็จจริงที่มีอยู่แล้ว (ไม่ต้องซ้ำ):
${have}

กฎ:
- เอาเฉพาะสิ่งที่คำอธิบายเขียนไว้ชัดเจนและตรวจสอบได้ เช่น ขนาด น้ำหนัก วัสดุ สเปก ความจุ แบตเตอรี่ มาตรฐาน การรับประกัน สิ่งที่อยู่ในกล่อง วิธีใช้
- ตัวเลขและหน่วยต้องตรงตามคำอธิบายทุกตัว ห้ามแปลงหน่วย ห้ามปัดเศษ ห้ามคำนวณใหม่
- ห้ามเดาหรือเติมข้อมูลที่ไม่มีในคำอธิบาย
- ข้ามคำโฆษณาและความเห็น เช่น ดีที่สุด ขายดี เบสหนัก คุณภาพสูง ถูกที่สุด
- ข้ามราคา โปรโมชัน ค่าส่ง และของแถมที่มีเวลาจำกัด
- หัวข้อสั้น ไม่เกิน 30 ตัวอักษร รายละเอียดไม่เกิน 150 ตัวอักษร
- ไม่เกิน ${MAX_EXTRACTED_FACTS} ข้อ เรียงจากข้อที่น่าใช้ในวิดีโอที่สุด`;
}

export function buildFactExtractPrompt(productName: string, description: string, existing: ExtractedFact[]): string {
  return `${extractBrief(productName, description, existing)}

ตอบในรูปแบบนี้เท่านั้น บรรทัดละหนึ่งข้อ ไม่ต้องอธิบายเพิ่ม:
FACT: <หัวข้อ> | <รายละเอียด>`;
}

/** Prompt for a direct API call; the reply format comes from FACT_JSON_SCHEMA. */
export function buildFactExtractApiPrompt(productName: string, description: string, existing: ExtractedFact[], imageCount: number): string {
  return `${extractBrief(productName, description, existing, imageCount)}
- ระบุ source ของแต่ละข้อ: "text" ถ้ามาจากคำอธิบาย, "image" ถ้าอ่านได้จากรูปเท่านั้น
- ถ้าไม่มีข้อเท็จจริงที่ตรวจสอบได้ ให้ส่ง facts เป็นรายการว่าง`;
}

export const FACT_JSON_SCHEMA = {
  name: "product_facts",
  schema: {
    type: "object",
    properties: {
      facts: {
        type: "array",
        items: {
          type: "object",
          properties: { label: { type: "string" }, value: { type: "string" }, source: { type: "string", enum: ["text", "image"] } },
          required: ["label", "value", "source"],
          additionalProperties: false,
        },
      },
    },
    required: ["facts"],
    additionalProperties: false,
  },
};

export type ParsedFact = ExtractedFact & { problem: string | null };

/**
 * Why each fact can't be saved as-is (null when it can): too long, a duplicate, or a number the
 * description doesn't contain (an invented spec). Facts read from an image skip the number check:
 * they stay "AI ประมาณการ" until the user checks the image. Run on the client preview and on save.
 */
export function checkFacts(facts: ExtractedFact[], description: string, existing: ExtractedFact[]): ParsedFact[] {
  const sourceNumbers = new Set((description.match(NUMBER) ?? []).map(digits));
  const seen = new Set(existing.map((f) => norm(`${f.label}|${f.value}`)));
  return facts.map(({ label, value, source }) => {
    const key = norm(`${label}|${value}`);
    let problem: string | null = null;
    if (!label || label.length > 80) problem = "หัวข้อว่างหรือยาวเกิน 80 ตัวอักษร";
    else if (!value || value.length > 300) problem = "รายละเอียดว่างหรือยาวเกิน 300 ตัวอักษร";
    else if (seen.has(key)) problem = "ซ้ำกับข้อที่มีอยู่";
    else if (source !== "image") {
      const missing = (value.match(NUMBER) ?? []).map(digits).filter((n) => !sourceNumbers.has(n));
      if (missing.length) problem = `ตัวเลข ${missing.join(", ")} ไม่มีในคำอธิบาย`;
    }
    seen.add(key);
    return { label, value, ...(source ? { source } : {}), problem };
  });
}

/** Reads "FACT: label | value" lines from the pasted reply, then checks them. */
export function parseFactReply(reply: string, description: string, existing: ExtractedFact[]): { facts: ParsedFact[]; error: string | null } {
  const raw: ExtractedFact[] = [];
  for (const line of reply.split(LINE_BREAK)) {
    const m = /^\s*[-*•]?\s*FACT\s*[:：]\s*(.+?)\s*\|\s*(.+?)\s*$/i.exec(line);
    if (!m) continue;
    raw.push({ label: m[1].replace(/^["“]|["”]$/g, "").trim(), value: m[2].replace(/^["“]|["”]$/g, "").trim() });
    if (raw.length >= MAX_EXTRACTED_FACTS * 2) break;
  }
  if (!raw.length) return { facts: [], error: "ไม่พบบรรทัดที่ขึ้นต้นด้วย FACT: — วางคำตอบทั้งหมดจาก AI" };
  return { facts: checkFacts(raw, description, existing), error: null };
}

const factReplySchema = z.object({
  facts: z.array(z.object({ label: z.string().trim(), value: z.string().trim(), source: z.enum(["text", "image"]) })).max(MAX_EXTRACTED_FACTS * 2),
});

/** Validates a structured API reply, then checks each fact like a pasted one. */
export function parseFactJson(value: unknown, description: string, existing: ExtractedFact[]): { facts: ParsedFact[]; error: string | null } {
  const parsed = factReplySchema.safeParse(value);
  if (!parsed.success) return { facts: [], error: "คำตอบของ AI ไม่ตรงรูปแบบที่กำหนด ลองใหม่อีกครั้ง" };
  if (!parsed.data.facts.length) return { facts: [], error: "AI ไม่พบข้อเท็จจริงที่ตรวจสอบได้ในคำอธิบาย" };
  return { facts: checkFacts(parsed.data.facts, description, existing), error: null };
}
