import { type LicenseInput, licenseVerdict } from "@/features/assets/licensing";
import { claimFactKey, type Fact } from "./facts";

/**
 * Checks a storyboard before approval (PLAN.md M3: every claim cites a product fact; affiliate
 * disclosure present). "block" issues prevent approval; "warn" issues need a human look.
 */

export interface ValidationIssue {
  level: "block" | "warn";
  message: string;
  /** Scene the issue belongs to (null = whole storyboard). */
  sceneId: string | null;
  claimId?: string;
}

export interface VClaim {
  id: string;
  text: string;
  fact_id: string | null;
  product_field: string | null;
  review_status: string;
}

export interface VScene {
  id: string;
  position: number;
  narration: string;
  on_screen_text: string;
  visual_note: string;
  claims: VClaim[];
  /** The library asset shown in this scene, if any. */
  asset?: (LicenseInput & { name: string }) | null;
}

export interface VStoryboard {
  hook: string;
  caption: string;
  cta: string;
  disclosure: string;
  target_duration_s: number;
  literals: string[];
}

const PLACEHOLDER = /\[[^\]]+\]/;
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
const normNumber = (s: string) => s.replace(/,/g, "").replace(/\.0+$/, "");

/** Thai combining vowels/tone marks are not spoken as separate units. */
const THAI_MARKS = /[ัิ-ฺ็-๎]/g;
/** Rough Thai TTS speed in base characters per second; real timing comes from the audio (M4). */
export const CHARS_PER_SECOND = 11;
export const MIN_SCENE_SECONDS = 1.5;

export function estimateSceneSeconds(narration: string): number {
  const units = narration.replace(PLACEHOLDER, "").replace(THAI_MARKS, "").replace(/[\s.,!?…\-—:;"'()]/g, "").length;
  return Math.max(MIN_SCENE_SECONDS, Math.round((units / CHARS_PER_SECOND + 0.4) * 10) / 10);
}

export function estimateTotalSeconds(scenes: { narration: string }[]): number {
  return Math.round(scenes.reduce((s, sc) => s + estimateSceneSeconds(sc.narration), 0) * 10) / 10;
}

export function validateStoryboard(sb: VStoryboard, scenes: VScene[], facts: Fact[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byKey = new Map(facts.map((f) => [f.key, f]));
  const block = (message: string, sceneId: string | null = null, claimId?: string) => issues.push({ level: "block", message, sceneId, claimId });
  const warn = (message: string, sceneId: string | null = null, claimId?: string) => issues.push({ level: "warn", message, sceneId, claimId });

  if (!sb.disclosure.trim() || !sb.disclosure.includes("ค่าคอมมิชชัน")) block("ต้องมีข้อความเปิดเผยว่าเป็นลิงก์ affiliate และได้รับค่าคอมมิชชัน");
  if (!scenes.length) block("ยังไม่มีฉาก");
  if (!sb.hook.trim()) block("ยังไม่มี Hook");
  if (!sb.cta.trim()) warn("ยังไม่มี CTA");

  for (const [label, text] of [
    ["Hook", sb.hook],
    ["แคปชัน", sb.caption],
    ["CTA", sb.cta],
  ] as const) {
    if (PLACEHOLDER.test(text)) block(`${label} ยังมีช่อง [ ] ที่ต้องเติม`);
  }

  // Numbers the script may say: values of facts that claims cite. The template's own numbering
  // ("3 จุดเด่น", "1. …") is allowed only where templates write it: hook and on-screen text.
  const backed = new Set<string>();
  const literals = new Set(sb.literals.map(normNumber));
  // The product's own name (e.g. "Buds 3") is not a claim.
  for (const m of byKey.get("field:name")?.value?.match(NUMBER) ?? []) backed.add(normNumber(m));
  const usedFacts = new Set<string>();

  for (const s of scenes) {
    const n = s.position + 1;
    if (PLACEHOLDER.test(s.narration) || PLACEHOLDER.test(s.on_screen_text)) block(`ฉากที่ ${n} ยังมีช่อง [ ] ที่ต้องเติม`, s.id);
    if (!s.narration.trim() && !s.on_screen_text.trim()) warn(`ฉากที่ ${n} ไม่มีคำพูดและข้อความบนจอ`, s.id);
    if (s.asset) {
      const v = licenseVerdict(s.asset);
      if (v.level === "block") block(`ฉากที่ ${n}: ไฟล์ “${s.asset.name}” ${v.message}`, s.id);
      else if (v.level === "warn") warn(`ฉากที่ ${n}: ไฟล์ “${s.asset.name}” ${v.message}`, s.id);
    }

    for (const c of s.claims) {
      const key = claimFactKey(c);
      const fact = key ? byKey.get(key) : undefined;
      if (c.review_status === "rejected") {
        block(`ฉากที่ ${n}: claim “${c.text}” ถูกปฏิเสธแล้ว ให้แก้ข้อความในฉากและลบ claim นี้`, s.id, c.id);
        continue;
      }
      if (!key) {
        block(`ฉากที่ ${n}: claim “${c.text}” ยังไม่อ้างอิงข้อเท็จจริง`, s.id, c.id);
        continue;
      }
      if (!fact) {
        block(`ฉากที่ ${n}: claim “${c.text}” อ้างอิงข้อเท็จจริงที่ไม่มีแล้ว`, s.id, c.id);
        continue;
      }
      usedFacts.add(key);
      for (const m of fact.value?.match(NUMBER) ?? []) backed.add(normNumber(m));
      if (fact.status === "unavailable") block(`ฉากที่ ${n}: claim “${c.text}” อ้างอิง${fact.label}ที่ไม่มีข้อมูล`, s.id, c.id);
      else if (fact.status === "stale") block(`ฉากที่ ${n}: ${fact.label}เก่าแล้ว ตรวจสอบและอัปเดตข้อมูลสินค้าก่อน`, s.id, c.id);
      // AI-extracted facts must be confirmed against the source before a script can rely on them.
      else if (fact.status === "ai_estimate") block(`ฉากที่ ${n}: ${fact.label}เป็นข้อมูลที่ AI ดึงมา ยังไม่ได้ยืนยัน — กด “ยืนยันแล้ว” ในแท็บข้อเท็จจริงของสินค้าก่อน`, s.id, c.id);
      if (c.review_status !== "verified") block(`ฉากที่ ${n}: claim “${c.text}” ยังไม่ได้ตรวจ`, s.id, c.id);
    }
  }

  // Numbers in spoken/visible text that no cited fact contains.
  const texts: [string, string, string | null, boolean][] = [
    ["Hook", sb.hook, null, true],
    ["แคปชัน", sb.caption, null, false],
    ...scenes.flatMap((s) => [
      [`ฉากที่ ${s.position + 1}`, s.narration, s.id, false] as [string, string, string, boolean],
      [`ฉากที่ ${s.position + 1} (ข้อความบนจอ)`, s.on_screen_text, s.id, true] as [string, string, string, boolean],
    ]),
  ];
  for (const [where, text, sceneId, allowLiterals] of texts) {
    const unbacked = [...new Set((text.replace(PLACEHOLDER, "").match(NUMBER) ?? []).map(normNumber))].filter(
      (x) => !backed.has(x) && !(allowLiterals && literals.has(x)),
    );
    if (unbacked.length) warn(`${where}: ตัวเลข ${unbacked.join(", ")} ไม่ตรงกับข้อเท็จจริงที่ claim อ้างอิง — เพิ่ม claim หรือแก้ข้อความ`, sceneId);
  }

  const est = estimateTotalSeconds(scenes);
  if (scenes.length && est > sb.target_duration_s * 1.15) warn(`ความยาวโดยประมาณ ${est} วินาที เกินเป้าหมาย ${sb.target_duration_s} วินาที`);
  if (scenes.length && est < sb.target_duration_s * 0.5) warn(`ความยาวโดยประมาณ ${est} วินาที สั้นกว่าเป้าหมาย ${sb.target_duration_s} วินาทีมาก`);

  return issues;
}

export const canApprove = (issues: ValidationIssue[]) => !issues.some((i) => i.level === "block");
