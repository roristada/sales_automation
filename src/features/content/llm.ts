import type { SourceConnection } from "@/features/sources/types";
import type { Fact } from "./facts";
import type { SceneDraft } from "./templates";

/**
 * Optional AI writing help (PLAN.md §2: business logic never depends on a vendor).
 * Whatever a provider returns is marked text_origin "ai", and its claims start "pending",
 * so it goes through the same fact checks as template text. No provider is configured yet:
 * templates produce every draft.
 */
export interface LlmProvider {
  key: string;
  label: string;
  connection(): SourceConnection;
  /** Rewrites one scene using only the given facts. */
  rewriteScene(input: { productName: string; facts: Fact[]; scene: SceneDraft; instruction?: string }): Promise<SceneDraft>;
}

/** The configured provider, or null. Returns null until a provider and budget cap are chosen. */
export function getLlmProvider(): LlmProvider | null {
  return null;
}

export const LLM_STATUS: SourceConnection = {
  state: "not_connected",
  note: "ยังไม่ได้เชื่อมต่อ AI ผ่าน API — ใช้ปุ่ม “AI ช่วยเขียน” ในแต่ละฉากเพื่อคัดลอกคำสั่งไปใช้กับแชท AI ที่มี (เช่น Claude ที่ claude.ai) แล้ววางคำตอบกลับ",
};
