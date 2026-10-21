import { createHash } from "node:crypto";

/** tts_cache key: the same line with the same model, voice and delivery sounds the same. */
export function speechCacheKey(input: { model: string; voice: string | null; instructions: string | null; text: string }): string {
  return createHash("sha256").update(JSON.stringify([input.model, input.voice ?? "", input.instructions ?? "", input.text])).digest("hex");
}

/** Where a cached line is stored (storage keys are owner/uuid/file). */
export const speechStorageKey = (ownerId: string, entryId: string) => `${ownerId}/${entryId}/voice.mp3`;
