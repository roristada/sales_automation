import { describe, expect, it } from "vitest";
import { computeOpportunityScore, effectiveConfidence, type ScoreInput } from "./opportunity-score";

const full: ScoreInput = {
  price: 500,
  commission_rate: 10,
  commission_amount: 50,
  affiliate_url: "https://s.shopee.co.th/abc",
  image_url: "https://example.com/a.jpg",
  description: "หูฟังไร้สาย",
  provenance: { price: "imported_csv", commission_rate: "imported_csv", commission_amount: "imported_csv" },
};

const component = (r: ReturnType<typeof computeOpportunityScore>, key: string) => r.components.find((c) => c.key === key)!;

describe("computeOpportunityScore", () => {
  it("scores a complete product with high confidence", () => {
    const r = computeOpportunityScore(full);
    // per sale ฿50 → 55 + (20/30)*20 ≈ 68.3 → 68; rate 10% → 75; price ฿500 → 80; readiness 100
    expect(component(r, "commission_per_sale").score).toBe(68);
    expect(component(r, "commission_rate").score).toBe(75);
    expect(component(r, "price_fit").score).toBe(80);
    expect(component(r, "content_readiness").score).toBe(100);
    expect(r.score).toBe(Math.round((40 * 68 + 20 * 75 + 20 * 80 + 20 * 100) / 100));
    expect(r.confidence).toBe("high");
    expect(r.missing).toEqual([]);
  });

  it("returns no score without any commission data, and never fills values", () => {
    const r = computeOpportunityScore({ ...full, commission_rate: null, commission_amount: null });
    expect(r.score).toBeNull();
    expect(r.confidence).toBeNull();
    expect(component(r, "commission_per_sale").score).toBeNull();
    expect(r.missing).toContain("อัตราค่าคอม หรือค่าคอมต่อชิ้น");
  });

  it("derives commission per sale from price × rate and marks it derived", () => {
    const r = computeOpportunityScore({ ...full, commission_amount: null });
    const c = component(r, "commission_per_sale");
    expect(c.derived).toBe(true);
    expect(c.score).toBe(68);
    expect(r.confidence).toBe("high");
  });

  it("derives the rate from amount ÷ price", () => {
    const r = computeOpportunityScore({ ...full, commission_rate: null });
    expect(component(r, "commission_rate").derived).toBe(true);
    expect(component(r, "commission_rate").score).toBe(75);
  });

  it("leaves missing components out and lowers confidence instead of guessing", () => {
    const r = computeOpportunityScore({ ...full, price: null, commission_rate: null });
    // only per sale (฿50 → 68) and readiness (100) are known
    expect(component(r, "price_fit").score).toBeNull();
    expect(component(r, "commission_rate").score).toBeNull();
    expect(r.score).toBe(Math.round((40 * 68 + 20 * 100) / 60));
    expect(r.confidence).toBe("medium");
    expect(r.missing).toContain("ราคา");
  });

  it("gives low confidence when only commission rate is known", () => {
    const r = computeOpportunityScore({ ...full, price: null, commission_amount: null });
    expect(r.score).not.toBeNull();
    expect(r.confidence).toBe("low");
  });

  it("caps confidence at medium when values are AI estimates", () => {
    const r = computeOpportunityScore({ ...full, provenance: { ...full.provenance, price: "ai_estimate" } });
    expect(r.confidence).toBe("medium");
    expect(r.limitations.some((l) => l.includes("AI"))).toBe(true);
  });

  it("scores content readiness from what exists", () => {
    const r = computeOpportunityScore({ ...full, affiliate_url: null, description: null });
    expect(component(r, "content_readiness").score).toBe(25);
    expect(r.missing).toContain("ลิงก์ Affiliate");
  });

  it("always states it is not a sales forecast and that trend data is missing", () => {
    const r = computeOpportunityScore(full);
    expect(r.limitations.some((l) => l.includes("ไม่ใช่การคาดการณ์ยอดขาย"))).toBe(true);
    expect(r.limitations.some((l) => l.includes("เทรนด์"))).toBe(true);
  });

  it("clamps extreme values to 0–100", () => {
    const r = computeOpportunityScore({ ...full, price: 50_000, commission_rate: 80, commission_amount: 40_000 });
    for (const c of r.components) {
      expect(c.score!).toBeGreaterThanOrEqual(0);
      expect(c.score!).toBeLessThanOrEqual(100);
    }
    expect(component(r, "price_fit").score).toBe(15);
  });
});

describe("effectiveConfidence", () => {
  it("drops one level when data is stale", () => {
    expect(effectiveConfidence("high", true)).toBe("medium");
    expect(effectiveConfidence("medium", true)).toBe("low");
    expect(effectiveConfidence("low", true)).toBe("low");
    expect(effectiveConfidence("high", false)).toBe("high");
    expect(effectiveConfidence(null, true)).toBeNull();
  });
});
