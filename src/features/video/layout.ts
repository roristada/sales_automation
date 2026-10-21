/*
 * Screen zones and text fitting for the 1080×1920 template. Each block of text has a fixed zone
 * and a font size chosen so its estimated height fits, so blocks can't grow into each other
 * (on-screen text used to run into the subtitles).
 */

/** Areas TikTok/Reels/Shorts cover with their own UI: keep text out of them. */
export const SAFE = { top: 150, bottom: 380, side: 70, right: 140 } as const;

export const ZONES = {
  hook: { top: SAFE.top, height: 190 },
  /** Over a full-screen clip the product fills the middle: scene text goes in the top band. */
  mediaText: { top: SAFE.top + 10, height: 170 },
  card: { top: 360, size: 700 },
  text: { top: 1100, height: 250 },
  /** Subtitles are bottom-anchored at SAFE.bottom; one cue line is at most ~100px tall. */
  subtitle: { bottom: SAFE.bottom },
} as const;

export const TEXT_WIDTH = 1080 - SAFE.side - SAFE.right;

// Thai vowel/tone marks above or below a consonant take no width of their own.
const COMBINING = /[ัิ-ฺ็-๎]/g;

/** Rough rendered width of text at a font size (Noto Sans Thai bold ≈ 0.52em per character). */
export function textWidth(text: string, fontSize: number): number {
  return text.replace(COMBINING, "").length * fontSize * 0.52;
}

/**
 * Largest size from `sizes` (descending) whose estimated wrapped height fits `maxHeight` within
 * `maxWidth`. Falls back to the smallest size.
 */
export function fitFontSize(text: string, opts: { maxWidth: number; maxHeight: number; sizes: number[]; lineHeight?: number; padding?: number }): number {
  const lh = opts.lineHeight ?? 1.3;
  const pad = opts.padding ?? 0;
  for (const size of opts.sizes) {
    const lines = Math.max(1, Math.ceil(textWidth(text, size) / (opts.maxWidth - pad)));
    if (lines * size * lh + pad <= opts.maxHeight) return size;
  }
  return opts.sizes[opts.sizes.length - 1];
}

/** "แบตเตอรี่: ใช้ได้ 7 ชั่วโมง" → label + value, for the spec callout; null when there's no label. */
export function splitLabel(text: string): { label: string; value: string } | null {
  const m = /^([^:：]{1,30})[:：]\s*(.+)$/.exec(text.trim());
  return m ? { label: m[1].trim(), value: m[2].trim() } : null;
}

/** Word-sized pieces of Thai/Latin text, for word-by-word animation. */
export function words(text: string): string[] {
  return [...new Intl.Segmenter("th", { granularity: "word" }).segment(text)].map((s) => s.segment);
}
