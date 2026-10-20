import type { Provenance } from "@/features/products/schema";

/**
 * Explainable Opportunity Score (design.md §9.2, PLAN.md M2).
 *
 * Rules:
 * - Uses only values the product actually has. Missing values are never filled in; the component
 *   is left out of the weighted average and confidence goes down instead.
 * - Without any commission data there is no score (null), because commission is the core signal.
 * - The result is time-independent so it can be stored; staleness is applied at read time with
 *   `effectiveConfidence`.
 * - It ranks products by the data on hand. It is not a sales forecast.
 */

/** Bump when the formula changes; stored rows with an older version get recomputed. */
export const SCORE_VERSION = 1;

export type Confidence = "high" | "medium" | "low";
export type ComponentKey = "commission_per_sale" | "commission_rate" | "price_fit" | "content_readiness";

export interface ScoreComponent {
  key: ComponentKey;
  label: string;
  weight: number;
  /** 0–100, or null when the data needed is missing. */
  score: number | null;
  /** What the score is based on, in plain language. */
  evidence: string;
  /** True when the value was calculated from other fields rather than given directly. */
  derived?: boolean;
}

export interface OpportunityScore {
  version: number;
  score: number | null;
  confidence: Confidence | null;
  components: ScoreComponent[];
  /** Data that would make the score more complete. */
  missing: string[];
  /** What the score cannot tell you. */
  limitations: string[];
}

export interface ScoreInput {
  price: number | null;
  commission_rate: number | null;
  commission_amount: number | null;
  affiliate_url: string | null;
  image_url: string | null;
  description: string | null;
  provenance: Provenance;
}

const WEIGHTS: Record<ComponentKey, number> = {
  commission_per_sale: 40,
  commission_rate: 20,
  price_fit: 20,
  content_readiness: 20,
};

/** Piecewise-linear interpolation over sorted [x, y] anchors; clamps outside the range. */
function interpolate(x: number, anchors: readonly (readonly [number, number])[]): number {
  if (x <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i];
    if (x <= x1) {
      const [x0, y0] = anchors[i - 1];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return anchors[anchors.length - 1][1];
}

/** THB earned per sale → score. ฿100+ per sale is near the top. */
const PER_SALE_ANCHORS = [[0, 0], [10, 30], [30, 55], [60, 75], [100, 90], [200, 100]] as const;
/** Commission % → score. */
const RATE_ANCHORS = [[0, 0], [3, 30], [6, 55], [10, 75], [15, 90], [20, 100]] as const;
/** Price bands for buying straight from a short video (starting assumption, see limitations). */
const PRICE_BANDS = [
  { max: 300, score: 100, label: "ไม่เกิน ฿300" },
  { max: 1000, score: 80, label: "฿301–1,000" },
  { max: 3000, score: 55, label: "฿1,001–3,000" },
  { max: 10000, score: 30, label: "฿3,001–10,000" },
  { max: Infinity, score: 15, label: "มากกว่า ฿10,000" },
] as const;

const thb = (n: number) => `฿${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${Number(n.toFixed(2))}%`;
const round = (n: number) => Math.round(n);

export function computeOpportunityScore(p: ScoreInput): OpportunityScore {
  const missing: string[] = [];
  const limitations: string[] = [];

  // Commission per sale: given directly, or price × rate.
  let perSale: number | null = null;
  let perSaleDerived = false;
  if (p.commission_amount !== null) perSale = p.commission_amount;
  else if (p.price !== null && p.commission_rate !== null) {
    perSale = (p.price * p.commission_rate) / 100;
    perSaleDerived = true;
  }

  // Commission rate: given directly, or amount ÷ price.
  let rate: number | null = null;
  let rateDerived = false;
  if (p.commission_rate !== null) rate = p.commission_rate;
  else if (p.commission_amount !== null && p.price !== null && p.price > 0) {
    rate = (p.commission_amount / p.price) * 100;
    rateDerived = true;
  }

  const components: ScoreComponent[] = [
    {
      key: "commission_per_sale",
      label: "ค่าคอมต่อชิ้น",
      weight: WEIGHTS.commission_per_sale,
      score: perSale === null ? null : round(interpolate(perSale, PER_SALE_ANCHORS)),
      evidence:
        perSale === null
          ? "ไม่มีค่าคอมต่อชิ้น และคำนวณจากราคา × อัตราไม่ได้"
          : perSaleDerived
            ? `ประมาณ ${thb(perSale)} ต่อชิ้น (คำนวณจากราคา ${thb(p.price!)} × ${pct(p.commission_rate!)})`
            : `${thb(perSale)} ต่อชิ้น`,
      derived: perSaleDerived || undefined,
    },
    {
      key: "commission_rate",
      label: "อัตราค่าคอม",
      weight: WEIGHTS.commission_rate,
      score: rate === null ? null : round(interpolate(rate, RATE_ANCHORS)),
      evidence:
        rate === null
          ? "ไม่มีอัตราค่าคอม และคำนวณจากค่าคอม ÷ ราคาไม่ได้"
          : rateDerived
            ? `ประมาณ ${pct(rate)} (คำนวณจากค่าคอม ${thb(p.commission_amount!)} ÷ ราคา ${thb(p.price!)})`
            : pct(rate),
      derived: rateDerived || undefined,
    },
    (() => {
      const band = p.price === null ? null : PRICE_BANDS.find((b) => p.price! <= b.max)!;
      return {
        key: "price_fit" as const,
        label: "ราคาเหมาะกับการซื้อจากวิดีโอสั้น",
        weight: WEIGHTS.price_fit,
        score: band?.score ?? null,
        evidence: band ? `ราคา ${thb(p.price!)} อยู่ในช่วง ${band.label}` : "ไม่มีราคา",
      };
    })(),
    (() => {
      const parts = [
        { ok: !!p.affiliate_url, points: 50, label: "ลิงก์ Affiliate" },
        { ok: !!p.image_url, points: 25, label: "รูปภาพ" },
        { ok: !!p.description, points: 25, label: "รายละเอียดสินค้า" },
      ];
      const has = parts.filter((x) => x.ok);
      const lacks = parts.filter((x) => !x.ok);
      return {
        key: "content_readiness" as const,
        label: "ความพร้อมทำคอนเทนต์",
        weight: WEIGHTS.content_readiness,
        score: has.reduce((s, x) => s + x.points, 0),
        evidence: [has.length ? `มี${has.map((x) => x.label).join(", ")}` : null, lacks.length ? `ยังไม่มี${lacks.map((x) => x.label).join(", ")}` : null]
          .filter(Boolean)
          .join(" · "),
      };
    })(),
  ];

  if (p.price === null) missing.push("ราคา");
  if (p.commission_rate === null && p.commission_amount === null) missing.push("อัตราค่าคอม หรือค่าคอมต่อชิ้น");
  if (!p.affiliate_url) missing.push("ลิงก์ Affiliate");

  limitations.push("คะแนนยังไม่รวมข้อมูลเทรนด์หรือความต้องการของตลาด — ดูแท็บ “สัญญาณเทรนด์” แยกต่างหาก");
  limitations.push("ไม่มีข้อมูลยอดขายหรือ conversion — คะแนนนี้ใช้เปรียบเทียบสินค้า ไม่ใช่การคาดการณ์ยอดขาย");
  if (p.price !== null) limitations.push("ช่วงราคาที่เหมาะกับวิดีโอสั้นเป็นสมมติฐานเริ่มต้น ยังไม่ได้ปรับจากผลจริง");

  const estimated = (["price", "commission_rate", "commission_amount"] as const).filter((f) => p[f] !== null && p.provenance[f] === "ai_estimate");
  if (estimated.length) limitations.push("ราคาหรือค่าคอมบางส่วนเป็นค่าประมาณจาก AI ไม่ใช่ข้อมูลจากแหล่งจริง");

  // No commission data at all → no score.
  if (perSale === null && rate === null) {
    return { version: SCORE_VERSION, score: null, confidence: null, components, missing, limitations };
  }

  const used = components.filter((c) => c.score !== null);
  const usedWeight = used.reduce((s, c) => s + c.weight, 0);
  const totalWeight = components.reduce((s, c) => s + c.weight, 0);
  const score = round(used.reduce((s, c) => s + c.weight * c.score!, 0) / usedWeight);

  const coverage = usedWeight / totalWeight;
  let confidence: Confidence = coverage >= 0.999 ? "high" : coverage >= 0.6 ? "medium" : "low";
  if (estimated.length && confidence === "high") confidence = "medium";

  return { version: SCORE_VERSION, score, confidence, components, missing, limitations };
}

/** Applies staleness to a stored confidence: stale price/commission data lowers it one level. */
export function effectiveConfidence(stored: Confidence | null, stale: boolean): Confidence | null {
  if (stored === null || !stale) return stored;
  return stored === "high" ? "medium" : "low";
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: "ความเชื่อมั่นสูง",
  medium: "ความเชื่อมั่นปานกลาง",
  low: "ความเชื่อมั่นต่ำ",
};
