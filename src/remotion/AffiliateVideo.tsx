import { loadFont } from "@remotion/google-fonts/NotoSansThai";
import { AbsoluteFill, Html5Audio, Img, interpolate, Loop, OffthreadVideo, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { fitFontSize, SAFE, splitLabel, TEXT_WIDTH, textWidth, words, ZONES } from "@/features/video/layout";
import { ctaLabel, type SceneMedia, type TimelineScene, type Transition, TRANSITION_FRAMES, type VideoProps } from "@/features/video/timeline";

/*
 * 1080×1920 vertical affiliate video. Every text block has its own zone (layout.ts) and a font
 * size that fits it, so nothing overlaps; all of it stays out of the areas TikTok/Reels/Shorts
 * cover with their own UI. Motion is generated from the frame number only (deterministic).
 */

const { fontFamily } = loadFont("normal", { weights: ["400", "700", "800"], subsets: ["thai", "latin"] });

const C = {
  bg1: "#0f172a",
  bg2: "#312e81",
  glow1: "rgba(250, 204, 21, 0.22)",
  glow2: "rgba(129, 140, 248, 0.30)",
  text: "#ffffff",
  ink: "#0f172a",
  accent: "#facc15",
  accent2: "#f97316",
  pill: "rgba(15, 23, 42, 0.82)",
  card: "#ffffff",
};
const CENTER_X = 1080 / 2;

/** Gradient plus the main photo blurred behind everything, drifting slowly; two soft glows move across. */
function Background({ imageSrc }: { imageSrc: string | null }) {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 90) * 40;
  return (
    <AbsoluteFill style={{ background: `linear-gradient(180deg, ${C.bg1} 0%, ${C.bg2} 100%)`, overflow: "hidden" }}>
      {imageSrc && (
        <Img
          src={imageSrc}
          style={{ position: "absolute", inset: -120, width: "calc(100% + 240px)", height: "calc(100% + 240px)", objectFit: "cover", filter: "blur(70px) brightness(0.42)", transform: `translate(${drift}px, ${-drift / 2}px) scale(1.1)` }}
        />
      )}
      <div style={{ position: "absolute", width: 900, height: 900, borderRadius: "50%", left: -300 + Math.sin(frame / 70) * 120, top: 200 + Math.cos(frame / 80) * 100, background: `radial-gradient(circle, ${C.glow1} 0%, transparent 65%)` }} />
      <div style={{ position: "absolute", width: 1000, height: 1000, borderRadius: "50%", right: -380 + Math.cos(frame / 60) * 140, top: 900 + Math.sin(frame / 75) * 120, background: `radial-gradient(circle, ${C.glow2} 0%, transparent 65%)` }} />
    </AbsoluteFill>
  );
}

/** Product photo card: slides in from alternating sides, gentle float, a camera move per scene and one light sweep. */
function ProductCard({ imageSrc, productName, duration, index }: { imageSrc: string | null; productName: string; duration: number; index: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 16, mass: 0.8 }, durationInFrames: 18 });
  const side = index % 2 === 0 ? -1 : 1;
  const t = Math.min(1, frame / Math.max(1, duration));
  // Camera move: zoom in, zoom out, or pan, depending on the scene.
  const move = index % 3;
  const scale = move === 0 ? 1 + 0.12 * t : move === 1 ? 1.12 - 0.12 * t : 1.08;
  const panX = move === 2 ? interpolate(t, [0, 1], [-4, 4]) : 0;
  const float = Math.sin(frame / 18) * 8;
  const sweep = interpolate(frame, [10, 34], [-120, 220], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const { top, size } = ZONES.card;
  return (
    <div
      style={{
        position: "absolute",
        top,
        left: CENTER_X - size / 2,
        width: size,
        height: size,
        borderRadius: 52,
        background: C.card,
        overflow: "hidden",
        boxShadow: "0 50px 100px rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: enter,
        transform: `translate(${side * (1 - enter) * 160}px, ${float}px) rotate(${side * (1 - enter) * 6}deg) scale(${0.88 + 0.12 * enter})`,
      }}
    >
      {imageSrc ? (
        <Img src={imageSrc} style={{ width: "100%", height: "100%", objectFit: "contain", transform: `scale(${scale}) translateX(${panX}%)` }} />
      ) : (
        <div style={{ padding: 60, fontFamily, fontWeight: 800, fontSize: fitFontSize(productName, { maxWidth: size - 120, maxHeight: size - 120, sizes: [84, 72, 60, 50, 42], lineHeight: 1.25 }), lineHeight: 1.25, color: C.ink, textAlign: "center" }}>
          {productName}
        </div>
      )}
      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(105deg, transparent ${sweep - 20}%, rgba(255,255,255,0.55) ${sweep}%, transparent ${sweep + 20}%)`, mixBlendMode: "screen" }} />
    </div>
  );
}

/** "จุดเด่น 1" / "ขั้นที่ 2" / "ราคา" on the card's top edge. */
function Badge({ text }: { text: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - 6, fps, config: { damping: 10 }, durationInFrames: 16 });
  return (
    <div style={{ position: "absolute", top: ZONES.card.top - 34, left: CENTER_X - ZONES.card.size / 2 + 36, transform: `scale(${s}) rotate(${(1 - s) * -12}deg)`, transformOrigin: "left center" }}>
      <div style={{ fontFamily, fontWeight: 800, fontSize: 40, color: C.ink, background: C.accent, padding: "10px 26px", borderRadius: 999, boxShadow: "0 12px 30px rgba(0,0,0,0.35)" }}>{text}</div>
    </div>
  );
}

/** Words appear one after another with a small rise. */
function WordReveal({ text, delay = 0, step = 2 }: { text: string; delay?: number; step?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <>
      {words(text).map((w, i) => {
        const s = spring({ frame: frame - delay - i * step, fps, config: { damping: 200 }, durationInFrames: 10 });
        return (
          <span key={i} style={{ display: "inline-block", whiteSpace: "pre", opacity: s, transform: `translateY(${(1 - s) * 24}px)` }}>
            {w}
          </span>
        );
      })}
    </>
  );
}

/** The zone below the card: text never grows past it (font size is fitted). */
function TextZone({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: "absolute", top: ZONES.text.top, height: ZONES.text.height, left: SAFE.side, width: TEXT_WIDTH, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      {children}
    </div>
  );
}

const TEXT_SIZES = [72, 62, 54, 46, 40];

function OnScreenText({ text }: { text: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 10 });
  const size = fitFontSize(text, { maxWidth: TEXT_WIDTH, maxHeight: ZONES.text.height, sizes: TEXT_SIZES, padding: 28 });
  return (
    <TextZone>
      <div style={{ fontFamily, fontWeight: 800, fontSize: size, lineHeight: 1.3, color: C.ink, background: C.accent, padding: "14px 32px", borderRadius: 24, textAlign: "center", opacity: s, transform: `scale(${0.92 + 0.08 * s})` }}>
        <WordReveal text={text} delay={2} />
      </div>
    </TextZone>
  );
}

/** "กันน้ำ: IP55" → small label over a big value, for feature scenes. */
function SpecCallout({ label, value }: { label: string; value: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: frame - 4, fps, config: { damping: 9 }, durationInFrames: 18 });
  const labelSize = fitFontSize(label, { maxWidth: TEXT_WIDTH, maxHeight: 60, sizes: [44, 38, 32] });
  const valueSize = fitFontSize(value, { maxWidth: TEXT_WIDTH, maxHeight: ZONES.text.height - 90, sizes: [96, 80, 66, 56, 48, 40], lineHeight: 1.15, padding: 24 });
  return (
    <TextZone>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, fontFamily, textAlign: "center" }}>
        <div style={{ fontWeight: 700, fontSize: labelSize, color: C.accent, letterSpacing: 1 }}>
          <WordReveal text={label} />
        </div>
        <div style={{ fontWeight: 800, fontSize: valueSize, lineHeight: 1.15, color: C.text, textShadow: "0 8px 30px rgba(0,0,0,0.55)", transform: `scale(${0.6 + 0.4 * pop})`, opacity: Math.min(1, pop * 1.5) }}>{value}</div>
      </div>
    </TextZone>
  );
}

/** Price scene: a tilted tag that pops in and wobbles once, with a note that prices change. */
function PriceTag({ text }: { text: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: frame - 4, fps, config: { damping: 7, stiffness: 160 }, durationInFrames: 24 });
  const size = fitFontSize(text, { maxWidth: TEXT_WIDTH - 120, maxHeight: 150, sizes: [120, 100, 84, 70, 58], lineHeight: 1.1, padding: 40 });
  return (
    <TextZone>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <div
          style={{
            fontFamily,
            fontWeight: 800,
            fontSize: size,
            lineHeight: 1.1,
            color: C.ink,
            background: `linear-gradient(135deg, ${C.accent} 0%, ${C.accent2} 100%)`,
            padding: "18px 48px",
            borderRadius: 28,
            boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
            transform: `rotate(${-5 + (1 - pop) * 14}deg) scale(${pop})`,
          }}
        >
          {text}
        </div>
        <div style={{ fontFamily, fontWeight: 400, fontSize: 32, color: C.text, opacity: interpolate(frame, [14, 24], [0, 0.9], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>ราคา ณ วันที่ทำคลิป อาจเปลี่ยนแปลงได้</div>
      </div>
    </TextZone>
  );
}

/** Call-to-action button that pulses, with an arrow nudging toward the link. */
function CtaButton({ text }: { text: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 12 }, durationInFrames: 16 });
  const pulse = 1 + Math.max(0, Math.sin(frame / 6)) * 0.05;
  const nudge = Math.abs(Math.sin(frame / 5)) * 14;
  // One line: the size that fits the width (the label is kept short by ctaLabel).
  const size = [68, 60, 52, 46, 40].find((s) => textWidth(text, s) + s * 1.4 + 80 <= TEXT_WIDTH - 40) ?? 40;
  return (
    // Own zone without clipping: the pulse ring and shadow must not be cut into a box.
    <div style={{ position: "absolute", top: ZONES.text.top, height: ZONES.text.height, left: SAFE.side, width: TEXT_WIDTH, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, whiteSpace: "nowrap", fontFamily, fontWeight: 800, fontSize: size, color: C.ink, background: C.accent, padding: "18px 40px", borderRadius: 999, boxShadow: `0 0 0 ${8 * (pulse - 1) * 20}px rgba(250,204,21,0.25), 0 16px 40px rgba(0,0,0,0.3)`, transform: `scale(${enter * pulse})` }}>
        <span>{text}</span>
        <svg width={size * 0.8} height={size * 0.8} viewBox="0 0 24 24" style={{ transform: `translateY(${nudge * 0.4}px)` }} aria-hidden>
          <path d="M12 4v13m0 0-6-6m6 6 6-6" stroke={C.ink} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

function Subtitle({ text }: { text: string }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 4], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", bottom: ZONES.subtitle.bottom, left: SAFE.side, width: TEXT_WIDTH, display: "flex", justifyContent: "center", opacity }}>
      <div style={{ fontFamily, fontWeight: 700, fontSize: 54, lineHeight: 1.35, color: C.text, background: C.pill, padding: "10px 26px", borderRadius: 18, textAlign: "center" }}>{text}</div>
    </div>
  );
}

function Hook({ text }: { text: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 12 }, durationInFrames: 14 });
  const size = fitFontSize(text, { maxWidth: TEXT_WIDTH, maxHeight: ZONES.hook.height, sizes: [64, 56, 50, 44, 38], lineHeight: 1.25 });
  return (
    <div style={{ position: "absolute", top: ZONES.hook.top, height: ZONES.hook.height, left: SAFE.side, width: TEXT_WIDTH, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontFamily, fontWeight: 800, fontSize: size, lineHeight: 1.25, color: C.text, textAlign: "center", textShadow: "0 6px 24px rgba(0,0,0,0.6)", transform: `scale(${0.9 + 0.1 * s})` }}>
        <WordReveal text={text} step={3} />
      </div>
    </div>
  );
}

/** Full-screen library media with a slow zoom (images) or a muted, looping clip (video). */
function FullBleed({ media, duration }: { media: SceneMedia; duration: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = interpolate(frame, [0, Math.max(1, duration)], [1.04, 1.12], { extrapolateRight: "clamp" });
  const fade = interpolate(frame, [0, 6], [0, 1], { extrapolateRight: "clamp" });
  const cover = { width: "100%", height: "100%", objectFit: "cover" as const };
  const clipFrames = media.durationS ? Math.max(1, Math.floor(media.durationS * fps)) : null;
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      {media.kind === "image" ? (
        <Img src={media.src} style={{ ...cover, transform: `scale(${scale})` }} />
      ) : clipFrames && clipFrames < duration ? (
        <Loop durationInFrames={clipFrames}>
          <OffthreadVideo src={media.src} muted style={cover} />
        </Loop>
      ) : (
        <OffthreadVideo src={media.src} muted style={cover} />
      )}
      {/* Darken top and bottom so the hook, on-screen text and subtitles stay readable. */}
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 28%, rgba(0,0,0,0) 50%, rgba(0,0,0,0.7) 100%)" }} />
    </AbsoluteFill>
  );
}

/** Scene text over a full-screen clip: top band, smaller, on a see-through dark pill. */
function MediaCaption({ text }: { text: string }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" });
  const size = fitFontSize(text, { maxWidth: TEXT_WIDTH, maxHeight: ZONES.mediaText.height, sizes: [56, 50, 44, 38], padding: 24 });
  return (
    <div style={{ position: "absolute", top: ZONES.mediaText.top, height: ZONES.mediaText.height, left: SAFE.side, width: TEXT_WIDTH, display: "flex", alignItems: "flex-start", justifyContent: "center", overflow: "hidden", opacity }}>
      <div style={{ fontFamily, fontWeight: 800, fontSize: size, lineHeight: 1.3, color: C.text, background: "rgba(15, 23, 42, 0.62)", padding: "10px 26px", borderRadius: 20, textAlign: "center", textShadow: "0 2px 10px rgba(0,0,0,0.4)" }}>{text}</div>
    </div>
  );
}

function SceneText({ scene }: { scene: TimelineScene }) {
  const text = scene.onScreenText.trim();
  if (!text) return null;
  if (scene.media) return <MediaCaption text={text} />;
  if (scene.kind === "price") return <PriceTag text={text} />;
  if (scene.kind === "cta") return <CtaButton text={ctaLabel(text, text)} />;
  const spec = scene.kind === "feature" ? splitLabel(text) : null;
  return spec ? <SpecCallout label={spec.label} value={spec.value} /> : <OnScreenText text={text} />;
}

function SceneLayer({ scene, productName, textDelay }: { scene: TimelineScene; productName: string; textDelay: number }) {
  return (
    <>
      {scene.media ? <FullBleed media={scene.media} duration={scene.duration + TRANSITION_FRAMES} /> : <ProductCard imageSrc={scene.image} productName={productName} duration={scene.duration} index={scene.index} />}
      {scene.badge && !scene.media && <Badge text={scene.badge} />}
      {/* Over a clip the text shares the top band with the hook: it waits until the hook is gone. */}
      <Sequence from={scene.media ? textDelay : 0} name="scene text" layout="none">
        <SceneText scene={scene} />
      </Sequence>
    </>
  );
}

/**
 * The scene's entrance over the previous one. Scenes (except the last) stay on screen for
 * TRANSITION_FRAMES past their end, under the next scene, so a fade is a real crossfade.
 */
function Enter({ transition, children }: { transition: Transition; children: React.ReactNode }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (transition === "cut") return <AbsoluteFill>{children}</AbsoluteFill>;
  const t = interpolate(frame, [0, TRANSITION_FRAMES], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (transition === "slide") {
    const s = spring({ frame, fps, config: { damping: 18, mass: 0.7 }, durationInFrames: TRANSITION_FRAMES + 4 });
    return <AbsoluteFill style={{ transform: `translateX(${(1 - s) * 100}%)` }}>{children}</AbsoluteFill>;
  }
  if (transition === "zoom") return <AbsoluteFill style={{ opacity: t, transform: `scale(${1.18 - 0.18 * t})` }}>{children}</AbsoluteFill>;
  return <AbsoluteFill style={{ opacity: t }}>{children}</AbsoluteFill>;
}

export function AffiliateVideo(props: VideoProps) {
  const main = props.images?.[0] ?? props.imageSrc;
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg1 }}>
      <Background imageSrc={main} />
      {props.scenes.map((s, i) => {
        // Stay under the next scene (or the end card) while it comes in, unless it cuts.
        const next = props.scenes[i + 1];
        const tail = !next || next.transition !== "cut" ? TRANSITION_FRAMES : 0;
        return (
          <Sequence key={s.id} from={s.from} durationInFrames={s.duration + tail} name={`scene ${s.kind}`}>
            <Enter transition={s.transition}>
              <SceneLayer scene={s} productName={props.productName} textDelay={s.index === 0 && props.hook ? props.hookDuration : 0} />
            </Enter>
          </Sequence>
        );
      })}
      {props.scenes.map(
        (s) =>
          s.audio && (
            <Sequence key={`voice-${s.id}`} from={s.from} durationInFrames={s.duration} name="voice">
              <Html5Audio src={s.audio} name="voice" />
            </Sequence>
          ),
      )}
      {props.cues.map((c, i) => (
        <Sequence key={i} from={c.from} durationInFrames={c.duration} name="subtitle">
          <Subtitle text={c.text} />
        </Sequence>
      ))}
      {props.hook && (
        <Sequence from={0} durationInFrames={props.hookDuration} name="hook">
          <Hook text={props.hook} />
        </Sequence>
      )}
      <Sequence from={props.endCard.from} durationInFrames={props.endCard.duration} name="end card">
        <Enter transition="fade">
          <ProductCard imageSrc={main} productName={props.productName} duration={props.endCard.duration} index={0} />
        {props.ctaLabel && <CtaButton text={props.ctaLabel} />}
        </Enter>
      </Sequence>
      {props.music && <Html5Audio src={props.music.src} volume={props.music.volume} loop name="music" />}
    </AbsoluteFill>
  );
}
