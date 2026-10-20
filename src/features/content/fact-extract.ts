/**
 * Facts from a product description, with AI help but no API key: build a prompt the user pastes
 * into any AI chat, then parse the reply they paste back. Extracted facts are saved as
 * "ai_estimate" and can't back a script until the user confirms each one against the source.
 */

export interface ExtractedFact {
  label: string;
  value: string;
}

export const MAX_DESCRIPTION_CHARS = 5000;
export const MAX_EXTRACTED_FACTS = 15;

const NUMBER = /\d+(?:[.,]\d+)*/g;
const LINE_BREAK = /\r?\n/;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const digits = (s: string) => s.replace(/,/g, "");

export function buildFactExtractPrompt(productName: string, description: string, existing: ExtractedFact[]): string {
  const have = existing.length ? existing.map((f) => `- ${f.label}: ${f.value}`).join("\n") : "(ยังไม่มี)";
  return `ช่วยดึง "ข้อเท็จจริงของสินค้า" จากคำอธิบายสินค้าด้านล่าง เพื่อใช้เขียนบทวิดีโอรีวิวสั้น

สินค้า: ${productName}

คำอธิบายสินค้า (จากหน้าร้าน):
"""
${description.slice(0, MAX_DESCRIPTION_CHARS)}
"""

ข้อเท็จจริงที่มีอยู่แล้ว (ไม่ต้องซ้ำ):
${have}

กฎ:
- เอาเฉพาะสิ่งที่คำอธิบายเขียนไว้ชัดเจนและตรวจสอบได้ เช่น ขนาด น้ำหนัก วัสดุ สเปก ความจุ แบตเตอรี่ มาตรฐาน การรับประกัน สิ่งที่อยู่ในกล่อง วิธีใช้
- ตัวเลขและหน่วยต้องตรงตามคำอธิบายทุกตัว ห้ามแปลงหน่วย ห้ามปัดเศษ ห้ามคำนวณใหม่
- ห้ามเดาหรือเติมข้อมูลที่ไม่มีในคำอธิบาย
- ข้ามคำโฆษณาและความเห็น เช่น ดีที่สุด ขายดี เบสหนัก คุณภาพสูง ถูกที่สุด
- ข้ามราคา โปรโมชัน ค่าส่ง และของแถมที่มีเวลาจำกัด
- หัวข้อสั้น ไม่เกิน 30 ตัวอักษร รายละเอียดไม่เกิน 150 ตัวอักษร
- ไม่เกิน ${MAX_EXTRACTED_FACTS} ข้อ เรียงจากข้อที่น่าใช้ในวิดีโอที่สุด

ตอบในรูปแบบนี้เท่านั้น บรรทัดละหนึ่งข้อ ไม่ต้องอธิบายเพิ่ม:
FACT: <หัวข้อ> | <รายละเอียด>`;
}

export type ParsedFact = ExtractedFact & { problem: string | null };

/**
 * Why each fact can't be saved as-is (null when it can): too long, a duplicate, or a number the
 * description doesn't contain (an invented spec). Run on the client preview and again on save.
 */
export function checkFacts(facts: ExtractedFact[], description: string, existing: ExtractedFact[]): ParsedFact[] {
  const sourceNumbers = new Set((description.match(NUMBER) ?? []).map(digits));
  const seen = new Set(existing.map((f) => norm(`${f.label}|${f.value}`)));
  return facts.map(({ label, value }) => {
    const key = norm(`${label}|${value}`);
    let problem: string | null = null;
    if (!label || label.length > 80) problem = "หัวข้อว่างหรือยาวเกิน 80 ตัวอักษร";
    else if (!value || value.length > 300) problem = "รายละเอียดว่างหรือยาวเกิน 300 ตัวอักษร";
    else if (seen.has(key)) problem = "ซ้ำกับข้อที่มีอยู่";
    else {
      const missing = (value.match(NUMBER) ?? []).map(digits).filter((n) => !sourceNumbers.has(n));
      if (missing.length) problem = `ตัวเลข ${missing.join(", ")} ไม่มีในคำอธิบาย`;
    }
    seen.add(key);
    return { label, value, problem };
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
