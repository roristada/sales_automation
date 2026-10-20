import { describe, expect, it } from "vitest";
import { buildScenePrompt, parseSceneReply, promptFacts } from "./ai-prompt";
import type { Fact } from "./facts";

const facts: Fact[] = [
  { key: "fact:a", label: "แบตเตอรี่", value: "ใช้งานได้ 20 ชั่วโมง", status: "user_provided" },
  { key: "field:price", label: "ราคา", value: "฿590.00", status: "stale" },
  { key: "field:description", label: "รายละเอียดสินค้า", value: null, status: "unavailable" },
];
const codes = new Map(promptFacts(facts).map(({ code, fact }) => [code, fact.key]));

describe("buildScenePrompt", () => {
  const prompt = buildScenePrompt(
    { productName: "หูฟัง Buds", templateName: "รีวิวสั้น", platformLabel: "TikTok", targetSeconds: 30, instruction: "" },
    { position: 1, total: 5, kindLabel: "จุดเด่น", narration: "แบตเตอรี่ ใช้งานได้ 20 ชั่วโมง", on_screen_text: "", visual_note: "ภาพแบต", estSeconds: 2.4 },
    facts,
  );
  it("numbers only available facts and flags stale ones", () => {
    expect(prompt).toContain("[F1] แบตเตอรี่: ใช้งานได้ 20 ชั่วโมง");
    expect(prompt).toContain("[F2] ราคา: ฿590.00 (ข้อมูลเก่า — หลีกเลี่ยง)");
    expect(prompt).not.toContain("F3");
  });
  it("states the rules and the reply format", () => {
    expect(prompt).toContain("ห้ามเพิ่มสเปก ตัวเลข");
    expect(prompt).toContain("ฉากที่ 2 จาก 5");
    expect(prompt).toContain("CLAIM: <ประโยคที่กล่าวถึงข้อเท็จจริง> | <รหัส เช่น F1>");
    expect(prompt).toContain("เขียนใหม่ให้เป็นธรรมชาติ");
    // 30 s over 5 scenes → 6 s ≈ 66 characters, not the current text's 2.4 s
    expect(prompt).toContain("ประมาณ 6 วินาที (บทพูดไม่เกินประมาณ 66 ตัวอักษร)");
  });
});

describe("parseSceneReply", () => {
  it("parses the requested format, maps fact codes, tolerates markdown and multi-line narration", () => {
    const r = parseSceneReply(
      "```\n**คำพูด:** ฟังเพลงได้ยาวๆ\nแบตอยู่ได้ถึง 20 ชั่วโมง\nข้อความบนจอ: แบต 20 ชม.\n- ภาพ: ใส่หูฟังเดินในสวน\nCLAIM: แบตอยู่ได้ถึง 20 ชั่วโมง | F1\n```",
      codes,
    );
    expect(r).toEqual({
      ok: true,
      warnings: [],
      value: {
        narration: "ฟังเพลงได้ยาวๆ แบตอยู่ได้ถึง 20 ชั่วโมง",
        on_screen_text: "แบต 20 ชม.",
        visual_note: "ใส่หูฟังเดินในสวน",
        claims: [{ text: "แบตอยู่ได้ถึง 20 ชั่วโมง", factKey: "fact:a" }],
      },
    });
  });

  it("keeps claims without a code as unlinked, with a warning", () => {
    const r = parseSceneReply("คำพูด: กันน้ำได้\nCLAIM: กันน้ำได้", codes);
    expect(r.ok && r.value.claims).toEqual([{ text: "กันน้ำได้", factKey: null }]);
    expect(r.ok && r.warnings[0]).toMatch(/ไม่มีรหัส/);
  });

  it("rejects unknown codes and replies without narration", () => {
    const bad = parseSceneReply("คำพูด: x\nCLAIM: y | F9", codes);
    expect(!bad.ok && bad.errors[0]).toMatch(/F9/);
    const empty = parseSceneReply("สวัสดีครับ นี่คือบทที่ปรับแล้ว", codes);
    expect(!empty.ok && empty.errors[0]).toMatch(/คำพูด/);
  });
});
