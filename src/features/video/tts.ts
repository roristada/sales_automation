import type { SourceConnection } from "@/features/sources/types";

/**
 * Thai voice-over (PLAN.md §2 TtsProvider). Not configured yet: videos render silent (with a
 * silent AAC track so every platform accepts the file) and timing uses the speech estimate.
 * A provider returns audio per scene; its measured length then drives the timeline.
 */
export interface TtsProvider {
  key: string;
  label: string;
  connection(): SourceConnection;
  /** Writes speech for `text` to `outPath` and returns its duration in seconds. */
  synthesize(input: { text: string; voice: string; outPath: string }): Promise<{ seconds: number }>;
}

export function getTtsProvider(): TtsProvider | null {
  return null;
}

export const TTS_STATUS: SourceConnection = {
  state: "not_connected",
  note: "ยังไม่ได้เชื่อมต่อเสียงพากย์ — วิดีโอเป็นแบบไม่มีเสียงพากย์ (มีซับไทย) และจังหวะมาจากการประมาณความยาวคำพูด",
};
