import { describe, expect, it } from "vitest";
import { buildFactExtractPrompt, parseFactReply } from "./fact-extract";

const description = `หูฟังไร้สายแบบหนีบหู Open Ear
- Bluetooth 6.1 เชื่อมต่อเสถียร
- กันน้ำกันเหงื่อ IP55
- ใช้งานต่อเนื่อง 7 ชั่วโมง รวมกล่องชาร์จ 28 ชั่วโมง
- น้ำหนักข้างละ 5.2 กรัม
- รับประกันศูนย์ 1 ปี
เบสหนักที่สุดในรุ่น!! ราคาพิเศษวันนี้เท่านั้น`;

describe("fact extraction prompt", () => {
  it("includes the description, the facts already there and the rules", () => {
    const p = buildFactExtractPrompt("หูฟัง X", description, [{ label: "กันน้ำ", value: "IP55" }]);
    expect(p).toContain("หูฟัง X");
    expect(p).toContain("Bluetooth 6.1");
    expect(p).toContain("- กันน้ำ: IP55");
    expect(p).toContain("FACT: <หัวข้อ> | <รายละเอียด>");
  });
});

describe("parseFactReply", () => {
  it("reads FACT lines and ignores everything else", () => {
    const reply = `นี่คือข้อเท็จจริง:\nFACT: บลูทูธ | Bluetooth 6.1\n- FACT: แบตเตอรี่ | ใช้ต่อเนื่อง 7 ชั่วโมง รวมกล่องชาร์จ 28 ชั่วโมง\nFACT: น้ำหนัก | ข้างละ 5.2 กรัม\nหวังว่าจะช่วยได้`;
    const { facts, error } = parseFactReply(reply, description, []);
    expect(error).toBeNull();
    expect(facts).toEqual([
      { label: "บลูทูธ", value: "Bluetooth 6.1", problem: null },
      { label: "แบตเตอรี่", value: "ใช้ต่อเนื่อง 7 ชั่วโมง รวมกล่องชาร์จ 28 ชั่วโมง", problem: null },
      { label: "น้ำหนัก", value: "ข้างละ 5.2 กรัม", problem: null },
    ]);
  });

  it("flags numbers the description doesn't contain, duplicates and overlong text", () => {
    const reply = [
      "FACT: แบตเตอรี่ | ใช้ได้ 10 ชั่วโมง", // invented
      "FACT: กันน้ำ | IP55", // already saved
      "FACT: ประกัน | รับประกันศูนย์ 1 ปี",
      "FACT: ประกัน | รับประกันศูนย์ 1 ปี", // repeated in the reply
      `FACT: ยาว | ${"ก".repeat(301)}`,
    ].join("\n");
    const { facts } = parseFactReply(reply, description, [{ label: "กันน้ำ", value: "IP55" }]);
    expect(facts.map((f) => f.problem)).toEqual(["ตัวเลข 10 ไม่มีในคำอธิบาย", "ซ้ำกับข้อที่มีอยู่", null, "ซ้ำกับข้อที่มีอยู่", "รายละเอียดว่างหรือยาวเกิน 300 ตัวอักษร"]);
  });

  it("explains when nothing could be read", () => {
    expect(parseFactReply("ขอโทษ ฉันไม่เข้าใจ", description, []).error).toMatch(/FACT:/);
  });
});
