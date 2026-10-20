import { describe, expect, it } from "vitest";
import { buildFacts, claimFactKey, type FactProduct, parseFactKey } from "./facts";
import { DISCLOSURE, featureCount, TEMPLATES, type TemplateContext } from "./templates";
import { canApprove, estimateSceneSeconds, validateStoryboard, type VScene, type VStoryboard } from "./validate";

const now = new Date("2026-10-20T00:00:00Z");
const product: FactProduct = {
  name: "หูฟัง Buds 3",
  price: 590,
  category: "หูฟัง",
  marketplace: "shopee",
  description: null,
  provenance: { price: "imported_csv" },
  retrieved_at: "2026-10-18T00:00:00Z",
  updated_at: "2026-10-18T00:00:00Z",
};
const rows = [
  { id: "11111111-1111-4111-8111-111111111111", label: "แบตเตอรี่", value: "ใช้งานได้ 20 ชั่วโมง", status: "user_provided" },
  { id: "22222222-2222-4222-8222-222222222222", label: "น้ำหนัก", value: "45 กรัม", status: "ai_estimate" },
];
const facts = buildFacts(product, rows, now);

const ctx = (over: Partial<TemplateContext> = {}): TemplateContext => ({
  productName: product.name,
  price: "฿590.00",
  category: product.category,
  facts: rows.map(({ id, label, value }) => ({ id, label, value })),
  platform: "tiktok",
  durationS: 30,
  ...over,
});

describe("facts", () => {
  it("includes user facts and product fields, never commission", () => {
    expect(facts.map((f) => f.key)).toEqual([`fact:${rows[0].id}`, `fact:${rows[1].id}`, "field:name", "field:price", "field:category", "field:marketplace", "field:description"]);
    expect(facts.find((f) => f.key === "field:price")).toMatchObject({ value: "฿590.00", status: "imported_csv" });
    expect(facts.find((f) => f.key === "field:description")).toMatchObject({ value: null, status: "unavailable" });
  });
  it("round-trips fact keys", () => {
    expect(parseFactKey("field:price")).toEqual({ fact_id: null, product_field: "price" });
    expect(parseFactKey(`fact:${rows[0].id}`)).toEqual({ fact_id: rows[0].id, product_field: null });
    expect(parseFactKey("field:commission_rate")).toEqual({ fact_id: null, product_field: null });
    expect(claimFactKey({ fact_id: null, product_field: "price" })).toBe("field:price");
  });
});

describe("templates", () => {
  it("has six templates with unique ids", () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(6);
  });

  it.each(TEMPLATES.map((t) => [t.id, t] as const))("%s always includes the disclosure and cites facts for every claim", (_, t) => {
    const d = t.build(ctx());
    expect(d.disclosure).toBe(DISCLOSURE);
    expect(d.scenes.length).toBeGreaterThan(1);
    expect(d.scenes.at(-1)?.kind).toBe("cta");
    for (const s of d.scenes) for (const c of s.claims) expect(c.factKey).toMatch(/^(fact|field):/);
  });

  it("uses placeholders, not invented text, when facts are missing", () => {
    const d = TEMPLATES.find((t) => t.id === "top_features")!.build(ctx({ facts: [] }));
    const features = d.scenes.filter((s) => s.kind === "feature");
    expect(features).toHaveLength(3);
    for (const s of features) {
      expect(s.narration).toMatch(/^\[.+\]$/);
      expect(s.claims).toEqual([]);
    }
  });

  it("scales feature scenes with duration", () => {
    expect(featureCount(15)).toBe(1);
    expect(featureCount(30)).toBe(2);
    expect(featureCount(60)).toBe(3);
    const short = TEMPLATES[0].build(ctx({ durationS: 15 }));
    expect(short.scenes.filter((s) => s.kind === "feature")).toHaveLength(1);
  });

  it("price scene cites the price field and says prices can change", () => {
    const d = TEMPLATES.find((t) => t.id === "deal_alert")!.build(ctx());
    const price = d.scenes.find((s) => s.kind === "price")!;
    expect(price.claims).toEqual([{ text: expect.stringContaining("฿590.00"), factKey: "field:price" }]);
    expect(price.narration).toContain("ราคาอาจเปลี่ยน");
  });
});

/** Turns a draft into validator input, with every claim in the given review state. */
function toV(templateId: string, c = ctx(), review = "verified") {
  const t = TEMPLATES.find((x) => x.id === templateId)!;
  const d = t.build(c);
  const sb: VStoryboard = { hook: d.hook, caption: d.caption, cta: d.cta, disclosure: d.disclosure, target_duration_s: c.durationS, literals: t.literals };
  const scenes: VScene[] = d.scenes.map((s, i) => ({
    id: `s${i}`,
    position: i,
    narration: s.narration,
    on_screen_text: s.on_screen_text,
    visual_note: s.visual_note,
    claims: s.claims.map((cl, j) => ({ id: `c${i}${j}`, text: cl.text, ...parseFactKey(cl.factKey), review_status: review })),
  }));
  return { sb, scenes };
}

describe("validateStoryboard", () => {
  it("approves a complete quick review once claims are verified", () => {
    const { sb, scenes } = toV("quick_review");
    // Once the AI-extracted 45 g fact is confirmed, nothing blocks approval.
    const confirmed = facts.map((f) => (f.status === "ai_estimate" ? { ...f, status: "user_provided" as const } : f));
    const issues = validateStoryboard(sb, scenes, confirmed);
    expect(issues.filter((i) => i.level === "block")).toEqual([]);
    expect(canApprove(issues)).toBe(true);
  });

  it("blocks claims on AI-extracted facts nobody has confirmed", () => {
    const { sb, scenes } = toV("quick_review");
    const issues = validateStoryboard(sb, scenes, facts);
    expect(issues.some((i) => i.level === "block" && i.message.includes("AI ดึงมา ยังไม่ได้ยืนยัน"))).toBe(true);
    expect(canApprove(issues)).toBe(false);
  });

  it("blocks unreviewed claims", () => {
    const { sb, scenes } = toV("quick_review", ctx(), "pending");
    expect(validateStoryboard(sb, scenes, facts).some((i) => i.level === "block" && i.message.includes("ยังไม่ได้ตรวจ"))).toBe(true);
  });

  it("blocks placeholders, missing disclosure, and claims without a fact", () => {
    const { sb, scenes } = toV("how_to");
    scenes[0].claims.push({ id: "x", text: "กันน้ำ", fact_id: null, product_field: null, review_status: "verified" });
    const issues = validateStoryboard({ ...sb, disclosure: "" }, scenes, facts);
    const msgs = issues
      .filter((i) => i.level === "block")
      .map((i) => i.message)
      .join("\n");
    expect(msgs).toMatch(/ช่อง \[ \]/);
    expect(msgs).toMatch(/affiliate/);
    expect(msgs).toMatch(/ยังไม่อ้างอิงข้อเท็จจริง/);
  });

  it("blocks claims on stale or missing data", () => {
    const stale = buildFacts({ ...product, retrieved_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" }, rows, now);
    const { sb, scenes } = toV("deal_alert");
    expect(validateStoryboard(sb, scenes, stale).some((i) => i.level === "block" && i.message.includes("เก่า"))).toBe(true);
    scenes[0].claims[0].product_field = "description";
    expect(validateStoryboard(sb, scenes, facts).some((i) => i.message.includes("ไม่มีข้อมูล"))).toBe(true);
  });

  it("warns about numbers no cited fact backs, but not the product name or template literals", () => {
    const { sb, scenes } = toV("top_features");
    expect(validateStoryboard(sb, scenes, facts).filter((i) => i.message.includes("ตัวเลข"))).toEqual([]);
    scenes[1].narration += " ชาร์จเต็มใน 2 ชั่วโมง กันน้ำ IPX7";
    const warns = validateStoryboard(sb, scenes, facts).filter((i) => i.message.includes("ตัวเลข"));
    expect(warns).toHaveLength(1);
    expect(warns[0].message).toContain("2, 7");
  });

  it("estimates Thai speech time without counting tone marks", () => {
    expect(estimateSceneSeconds("")).toBe(1.5);
    expect(estimateSceneSeconds("แบตเตอรี่ใช้งานได้ยี่สิบชั่วโมง")).toBeCloseTo(2.4, 1);
  });
});

describe("asset licensing in validation", () => {
  it("blocks non-commercial assets and warns on unknown or uncredited CC BY", () => {
    const { sb, scenes } = toV("quick_review");
    scenes[0].asset = { name: "a.jpg", license: "non_commercial", attribution: null, source: "stock", ai_generated: false };
    scenes[1].asset = { name: "b.jpg", license: "unknown", attribution: null, source: "own", ai_generated: false };
    scenes[2].asset = { name: "c.jpg", license: "cc_by", attribution: null, source: "stock", ai_generated: false };
    scenes[3].asset = { name: "d.jpg", license: "own_work", attribution: null, source: "own", ai_generated: false };
    const issues = validateStoryboard(sb, scenes, facts).filter((i) => i.message.includes("ไฟล์"));
    expect(issues.map((i) => [i.sceneId, i.level])).toEqual([
      ["s0", "block"],
      ["s1", "warn"],
      ["s2", "warn"],
    ]);
  });
});
