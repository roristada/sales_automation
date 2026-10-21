import { isOpenRouterConfigured } from "@/features/ai/openrouter";
import type { SourceConnection } from "@/features/sources/types";

/**
 * Thai voice-over status (AI-5): spoken through OpenRouter TTS by the render worker when the
 * user ticks it on a render (worker/voiceover.ts). Without it videos render with Thai subtitles
 * only (and a silent AAC track so every platform accepts the file).
 */
export function ttsStatus(): SourceConnection {
  return isOpenRouterConfigured()
    ? { state: "available", note: "ใช้ OpenRouter TTS — เลือก “ใส่เสียงพากย์ AI” ตอน render · จังหวะแต่ละฉากตามความยาวเสียงจริง · เลือกโมเดล/เสียงในหน้าตั้งค่า" }
    : { state: "not_connected", note: "ยังไม่ได้ตั้ง OPENROUTER_API_KEY — วิดีโอไม่มีเสียงพากย์ (มีซับไทย) และจังหวะมาจากการประมาณความยาวคำพูด" };
}
