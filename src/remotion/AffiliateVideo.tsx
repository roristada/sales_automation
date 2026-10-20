import { loadFont } from "@remotion/google-fonts/NotoSansThai";
import { AbsoluteFill, Img, interpolate, Loop, OffthreadVideo, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { SceneMedia, TimelineScene, VideoProps } from "@/features/video/timeline";

/*
 * 1080×1920 vertical affiliate video. Layout keeps text out of the areas TikTok/Reels/Shorts
 * cover with their own UI (top ~150px, bottom ~380px, right ~140px).
 */

const { fontFamily } = loadFont("normal", { weights: ["400", "700", "800"], subsets: ["thai", "latin"] });

const C = {
  bg1: "#0f172a",
  bg2: "#312e81",
  text: "#ffffff",
  accent: "#facc15",
  pill: "rgba(15, 23, 42, 0.78)",
  card: "#ffffff",
  muted: "rgba(255,255,255,0.75)",
};
const SAFE = { top: 150, bottom: 380, side: 70, right: 140 };

function Background({ imageSrc }: { imageSrc: string | null }) {
  return (
    <AbsoluteFill style={{ background: `linear-gradient(180deg, ${C.bg1} 0%, ${C.bg2} 100%)` }}>
      {imageSrc && (
        <Img
          src={imageSrc}
          style={{ position: "absolute", inset: -80, width: "calc(100% + 160px)", height: "calc(100% + 160px)", objectFit: "cover", filter: "blur(60px) brightness(0.45)" }}
        />
      )}
    </AbsoluteFill>
  );
}

function ProductCard({ imageSrc, productName, zoomFrames }: { imageSrc: string | null; productName: string; zoomFrames: number }) {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, Math.max(1, zoomFrames)], [1, 1.06], { extrapolateRight: "clamp" });
  return (
    <div
      style={{
        position: "absolute",
        top: 430,
        left: 160,
        width: 760,
        height: 760,
        borderRadius: 48,
        background: C.card,
        overflow: "hidden",
        boxShadow: "0 40px 80px rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {imageSrc ? (
        <Img src={imageSrc} style={{ width: "100%", height: "100%", objectFit: "contain", transform: `scale(${scale})` }} />
      ) : (
        <div style={{ padding: 60, fontFamily, fontWeight: 800, fontSize: 84, lineHeight: 1.25, color: C.bg1, textAlign: "center" }}>{productName}</div>
      )}
    </div>
  );
}

function OnScreenText({ text }: { text: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!text) return null;
  const s = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 12 });
  return (
    <div style={{ position: "absolute", top: 1240, left: SAFE.side, right: SAFE.right, display: "flex", justifyContent: "center" }}>
      <div
        style={{
          fontFamily,
          fontWeight: 800,
          fontSize: 68,
          lineHeight: 1.3,
          color: C.bg1,
          background: C.accent,
          padding: "14px 34px",
          borderRadius: 24,
          textAlign: "center",
          opacity: s,
          transform: `translateY(${(1 - s) * 30}px)`,
        }}
      >
        {text}
      </div>
    </div>
  );
}

function Subtitle({ text }: { text: string }) {
  return (
    <div style={{ position: "absolute", bottom: SAFE.bottom, left: SAFE.side, right: SAFE.right, display: "flex", justifyContent: "center" }}>
      <div
        style={{
          fontFamily,
          fontWeight: 700,
          fontSize: 54,
          lineHeight: 1.35,
          color: C.text,
          background: C.pill,
          padding: "10px 26px",
          borderRadius: 18,
          textAlign: "center",
        }}
      >
        {text}
      </div>
    </div>
  );
}

function Hook({ text }: { text: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 14 }, durationInFrames: 15 });
  return (
    <div style={{ position: "absolute", top: SAFE.top, left: SAFE.side, right: SAFE.right, display: "flex", justifyContent: "center" }}>
      <div
        style={{
          fontFamily,
          fontWeight: 800,
          // Smaller type for longer hooks so it stays above the product card without cutting text.
          fontSize: text.length <= 28 ? 62 : text.length <= 48 ? 52 : 44,
          lineHeight: 1.25,
          color: C.text,
          textAlign: "center",
          textShadow: "0 6px 24px rgba(0,0,0,0.5)",
          transform: `scale(${0.85 + 0.15 * s})`,
          opacity: s,
        }}
      >
        {text}
      </div>
    </div>
  );
}

function EndCard({ cta, disclosure }: { cta: string; disclosure: string }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ opacity }}>
      <div style={{ position: "absolute", top: 1240, left: SAFE.side, right: SAFE.right, textAlign: "center", fontFamily, fontWeight: 800, fontSize: 64, lineHeight: 1.3, color: C.accent }}>
        {cta}
      </div>
      {/* Affiliate disclosure: always shown on the end card (and in the caption/subtitles). */}
      <div
        style={{
          position: "absolute",
          bottom: SAFE.bottom,
          left: SAFE.side,
          right: SAFE.right,
          textAlign: "center",
          fontFamily,
          fontWeight: 400,
          fontSize: 38,
          lineHeight: 1.4,
          color: C.text,
          background: C.pill,
          padding: "14px 24px",
          borderRadius: 16,
        }}
      >
        {disclosure}
      </div>
    </AbsoluteFill>
  );
}

/** Full-screen library media with a slow zoom (images) or a muted, looping clip (video). */
function FullBleed({ media, duration }: { media: SceneMedia; duration: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = interpolate(frame, [0, Math.max(1, duration)], [1, 1.08], { extrapolateRight: "clamp" });
  const cover = { width: "100%", height: "100%", objectFit: "cover" as const };
  const clipFrames = media.durationS ? Math.max(1, Math.floor(media.durationS * fps)) : null;
  return (
    <AbsoluteFill>
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
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 28%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.65) 100%)" }} />
    </AbsoluteFill>
  );
}

function SceneLayer({ scene, imageSrc, productName }: { scene: TimelineScene; imageSrc: string | null; productName: string }) {
  return (
    <>
      {scene.media ? <FullBleed media={scene.media} duration={scene.duration} /> : <ProductCard imageSrc={imageSrc} productName={productName} zoomFrames={scene.duration} />}
      <OnScreenText text={scene.onScreenText} />
    </>
  );
}

export function AffiliateVideo(props: VideoProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg1 }}>
      <Background imageSrc={props.imageSrc} />
      {props.scenes.map((s) => (
        <Sequence key={s.id} from={s.from} durationInFrames={s.duration} name={`scene ${s.kind}`}>
          <SceneLayer scene={s} imageSrc={props.imageSrc} productName={props.productName} />
        </Sequence>
      ))}
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
        <ProductCard imageSrc={props.imageSrc} productName={props.productName} zoomFrames={props.endCard.duration} />
        <EndCard cta={props.cta} disclosure={props.disclosure} />
      </Sequence>
    </AbsoluteFill>
  );
}
