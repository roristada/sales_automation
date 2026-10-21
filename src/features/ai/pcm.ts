import { spawn } from "node:child_process";

/**
 * Raw 16-bit little-endian PCM (what Gemini TTS returns) to MP3 with ffmpeg (FFMPEG_PATH or PATH;
 * the render worker needs FFmpeg anyway). Rate and channels come from the response's
 * Content-Type, e.g. "audio/pcm;rate=24000;channels=1".
 */
export function pcmFormat(contentType: string): { rate: number; channels: number } {
  const param = (k: string) => Number(new RegExp(`${k}=(\\d+)`).exec(contentType)?.[1]);
  const rate = param("rate");
  const channels = param("channels");
  return { rate: rate >= 8000 && rate <= 192000 ? rate : 24000, channels: channels >= 1 && channels <= 2 ? channels : 1 };
}

export function pcmToMp3(pcm: Buffer, { rate, channels }: { rate: number; channels: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-f", "s16le", "-ar", String(rate), "-ac", String(channels), "-i", "pipe:0", "-c:a", "libmp3lame", "-b:a", "128k", "-f", "mp3", "pipe:1"]);
    const out: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (d: Buffer) => out.push(d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(err.trim() || `ffmpeg exited ${code}`))));
    p.stdin.on("error", () => {});
    p.stdin.end(pcm);
  });
}
