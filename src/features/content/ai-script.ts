import { z } from "zod";
import type { PromptContext } from "./ai-prompt";
import { promptFacts } from "./ai-prompt";
import type { Fact } from "./facts";

/**
 * A whole script from the API in one call (docs/AI_VIDEO_PLAN.md AI-2): hook, every scene (keeping
 * the storyboard's scene structure), claims citing fact codes, CTA and caption. The reply is
 * structured JSON, checked here, previewed, and applied like pasted AI text: origin "ai", every
 * claim "pending".
 */

export interface ScriptPromptScene {
  kindLabel: string;
  narration: string;
  on_screen_text: string;
  visual_note: string;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function buildScriptPrompt(ctx: PromptContext, scenes: ScriptPromptScene[], facts: Fact[]): string {
  const list = promptFacts(facts);
  const perScene = Math.round((ctx.targetSeconds / Math.max(1, scenes.length)) * 10) / 10;
  const factLines = list.length
    ? list
        .map(({ code, fact }) => {
          const note = fact.status === "stale" ? " (ข้อมูลเก่า — หลีกเลี่ยง)" : fact.status === "ai_estimate" ? " (ค่าประมาณ — หลีกเลี่ยง)" : "";
          return `[${code}] ${fact.label}: ${clip(fact.value!, 300)}${note}`;
        })
        .join("\n")
    : "(ไม่มี — ห้ามกล่าวถึงคุณสมบัติ ราคา หรือตัวเลขใดๆ)";
  const sceneLines = scenes.map((s, i) => `${i + 1}. ${s.kindLabel} — ตอนนี้: ${clip(s.narration || "-", 200)}`).join("\n");

  return `ช่วยเขียนบททั้งคลิปสำหรับวิดีโอสั้นแนวตั้ง (${ctx.platformLabel} ความยาวประมาณ ${ctx.targetSeconds} วินาที) ที่แนะนำสินค้าผ่านลิงก์ affiliate

สินค้า: ${ctx.productName}
รูปแบบคลิป: ${ctx.templateName}
จำนวนฉาก: ${scenes.length} ฉาก (ต้องตอบครบทุกฉาก ตามลำดับเดิม ฉากละประมาณ ${perScene} วินาที หรือราว ${Math.round(perScene * 11)} ตัวอักษร)
${sceneLines}

ข้อเท็จจริงที่ใช้ได้ (ห้ามใช้ข้อมูลอื่นนอกจากนี้):
${factLines}

สิ่งที่ต้องการเพิ่มเติม: ${ctx.instruction.trim() || "เขียนให้เป็นธรรมชาติ น่าฟัง กระชับ เปิดด้วย hook ที่หยุดนิ้วคนดู"}

กฎ:
- ภาษาไทยแบบพูด เป็นกันเอง กระชับ
- hook: ประโยคเปิดสั้นๆ ไม่เกิน 80 ตัวอักษร
- พูดถึงคุณสมบัติ ราคา หรือตัวเลขได้เฉพาะที่อยู่ในข้อเท็จจริงด้านบน ห้ามเพิ่มสเปก ตัวเลข หรือผลลัพธ์ที่ไม่มีในรายการ
- ห้ามอ้างว่าดีที่สุด ขายดี รับประกันผล หรือเปรียบเทียบกับแบรนด์อื่น
- ถ้าพูดถึงราคา ให้บอกว่าราคาอาจเปลี่ยนได้
- ไม่ต้องเขียนข้อความเปิดเผยลิงก์ affiliate (ระบบใส่ให้แล้ว)
- on_screen_text ไม่เกิน 60 ตัวอักษร; visual_note บอกภาพที่ควรใช้
- ทุกประโยคที่กล่าวถึงข้อเท็จจริง ใส่ใน claims พร้อม fact เป็นรหัส เช่น "F1" — claim ต้องพูดสิ่งที่ข้อเท็จจริงนั้นบอกตรงๆ ห้ามโยงคำโฆษณา (เช่น "เบสหนัก" "เสียงดี") เข้ากับสเปก แม้คำนั้นจะอยู่ในชื่อสินค้า
- caption: แคปชันโพสต์ 1–3 ประโยค + แฮชแท็กที่เกี่ยวข้อง ไม่เกิน 300 ตัวอักษร (ไม่ต้องใส่ข้อความเปิดเผย affiliate)`;
}

export const SCRIPT_JSON_SCHEMA = {
  name: "video_script",
  schema: {
    type: "object",
    properties: {
      hook: { type: "string" },
      scenes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            narration: { type: "string" },
            on_screen_text: { type: "string" },
            visual_note: { type: "string" },
            claims: {
              type: "array",
              items: { type: "object", properties: { text: { type: "string" }, fact: { type: "string" } }, required: ["text", "fact"], additionalProperties: false },
            },
          },
          required: ["narration", "on_screen_text", "visual_note", "claims"],
          additionalProperties: false,
        },
      },
      cta: { type: "string" },
      caption: { type: "string" },
    },
    required: ["hook", "scenes", "cta", "caption"],
    additionalProperties: false,
  },
};

export interface ScriptDraftScene {
  narration: string;
  on_screen_text: string;
  visual_note: string;
  claims: { text: string; factKey: string | null }[];
}

export interface ScriptDraft {
  hook: string;
  cta: string;
  caption: string;
  scenes: ScriptDraftScene[];
}

export type ParseScriptResult = { ok: true; value: ScriptDraft; warnings: string[] } | { ok: false; errors: string[] };

const replySchema = z.object({
  hook: z.string(),
  cta: z.string(),
  caption: z.string(),
  scenes: z.array(z.object({ narration: z.string(), on_screen_text: z.string(), visual_note: z.string(), claims: z.array(z.object({ text: z.string(), fact: z.string() })) })),
});

export const SCRIPT_LIMITS = { hook: 300, cta: 300, caption: 2200, narration: 1000, on_screen_text: 200, visual_note: 500, claims: 20 } as const;

/** Checks a structured reply against the storyboard: scene count, lengths, fact codes offered. */
export function parseScriptJson(value: unknown, codes: Map<string, string>, sceneCount: number): ParseScriptResult {
  const parsed = replySchema.safeParse(value);
  if (!parsed.success) return { ok: false, errors: ["คำตอบของ AI ไม่ตรงรูปแบบที่กำหนด ลองใหม่อีกครั้ง"] };
  const r = parsed.data;
  const errors: string[] = [];
  const warnings: string[] = [];
  if (r.scenes.length !== sceneCount) errors.push(`AI ตอบมา ${r.scenes.length} ฉาก แต่สคริปต์มี ${sceneCount} ฉาก`);
  for (const k of ["hook", "cta", "caption"] as const) if (r[k].length > SCRIPT_LIMITS[k]) errors.push(`${k} ยาวเกิน ${SCRIPT_LIMITS[k]} ตัวอักษร`);

  const scenes = r.scenes.map((s, i) => {
    const n = i + 1;
    if (!s.narration.trim()) errors.push(`ฉากที่ ${n} ไม่มีคำพูด`);
    for (const k of ["narration", "on_screen_text", "visual_note"] as const) if (s[k].length > SCRIPT_LIMITS[k]) errors.push(`ฉากที่ ${n}: ${k} ยาวเกิน ${SCRIPT_LIMITS[k]} ตัวอักษร`);
    if (s.claims.length > SCRIPT_LIMITS.claims) errors.push(`ฉากที่ ${n}: CLAIM มากเกิน ${SCRIPT_LIMITS.claims} ข้อ`);
    const claims = s.claims
      .filter((c) => c.text.trim())
      .map((c) => {
        const code = /F\s*(\d+)/i.exec(c.fact);
        if (!code) {
          warnings.push(`ฉากที่ ${n}: claim “${clip(c.text, 40)}” ไม่มีรหัสข้อเท็จจริง — ต้องเลือกเองก่อนอนุมัติ`);
          return { text: c.text.trim().slice(0, 300), factKey: null };
        }
        const key = codes.get(`F${code[1]}`);
        if (!key) errors.push(`ฉากที่ ${n}: claim “${clip(c.text, 40)}” อ้างรหัส F${code[1]} ซึ่งไม่มีในรายการข้อเท็จจริง`);
        return { text: c.text.trim().slice(0, 300), factKey: key ?? null };
      });
    return { narration: s.narration.trim(), on_screen_text: s.on_screen_text.trim(), visual_note: s.visual_note.trim(), claims };
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { hook: r.hook.trim(), cta: r.cta.trim(), caption: r.caption.trim(), scenes }, warnings };
}
