import { estimateSceneSeconds } from "@/features/content/validate";
import type { SpeechModel } from "./openrouter";

/**
 * Thai voice-over (docs/AI_VIDEO_PLAN.md AI-5). The render worker speaks each scene's narration
 * through OpenRouter TTS; the measured length of each line sets the scene's timing. A line with
 * the same model, voice, delivery and text is generated once and reused (tts_cache).
 */

/**
 * Voices for models that need one; others use their provider's default. Picked by ear on a Thai
 * product line (2026-10-22): Gemini Puck; ElevenLabs refuses a request without a voice, so it
 * gets its stock multilingual voice "Rachel" (by id).
 */
const DEFAULT_VOICE: { prefix: string; voice: string }[] = [
  { prefix: "google/", voice: "Puck" },
  { prefix: "elevenlabs/", voice: "21m00Tcm4TlvDq8ikWAM" },
];

/** Gemini TTS voices (Google's list), offered in Settings when a Gemini model is picked. */
export const GEMINI_VOICES = ["Puck", "Kore", "Zephyr", "Charon", "Leda", "Aoede", "Fenrir", "Orus", "Callirrhoe", "Autonoe", "Sulafat", "Achird"] as const;

export function voiceFor(model: string, picked: string | null | undefined): string | null {
  if (picked) return picked;
  return DEFAULT_VOICE.find((d) => model.startsWith(d.prefix))?.voice ?? null;
}

export const VOICE_PATTERN = /^[A-Za-z0-9_.:-]{1,100}$/;

/** Delivery directions; models without support ignore them. */
export const TTS_INSTRUCTIONS = "Speak natural Thai, warm and friendly, like a short upbeat product review. Clear and moderately paced.";

/** Silence after each line before the next scene starts. */
export const VOICE_PAD_S = 0.35;

/** Narration as spoken: whitespace collapsed; empty means the scene has no voice. */
export const speechText = (narration: string) => narration.replace(/\s+/g, " ").trim();

/** Gemini TTS is priced per token; its audio runs at about 32 tokens per second. */
const AUDIO_TOKENS_PER_SECOND = 32;

/**
 * USD estimate for speaking `chars` characters (about `seconds` long). Unknown models get a
 * cautious $100 per million characters.
 */
export function estimateSpeechUsd(model: Pick<SpeechModel, "id" | "prompt" | "completion"> | undefined, chars: number, seconds: number): number {
  if (!model) return chars * 0.0001;
  const perSecond = model.id.startsWith("google/") ? model.completion * AUDIO_TOKENS_PER_SECOND : model.completion;
  return model.prompt * chars + perSecond * seconds;
}

/** Estimate for a whole script, from the lines and the Thai speech-rate estimate. */
export function estimateVoiceoverUsd(model: Pick<SpeechModel, "id" | "prompt" | "completion"> | undefined, narrations: string[]): number {
  return narrations.map(speechText).filter(Boolean).reduce((n, t) => n + estimateSpeechUsd(model, t.length, estimateSceneSeconds(t)), 0);
}

/** "ฟรี", "$80 ต่อล้านตัวอักษร", "$0.5 / $9 ต่อล้าน token", "$0.0025/วินาที". */
export function speechPriceLabel(m: Pick<SpeechModel, "id" | "prompt" | "completion">): string {
  if (m.prompt === 0 && m.completion === 0) return "ฟรี";
  const perM = (n: number) => `$${+(n * 1_000_000).toPrecision(3)}`;
  if (m.id.startsWith("google/")) return `${perM(m.prompt)} / ${perM(m.completion)} ต่อล้าน token`;
  if (m.prompt === 0) return `$${m.completion}/วินาที`;
  return `${perM(m.prompt)} ต่อล้านตัวอักษร`;
}

/** Music volume under the voice, and alone. */
export const MUSIC_VOLUME = { withVoice: 0.12, alone: 0.35 } as const;
