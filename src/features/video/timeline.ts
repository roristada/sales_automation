import { END_CARD_SECONDS as END_CARD, estimateSceneSeconds } from "@/features/content/validate";

/**
 * Turns an approved storyboard into a frame-exact video plan: scene timing, subtitle cues and the
 * end card. With a voice-over (AI-5) each scene lasts as long as its spoken line (`audioSeconds`);
 * without one, timing comes from the Thai speech estimate.
 */

export const VIDEO = { width: 1080, height: 1920, fps: 30 } as const;
// 2: zoned layout (no text overlap), product photo per scene, spec/price/step callouts, motion.
// 3: transitions between scenes (the outgoing scene stays under the incoming one), voice, music.
// 4: scene text over a full-screen clip moves to the top band; no disclosure on the video itself
//    (the user's choice — it is in the post caption, which publishing requires).
export const RENDERER_VERSION = 4;

/** How a scene enters from the previous one; "auto" = the template default (crossfade). */
export const TRANSITIONS = ["auto", "cut", "fade", "slide", "zoom"] as const;
export type TransitionChoice = (typeof TRANSITIONS)[number];
export type Transition = Exclude<TransitionChoice, "auto">;
export const TRANSITION_LABEL: Record<TransitionChoice, string> = { auto: "อัตโนมัติ (เฟด)", cut: "ตัดทันที", fade: "เฟด", slide: "เลื่อนเข้า", zoom: "ซูมเข้า" };
/** Overlap between two scenes for every transition but a cut (0.4 s at 30 fps). */
export const TRANSITION_FRAMES = 12;

export function resolveTransition(choice: string | null | undefined, index: number): Transition {
  if (index === 0) return "cut";
  return choice && choice !== "auto" && (TRANSITIONS as readonly string[]).includes(choice) ? (choice as Transition) : "fade";
}

/** Longest subtitle line, in characters; ~2 lines of this fit the 1080px frame at the chosen size. */
export const SUBTITLE_MAX_CHARS = 26;
const MIN_SCENE_SECONDS = 2;
const HOOK_SECONDS = 2.5;
// Same end card length the script validation counts.
const END_CARD_SECONDS = END_CARD;

/** A library image/clip shown full-screen in a scene instead of the product card. */
export interface SceneMedia {
  kind: "image" | "video";
  src: string;
  /** Clip length; shorter clips loop for the scene's duration. */
  durationS: number | null;
}

export interface TimelineScene {
  id: string;
  kind: string;
  narration: string;
  onScreenText: string;
  from: number;
  duration: number;
  media: SceneMedia | null;
  /** Product photo for this scene (cycles through `images`); null → name card. */
  image: string | null;
  /** Small label over the card: "จุดเด่น 2", "ขั้นที่ 1", "ราคา"; null for none. */
  badge: string | null;
  /** 0, 1, 2… — alternates entrance side and camera move between scenes. */
  index: number;
  /** Spoken narration for this scene (MP3 URL); null = silent. */
  audio: string | null;
  /** How this scene enters (the first scene always cuts in). */
  transition: Transition;
}

export interface SubtitleCue {
  from: number;
  duration: number;
  text: string;
}

export interface VideoProps {
  [key: string]: unknown;
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  productName: string;
  /** Main photo (data: URI or http(s) URL); null → name card instead of a photo. */
  imageSrc: string | null;
  /** Main photo first, then extra photos; empty when there are none. */
  images: string[];
  hook: string;
  hookDuration: number;
  cta: string;
  /** Short button label for the end card: the CTA scene's on-screen text, else the CTA's first words. */
  ctaLabel: string;
  disclosure: string;
  scenes: TimelineScene[];
  cues: SubtitleCue[];
  endCard: { from: number; duration: number };
  /** Background music, looped for the whole video; null = none. */
  music: { src: string; volume: number } | null;
}

export interface TimelineInput {
  productName: string;
  imageSrc: string | null;
  /** Extra product photos; scenes without library media cycle through main + these. */
  gallery?: string[];
  hook: string;
  cta: string;
  disclosure: string;
  /** `audioSeconds`: how long the scene lasts with its voice line (audio length + a pause). */
  scenes: { id: string; kind: string; narration: string; on_screen_text: string; audioSeconds?: number; audio?: string | null; media?: SceneMedia | null; transition?: string | null }[];
  music?: { src: string; volume: number } | null;
}

/** Word-aware split of Thai/Latin text into lines of at most `max` characters. */
export function splitSubtitle(text: string, max = SUBTITLE_MAX_CHARS): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const words = [...new Intl.Segmenter("th", { granularity: "word" }).segment(clean)].map((s) => s.segment);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line && (line + w).trimEnd().length > max) {
      lines.push(line.trim());
      line = w.trimStart();
    } else {
      line += w;
    }
    // A single "word" longer than a line (e.g. a URL) is hard-wrapped.
    while (line.length > max) {
      lines.push(line.slice(0, max));
      line = line.slice(max);
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

const toFrames = (seconds: number, fps: number) => Math.max(1, Math.round(seconds * fps));

const BADGE: Record<string, string> = { feature: "จุดเด่น", step: "ขั้นที่", price: "ราคา" };

export function buildTimeline(input: TimelineInput, fps: number = VIDEO.fps): VideoProps {
  let cursor = 0;
  const scenes: TimelineScene[] = [];
  const cues: SubtitleCue[] = [];
  const images = [input.imageSrc, ...(input.gallery ?? [])].filter((x): x is string => !!x);
  const counts: Record<string, number> = {};
  let photo = 0;

  for (const [index, s] of input.scenes.entries()) {
    const seconds = Math.max(MIN_SCENE_SECONDS, s.audioSeconds ?? estimateSceneSeconds(s.narration) + 0.3);
    const duration = toFrames(seconds, fps);
    counts[s.kind] = (counts[s.kind] ?? 0) + 1;
    const badge = BADGE[s.kind] ? (s.kind === "price" ? BADGE.price : `${BADGE[s.kind]} ${counts[s.kind]}`) : null;
    // Photos advance only on scenes that show one, so a library clip doesn't skip a photo.
    const image = s.media || !images.length ? null : images[photo++ % images.length];
    scenes.push({ id: s.id, kind: s.kind, narration: s.narration, onScreenText: s.on_screen_text, from: cursor, duration, media: s.media ?? null, image, badge, index, audio: s.audio ?? null, transition: resolveTransition(s.transition, index) });

    // Cues share the scene time in proportion to their length, so long lines stay on longer.
    const lines = splitSubtitle(s.narration);
    const total = lines.reduce((n, l) => n + l.length, 0);
    let at = cursor;
    lines.forEach((text, i) => {
      const end = i === lines.length - 1 ? cursor + duration : at + Math.round((duration * text.length) / total);
      cues.push({ from: at, duration: Math.max(1, end - at), text });
      at = end;
    });
    cursor += duration;
  }

  const endCard = { from: cursor, duration: toFrames(END_CARD_SECONDS, fps) };
  const firstScene = scenes[0]?.duration ?? 0;
  return {
    fps,
    width: VIDEO.width,
    height: VIDEO.height,
    durationInFrames: endCard.from + endCard.duration,
    productName: input.productName,
    imageSrc: input.imageSrc,
    images,
    hook: input.hook,
    hookDuration: Math.min(toFrames(HOOK_SECONDS, fps), firstScene || toFrames(HOOK_SECONDS, fps)),
    cta: input.cta,
    ctaLabel: ctaLabel(input.cta, [...input.scenes].reverse().find((s) => s.kind === "cta")?.on_screen_text ?? ""),
    disclosure: input.disclosure,
    scenes,
    cues,
    endCard,
    music: input.music ?? null,
  };
}

/** A CTA short enough for a one-line button (~22 characters). */
export function ctaLabel(cta: string, sceneText: string): string {
  const own = sceneText.trim();
  if (own && own.length <= 26) return own;
  const words = (own || cta).replace(/\s+/g, " ").trim().split(" ");
  let out = "";
  for (const w of words) {
    if (out && (out + " " + w).length > 22) break;
    out = out ? `${out} ${w}` : w;
  }
  return out;
}

function stamp(frames: number, fps: number, sep: "," | ".") {
  const ms = Math.round((frames / fps) * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

/** Subtitles for upload with the video (the spoken lines only; the disclosure is in the caption). */
export function toSrt(props: VideoProps): string {
  const cues = props.cues;
  return cues.map((c, i) => `${i + 1}\n${stamp(c.from, props.fps, ",")} --> ${stamp(c.from + c.duration, props.fps, ",")}\n${c.text}\n`).join("\n");
}

export function toVtt(props: VideoProps): string {
  const cues = props.cues;
  return `WEBVTT\n\n${cues.map((c) => `${stamp(c.from, props.fps, ".")} --> ${stamp(c.from + c.duration, props.fps, ".")}\n${c.text}\n`).join("\n")}`;
}
