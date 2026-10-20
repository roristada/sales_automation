/**
 * Quality checks on the rendered file, from ffprobe facts (PLAN.md M4 acceptance:
 * 1080×1920 @30fps H.264/AAC, duration matches the plan, disclosure present).
 */

export interface ProbeFacts {
  width: number | null;
  height: number | null;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  durationS: number | null;
  sizeBytes: number | null;
}

export interface QaCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
  /** "warn" checks don't fail the render; they show up in the report. */
  level: "error" | "warn";
}

export interface QaReport {
  ok: boolean;
  checks: QaCheck[];
}

/** Parses `ffprobe -print_format json -show_streams -show_format` output. */
export function probeFacts(json: unknown): ProbeFacts {
  const j = json as { streams?: Record<string, unknown>[]; format?: Record<string, unknown> };
  const video = j.streams?.find((s) => s.codec_type === "video");
  const audio = j.streams?.find((s) => s.codec_type === "audio");
  const rate = typeof video?.avg_frame_rate === "string" ? video.avg_frame_rate : typeof video?.r_frame_rate === "string" ? video.r_frame_rate : null;
  let fps: number | null = null;
  if (rate) {
    const [n, d] = rate.split("/").map(Number);
    fps = d ? Math.round((n / d) * 100) / 100 : n;
  }
  const num = (v: unknown) => (v === undefined || v === null || Number.isNaN(Number(v)) ? null : Number(v));
  return {
    width: num(video?.width),
    height: num(video?.height),
    fps,
    videoCodec: (video?.codec_name as string) ?? null,
    audioCodec: (audio?.codec_name as string) ?? null,
    durationS: num(j.format?.duration),
    sizeBytes: num(j.format?.size),
  };
}

export function qaReport(p: ProbeFacts, expected: { width: number; height: number; fps: number; durationS: number }, extra: QaCheck[] = []): QaReport {
  const checks: QaCheck[] = [
    {
      key: "resolution",
      label: "ขนาดภาพ",
      ok: p.width === expected.width && p.height === expected.height,
      detail: `${p.width ?? "?"}×${p.height ?? "?"} (ต้องการ ${expected.width}×${expected.height})`,
      level: "error",
    },
    { key: "fps", label: "เฟรมเรต", ok: p.fps === expected.fps, detail: `${p.fps ?? "?"} fps (ต้องการ ${expected.fps})`, level: "error" },
    { key: "video_codec", label: "codec วิดีโอ", ok: p.videoCodec === "h264", detail: p.videoCodec ?? "ไม่พบ stream วิดีโอ", level: "error" },
    { key: "audio_codec", label: "codec เสียง", ok: p.audioCodec === "aac", detail: p.audioCodec ?? "ไม่พบ stream เสียง", level: "error" },
    {
      key: "duration",
      label: "ความยาว",
      ok: p.durationS !== null && Math.abs(p.durationS - expected.durationS) <= 0.5,
      detail: `${p.durationS?.toFixed(2) ?? "?"} วินาที (ตามแผน ${expected.durationS.toFixed(2)})`,
      level: "error",
    },
    ...extra,
  ];
  return { ok: checks.every((c) => c.ok || c.level === "warn"), checks };
}
