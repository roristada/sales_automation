import { fieldKey, factKey } from "./facts";

/**
 * Six Thai short-video templates. A template turns a product and its facts into a first draft.
 * Rules every template follows:
 * - Only states things that come from facts; each such sentence carries a claim citing the fact.
 * - Missing facts become "[...]" placeholders, which block approval until filled or removed.
 * - No opinions presented as facts ("ดีที่สุด", "ขายดี") and no invented numbers.
 * - The affiliate disclosure is always included.
 */

// 2: no price in the clip except "แจ้งราคา" — the CTA sends viewers to the basket/link for the current price.
export const TEMPLATE_VERSION = 2;

export const SCENE_KIND_LABEL: Record<string, string> = {
  intro: "แนะนำสินค้า",
  feature: "จุดเด่น",
  price: "ราคา",
  cta: "ปิดท้าย / CTA",
  problem: "ปัญหา",
  solution: "ทางแก้",
  unbox: "แกะกล่อง",
  in_box: "ของในกล่อง",
  step: "ขั้นตอน",
  custom: "ฉากเพิ่มเอง",
};
export const PLATFORMS = ["tiktok", "reels", "shorts", "shopee_video"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLATFORM_LABEL: Record<Platform, string> = { tiktok: "TikTok", reels: "Instagram Reels", shorts: "YouTube Shorts", shopee_video: "Shopee Video" };
export const DURATIONS = [15, 30, 45, 60] as const;
/** Preselected length: shoppable TikTok reviews mostly run ~15–35 s, and shorter costs less AI. */
export const DEFAULT_DURATION: (typeof DURATIONS)[number] = 15;

export const DISCLOSURE = "#ได้รับค่าคอมมิชชัน ลิงก์ในคลิปเป็นลิงก์ affiliate ผู้ทำคลิปอาจได้รับค่าคอมมิชชันเมื่อมีการซื้อผ่านลิงก์";

/**
 * Prices change faster than a posted clip, so the clip sends viewers to the basket/link for the
 * current price. It invites them to check for discount codes without claiming there is one.
 */
const CTA: Record<Platform, string> = {
  tiktok: "กดตะกร้าดูราคาล่าสุด แล้วเช็กโค้ดส่วนลดก่อนสั่งได้เลย",
  reels: "ดูราคาล่าสุดและเช็กโค้ดส่วนลดได้ที่ลิงก์ในไบโอ",
  shorts: "ดูราคาล่าสุดและเช็กโค้ดส่วนลดได้ที่ลิงก์ในคำอธิบาย",
  shopee_video: "กดตะกร้าใต้คลิปดูราคาล่าสุด แล้วเช็กโค้ดส่วนลดก่อนสั่งได้เลย",
};
const CTA_ON_SCREEN: Record<Platform, string> = { tiktok: "กดตะกร้าดูราคา", reels: "ลิงก์ในไบโอ", shorts: "ลิงก์ในคำอธิบาย", shopee_video: "กดตะกร้าดูราคา" };

export interface TemplateFact {
  id: string;
  label: string;
  value: string;
}

export interface TemplateContext {
  /** As said in the clip (spokenName); the shop title is `fullName`. */
  productName: string;
  /** The full shop title, used in the caption (search keywords). Defaults to productName. */
  fullName?: string;
  /** Formatted price, or null when the product has no price. */
  price: string | null;
  category: string | null;
  /** User facts in display order. */
  facts: TemplateFact[];
  platform: Platform;
  durationS: number;
}

/**
 * The product's name as said in a clip. Shop titles are keyword lists ("Edifier Comfo Bass
 * หูฟังไร้สาย Open Ear Clip On เบสหนัก AI Translation …"): read in full they take 10+ seconds.
 * The user's own spoken name wins; otherwise the leading Latin words (brand + model), or the
 * first words up to ~30 characters.
 */
export function spokenName(name: string, spoken?: string | null): string {
  if (spoken?.trim()) return spoken.trim();
  const clean = name.replace(/\s+/g, " ").trim();
  const latin = /^[A-Za-z0-9][\w.+'&-]*(?:\s+[A-Za-z0-9][\w.+'&-]*){0,3}/.exec(clean)?.[0];
  if (latin && latin.length >= 3 && latin.length < clean.length) return latin;
  let out = "";
  for (const w of clean.split(" ")) {
    if (out && (out + " " + w).length > 30) break;
    out = out ? `${out} ${w}` : w;
  }
  return out.slice(0, 60);
}

export interface ClaimDraft {
  text: string;
  /** Fact key: "field:price" or "fact:<uuid>". */
  factKey: string;
}

export interface SceneDraft {
  kind: string;
  narration: string;
  on_screen_text: string;
  visual_note: string;
  claims: ClaimDraft[];
}

export interface StoryboardDraft {
  hook: string;
  caption: string;
  cta: string;
  disclosure: string;
  scenes: SceneDraft[];
}

export interface ContentTemplate {
  id: string;
  name: string;
  description: string;
  /** Facts the template is built around; shown before creating so the user can add them first. */
  needs: { price: boolean; facts: number };
  /** Numbers the template itself writes (e.g. "3" in "3 จุดเด่น"); not product claims. */
  literals: string[];
  build(ctx: TemplateContext): StoryboardDraft;
}

/** How many feature scenes fit the target duration. */
export const featureCount = (durationS: number) => (durationS <= 15 ? 1 : durationS <= 30 ? 2 : 3);

const placeholder = (what: string) => `[${what}]`;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function featureScene(ctx: TemplateContext, i: number, kind = "feature"): SceneDraft {
  const f = ctx.facts[i];
  if (!f) {
    return {
      kind,
      narration: placeholder(`จุดเด่นข้อที่ ${i + 1} — เพิ่มข้อเท็จจริงของสินค้าก่อน แล้วเขียนจากข้อเท็จจริงนั้น`),
      on_screen_text: "",
      visual_note: "ภาพใกล้ส่วนที่เกี่ยวกับจุดเด่นนี้",
      claims: [],
    };
  }
  const sentence = `${f.label} ${f.value}`;
  return {
    kind,
    narration: sentence,
    on_screen_text: clip(`${f.label}: ${f.value}`, 60),
    visual_note: `ภาพที่แสดง${f.label}`,
    claims: [{ text: sentence, factKey: factKey(f.id) }],
  };
}

function priceScene(ctx: TemplateContext, lead = "ราคาตอนที่ทำคลิป"): SceneDraft {
  if (!ctx.price) {
    return {
      kind: "price",
      narration: placeholder("ยังไม่มีราคาสินค้า — เพิ่มราคา หรือลบฉากนี้"),
      on_screen_text: "",
      visual_note: "หน้าสินค้าที่เห็นราคา",
      claims: [],
    };
  }
  const sentence = `${lead} ${ctx.price} ราคาอาจเปลี่ยนได้ เช็กในลิงก์อีกครั้ง`;
  return {
    kind: "price",
    narration: sentence,
    on_screen_text: ctx.price,
    visual_note: "หน้าสินค้าที่เห็นราคา (ถ่ายวันเดียวกับที่ตรวจราคา)",
    claims: [{ text: `${lead} ${ctx.price}`, factKey: fieldKey("price") }],
  };
}

function ctaScene(ctx: TemplateContext): SceneDraft {
  return { kind: "cta", narration: CTA[ctx.platform], on_screen_text: CTA_ON_SCREEN[ctx.platform], visual_note: "สินค้าเต็มเฟรม + ลูกศรชี้ตะกร้า/ลิงก์", claims: [] };
}

function caption(ctx: TemplateContext, angle: string) {
  const tag = ctx.category ? ` #${ctx.category.replace(/\s+/g, "")}` : "";
  return `${ctx.fullName ?? ctx.productName} — ${angle}${tag}`;
}

function base(ctx: TemplateContext, hook: string, angle: string, scenes: SceneDraft[]): StoryboardDraft {
  return { hook, caption: caption(ctx, angle), cta: CTA[ctx.platform], disclosure: DISCLOSURE, scenes };
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

export const TEMPLATES: ContentTemplate[] = [
  {
    id: "quick_review",
    name: "รีวิวสั้น",
    description: "แนะนำสินค้า จุดเด่นจากข้อเท็จจริง แล้วชวนกดตะกร้าดูราคา",
    needs: { price: false, facts: 2 },
    literals: [],
    build: (ctx) =>
      base(ctx, `${ctx.productName} มีอะไรน่าสนใจบ้าง มาดูกัน`, "รีวิวสั้น", [
        { kind: "intro", narration: `นี่คือ ${ctx.productName}`, on_screen_text: clip(ctx.productName, 60), visual_note: "สินค้าเต็มเฟรม หมุนให้เห็นรอบตัว", claims: [] },
        ...range(featureCount(ctx.durationS)).map((i) => featureScene(ctx, i)),
        ctaScene(ctx),
      ]),
  },
  {
    id: "problem_solution",
    name: "ปัญหา → ทางแก้",
    description: "เปิดด้วยปัญหาที่คนดูเจอ แล้วแสดงว่าสินค้าช่วยได้อย่างไร",
    needs: { price: false, facts: 1 },
    literals: [],
    build: (ctx) =>
      base(ctx, "ใครเคยเจอปัญหานี้บ้าง?", "ปัญหาและทางแก้", [
        { kind: "problem", narration: placeholder("เล่าปัญหาที่สินค้านี้ช่วยได้ ด้วยประสบการณ์จริง"), on_screen_text: "", visual_note: "สถานการณ์ที่เกิดปัญหา", claims: [] },
        { ...featureScene(ctx, 0, "solution"), visual_note: `ใช้ ${ctx.productName} แก้ปัญหานั้น` },
        ...range(featureCount(ctx.durationS) - 1).map((i) => featureScene(ctx, i + 1)),
        ctaScene(ctx),
      ]),
  },
  {
    id: "top_features",
    name: "3 จุดเด่น",
    description: "ลิสต์จุดเด่น 3 ข้อจากข้อเท็จจริงของสินค้า",
    needs: { price: false, facts: 3 },
    literals: ["1", "2", "3"],
    build: (ctx) =>
      base(ctx, `3 จุดเด่นของ ${ctx.productName}`, "3 จุดเด่น", [
        ...range(3).map((i) => {
          const s = featureScene(ctx, i);
          return { ...s, on_screen_text: s.on_screen_text ? `${i + 1}. ${s.on_screen_text}` : s.on_screen_text };
        }),
        ctaScene(ctx),
      ]),
  },
  {
    id: "unboxing",
    name: "แกะกล่อง",
    description: "เปิดกล่อง ดูของจริง และรายละเอียดที่ตรวจสอบได้",
    needs: { price: false, facts: 2 },
    literals: [],
    build: (ctx) =>
      base(ctx, `แกะกล่อง ${ctx.productName}`, "แกะกล่อง", [
        { kind: "unbox", narration: "มาแกะกล่องกัน", on_screen_text: "แกะกล่อง", visual_note: "มือเปิดกล่อง เห็นของในกล่องทั้งหมด", claims: [] },
        { kind: "in_box", narration: placeholder("ในกล่องมีอะไรบ้าง (พูดเฉพาะที่เห็นจริงในคลิป)"), on_screen_text: "", visual_note: "วางของในกล่องเรียงกัน", claims: [] },
        ...range(featureCount(ctx.durationS)).map((i) => featureScene(ctx, i)),
        ctaScene(ctx),
      ]),
  },
  {
    id: "deal_alert",
    name: "แจ้งราคา",
    description: "บอกราคาปัจจุบันพร้อมจุดเด่นหนึ่งข้อ ต้องมีราคาที่ยังไม่เก่า",
    needs: { price: true, facts: 1 },
    literals: [],
    build: (ctx) =>
      base(ctx, ctx.price ? `${ctx.productName} ตอนนี้ ${ctx.price}` : `${ctx.productName} ราคาเท่าไหร่ตอนนี้?`, "แจ้งราคา", [
        priceScene(ctx, `${ctx.productName} ราคาตอนที่ทำคลิป`),
        featureScene(ctx, 0),
        ctaScene(ctx),
      ]),
  },
  {
    id: "how_to",
    name: "วิธีใช้",
    description: "สอนใช้งานทีละขั้น ปิดด้วยจุดเด่นและลิงก์",
    needs: { price: false, facts: 1 },
    literals: ["1", "2", "3"],
    build: (ctx) =>
      base(ctx, `วิธีใช้ ${ctx.productName} แบบง่ายๆ`, "วิธีใช้", [
        ...range(Math.min(3, featureCount(ctx.durationS) + 1)).map((i) => ({
          kind: "step",
          narration: placeholder(`ขั้นตอนที่ ${i + 1} — อธิบายสิ่งที่ทำในภาพ`),
          on_screen_text: `ขั้นตอนที่ ${i + 1}`,
          visual_note: `สาธิตขั้นตอนที่ ${i + 1}`,
          claims: [],
        })),
        featureScene(ctx, 0),
        ctaScene(ctx),
      ]),
  },
];

export const getTemplate = (id: string) => TEMPLATES.find((t) => t.id === id);
