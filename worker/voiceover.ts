/*
 * Voice-over for a render job (docs/AI_VIDEO_PLAN.md AI-5). Each scene's narration is spoken
 * through OpenRouter TTS once per (model, voice, delivery, text) and kept in tts_cache, so a
 * rerender or an unchanged line costs nothing. The measured MP3 length sets the scene's timing.
 * Every paid call is logged in ai_requests, including the ones before a failure.
 */
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { usdToThb } from "@/features/ai/models";
import { getGenerationCost, OpenRouterError, type SpeechModel, speak } from "@/features/ai/openrouter";
import { speechToMp3 } from "@/features/ai/pcm";
import { estimateSpeechUsd, speechText, VOICE_PAD_S } from "@/features/ai/voiceover";
import { speechCacheKey, speechStorageKey } from "@/features/ai/voiceover-key";
import { runFfprobe } from "@/features/video/ffprobe";
import { probeFacts } from "@/features/video/qa";
import type { StorageAdapter } from "@/features/video/storage";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;

export interface TtsSettings {
  model: string;
  voice: string | null;
  instructions: string | null;
}

export interface SceneVoice {
  storageKey: string;
  /** Length of the spoken line. */
  seconds: number;
}

export class VoiceoverError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** Seconds of scene time for a line (`audioSeconds` in the timeline). */
export const sceneSecondsFor = (v: SceneVoice) => v.seconds + VOICE_PAD_S;

export async function prepareVoiceover(
  db: Db,
  storage: StorageAdapter,
  input: { ownerId: string; storyboardId: string; productId: string | null; tts: TtsSettings; scenes: { id: string; position: number; narration: string }[]; catalog?: SpeechModel; tmp: string },
): Promise<{ byScene: Map<string, SceneVoice>; generated: number; reused: number; costThb: number }> {
  const byScene = new Map<string, SceneVoice>();
  const calls: { generationId: string | null; chars: number; seconds: number }[] = [];
  let reused = 0;
  let costThb = 0;
  try {
    for (const s of input.scenes) {
      const text = speechText(s.narration);
      if (!text) continue;
      const cacheKey = speechCacheKey({ ...input.tts, text });
      const { data: hit } = await db.from("tts_cache").select("storage_key, duration_s").eq("owner_id", input.ownerId).eq("cache_key", cacheKey).maybeSingle();
      if (hit && (await storage.size(hit.storage_key)) !== null) {
        byScene.set(s.id, { storageKey: hit.storage_key, seconds: hit.duration_s });
        reused++;
        continue;
      }

      let result: Awaited<ReturnType<typeof speak>>;
      try {
        result = await speak({ model: input.tts.model, text, voice: input.tts.voice, instructions: input.tts.instructions });
      } catch (e) {
        const msg = e instanceof OpenRouterError ? e.message : (e as Error).message;
        await logCall(db, input, "failed", { error: msg.slice(0, 1000) });
        throw new VoiceoverError(`เสียงพากย์ฉากที่ ${s.position + 1} ไม่สำเร็จ: ${msg}`, e instanceof OpenRouterError && e.retryable);
      }
      const file = path.join(input.tmp, `voice-${s.position}.mp3`);
      let mp3: Buffer;
      try {
        mp3 = await speechToMp3(result.audio, result.contentType);
      } catch (e) {
        calls.push({ generationId: result.generationId, chars: text.length, seconds: 0 });
        throw new VoiceoverError(`เสียงพากย์ฉากที่ ${s.position + 1}: ${(e as Error).message}`, false);
      }
      await writeFile(file, mp3);
      const seconds = probeFacts(await runFfprobe(file, { format: "mp3" })).durationS;
      calls.push({ generationId: result.generationId, chars: text.length, seconds: seconds ?? 0 });
      if (!seconds || seconds <= 0) throw new VoiceoverError(`ไฟล์เสียงฉากที่ ${s.position + 1} อ่านความยาวไม่ได้`, true);

      const id = randomUUID();
      const storageKey = speechStorageKey(input.ownerId, id);
      await storage.put(storageKey, file);
      const { error } = await db
        .from("tts_cache")
        .upsert({ id, owner_id: input.ownerId, cache_key: cacheKey, model: input.tts.model, voice: input.tts.voice, text_chars: text.length, storage_key: storageKey, mime: "audio/mpeg", duration_s: seconds }, { onConflict: "owner_id,cache_key" });
      if (error) throw new VoiceoverError(`บันทึกไฟล์เสียงไม่สำเร็จ: ${error.message}`, true);
      byScene.set(s.id, { storageKey, seconds });
    }
  } finally {
    // Billed calls are logged even when a later line fails. OpenRouter records the cost a few
    // seconds after the call; the catalog estimate stands in when it isn't there yet.
    for (const c of calls) {
      const actual = c.generationId ? await getGenerationCost(c.generationId) : null;
      const usd = actual ?? estimateSpeechUsd(input.catalog, c.chars, c.seconds);
      await logCall(db, input, "succeeded", { generationId: c.generationId, usd });
      costThb += usdToThb(usd);
    }
  }
  return { byScene, generated: calls.length, reused, costThb };
}

async function logCall(db: Db, input: { ownerId: string; storyboardId: string; productId: string | null; tts: TtsSettings }, status: "succeeded" | "failed", extra: { generationId?: string | null; usd?: number; error?: string }) {
  await db.from("ai_requests").insert({
    owner_id: input.ownerId,
    task: "tts",
    model: input.tts.model,
    status,
    generation_id: extra.generationId ?? null,
    cost_usd: extra.usd ?? 0,
    cost_thb: usdToThb(extra.usd ?? 0),
    error: extra.error ?? null,
    product_id: input.productId,
    storyboard_id: input.storyboardId,
  });
}
