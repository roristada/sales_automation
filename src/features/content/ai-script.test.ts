import { describe, expect, it } from "vitest";
import { parseJsonReply } from "@/features/ai/json";
import { buildScriptPrompt, parseScriptJson, SCRIPT_JSON_SCHEMA } from "./ai-script";
import { buildFactExtractApiPrompt, checkFacts, FACT_JSON_SCHEMA, parseFactJson } from "./fact-extract";
import type { Fact } from "./facts";

/*
 * AI-2: structured replies are checked before anyone sees them. These are hand-written replies
 * exercising the checks — not stand-ins for real model output.
 */

const facts: Fact[] = [
  { key: "fact:a", label: "บลูทูธ", value: "Bluetooth 6.1", status: "verified_source" },
  { key: "fact:b", label: "กันน้ำ", value: "IP55", status: "user_provided" },
  { key: "field:price", label: "ราคา", value: "฿1,425", status: "imported_csv" },
  { key: "field:category", label: "หมวดหมู่", value: null, status: "unavailable" },
];
const codes = new Map([
  ["F1", "fact:a"],
  ["F2", "fact:b"],
  ["F3", "field:price"],
]);
const scene = (narration: string, claims: { text: string; fact: string }[] = []) => ({ narration, on_screen_text: "", visual_note: "", claims });

describe("whole-script prompt", () => {
  it("lists every scene, offers only available facts, and asks for exactly that many scenes", () => {
    const p = buildScriptPrompt(
      { productName: "ลำโพง", templateName: "รีวิวเร็ว", platformLabel: "TikTok", targetSeconds: 30, instruction: "" },
      [
        { kindLabel: "แนะนำสินค้า", narration: "เดิม", on_screen_text: "", visual_note: "" },
        { kindLabel: "ปิดท้าย / CTA", narration: "", on_screen_text: "", visual_note: "" },
      ],
      facts,
    );
    expect(p).toContain("จำนวนฉาก: 2 ฉาก");
    expect(p).toContain("[F1] บลูทูธ: Bluetooth 6.1");
    expect(p).toContain("[F3] ราคา: ฿1,425");
    expect(p).not.toContain("หมวดหมู่:");
    expect(p).toMatch(/ห้ามเพิ่มสเปก/);
  });

  it("uses strict JSON schemas (every property required, no extras)", () => {
    for (const s of [SCRIPT_JSON_SCHEMA.schema, SCRIPT_JSON_SCHEMA.schema.properties.scenes.items, FACT_JSON_SCHEMA.schema.properties.facts.items]) {
      expect(s.additionalProperties).toBe(false);
      expect([...s.required].sort()).toEqual(Object.keys(s.properties).sort());
    }
  });
});

describe("parseScriptJson", () => {
  const ok = {
    hook: "ลำโพงเล็กแต่กันน้ำ!",
    cta: "กดลิงก์ในคลิปได้เลย",
    caption: "ลำโพงพกพา #ลำโพง",
    scenes: [scene("ใช้บลูทูธ 6.1 ต่อไว", [{ text: "ใช้บลูทูธ 6.1", fact: "F1" }]), scene("ราคาตอนนี้ 1,425 บาท อาจเปลี่ยนได้", [{ text: "ราคา 1,425 บาท", fact: "[F3]" }])],
  };

  it("maps fact codes to keys and keeps the scene order", () => {
    const r = parseScriptJson(ok, codes, 2);
    expect(r).toEqual({
      ok: true,
      warnings: [],
      value: expect.objectContaining({ hook: "ลำโพงเล็กแต่กันน้ำ!", scenes: [expect.objectContaining({ claims: [{ text: "ใช้บลูทูธ 6.1", factKey: "fact:a" }] }), expect.objectContaining({ claims: [{ text: "ราคา 1,425 บาท", factKey: "field:price" }] })] }),
    });
  });

  it("rejects a wrong scene count, an unknown fact code, empty narration and malformed replies", () => {
    expect(parseScriptJson(ok, codes, 3)).toMatchObject({ ok: false, errors: [expect.stringContaining("2 ฉาก แต่สคริปต์มี 3")] });
    expect(parseScriptJson({ ...ok, scenes: [scene("x", [{ text: "แบต 40 ชม.", fact: "F9" }]), scene("y")] }, codes, 2)).toMatchObject({ ok: false, errors: [expect.stringContaining("F9")] });
    expect(parseScriptJson({ ...ok, scenes: [scene("  "), scene("y")] }, codes, 2)).toMatchObject({ ok: false, errors: [expect.stringContaining("ไม่มีคำพูด")] });
    expect(parseScriptJson({ ...ok, hook: "x".repeat(301) }, codes, 2)).toMatchObject({ ok: false });
    expect(parseScriptJson({ hook: "x" }, codes, 2)).toMatchObject({ ok: false, errors: [expect.stringContaining("ไม่ตรงรูปแบบ")] });
    expect(parseScriptJson(null, codes, 2)).toMatchObject({ ok: false });
  });

  it("keeps a claim without a code but warns it needs a fact", () => {
    const r = parseScriptJson({ ...ok, scenes: [scene("x", [{ text: "เสียงดี", fact: "" }]), scene("y")] }, codes, 2);
    expect(r).toMatchObject({ ok: true, warnings: [expect.stringContaining("ไม่มีรหัสข้อเท็จจริง")] });
  });
});

describe("parseJsonReply", () => {
  it("reads plain or fenced JSON and returns null for anything else", () => {
    expect(parseJsonReply('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonReply('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonReply("ขออภัย ทำไม่ได้")).toBeNull();
  });
});

describe("fact extraction through the API", () => {
  const description = "ลำโพงบลูทูธ 6.1 แบตเตอรี่ 40 ชั่วโมง";

  it("mentions attached images only when there are some", () => {
    expect(buildFactExtractApiPrompt("ลำโพง", description, [], 2)).toContain("แนบรูปสินค้า 2 รูป");
    expect(buildFactExtractApiPrompt("ลำโพง", description, [], 0)).not.toContain("แนบรูป");
  });

  it("checks numbers against the description for text facts, not for facts read from an image", () => {
    const r = parseFactJson(
      {
        facts: [
          { label: "บลูทูธ", value: "6.1", source: "text" },
          { label: "แบต", value: "50 ชั่วโมง", source: "text" },
          { label: "กันน้ำ", value: "IP55", source: "image" },
        ],
      },
      description,
      [],
    );
    expect(r.error).toBeNull();
    expect(r.facts.map((f) => f.problem)).toEqual([null, "ตัวเลข 50 ไม่มีในคำอธิบาย", null]);
    expect(r.facts[2].source).toBe("image");
    // A pasted reply has no source, so its numbers are always checked.
    expect(checkFacts([{ label: "กันน้ำ", value: "IP55" }], description, [])[0].problem).toMatch(/55/);
  });

  it("rejects a malformed reply and reports an empty one", () => {
    expect(parseFactJson({ facts: [{ label: "x" }] }, description, []).error).toMatch(/ไม่ตรงรูปแบบ/);
    expect(parseFactJson({ facts: [] }, description, []).error).toMatch(/ไม่พบ/);
  });
});
