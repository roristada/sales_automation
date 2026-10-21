import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/*
 * First frame for an AI clip (AI-3). Video models keep the shape of the first frame: a square
 * shop photo comes back letterboxed (Veo) or square (Kling) even when 9:16 is asked for. So the
 * photo is fitted onto a 720×1280 canvas first, padded with the photo's own corner colour (shop
 * photos sit on a plain background), and sent as a JPEG.
 */

export const FRAME = { width: 720, height: 1280 } as const;
const FFMPEG = () => process.env.FFMPEG_PATH || "ffmpeg";

function run(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG(), ["-v", "error", ...args]);
    const out: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (d: Buffer) => out.push(d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(err.trim() || `ffmpeg exited ${code}`))));
  });
}

/** "0xRRGGBB" from three bytes. */
export const hexColor = (rgb: ArrayLike<number>) => `0x${[rgb[0], rgb[1], rgb[2]].map((n) => n.toString(16).padStart(2, "0")).join("")}`;

type Corner = "tl" | "tr" | "bl" | "br";
const CORNER_AT: Record<Corner, [string, string]> = { tl: ["0", "0"], tr: ["iw-iw/16", "0"], bl: ["0", "ih-ih/16"], br: ["iw-iw/16", "ih-ih/16"] };

/** Average colour of two corner patches, e.g. the top two for the band above the photo. */
async function cornersColor(file: string, corners: [Corner, Corner]): Promise<string> {
  const patch = ([x, y]: [string, string]) => run(["-i", file, "-vf", `crop=iw/16:ih/16:${x}:${y},scale=1:1`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
  const [a, b] = await Promise.all(corners.map((c) => patch(CORNER_AT[c])));
  if (a.length < 3 || b.length < 3) return "0xffffff";
  return hexColor([0, 1, 2].map((i) => Math.round((a[i] + b[i]) / 2)));
}

/** The photo's size, from ffmpeg's own report (ffprobe isn't needed for one still). */
async function imageSize(file: string): Promise<{ width: number; height: number }> {
  const log = await new Promise<string>((resolve) => {
    const p = spawn(FFMPEG(), ["-hide_banner", "-i", file]);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", () => resolve(""));
    p.on("close", () => resolve(err));
  });
  const m = /, (\d{2,5})x(\d{2,5})/.exec(log);
  if (!m) throw new Error("อ่านขนาดรูปไม่ได้");
  return { width: Number(m[1]), height: Number(m[2]) };
}

/**
 * The photo fitted (not cropped) onto a 9:16 canvas, as a JPEG. Each padded band takes the
 * colour of the photo's corners next to it, so a white-top, grey-bottom shot stays seamless.
 */
export async function portraitFrame(image: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "frame-"));
  try {
    const src = path.join(dir, "src");
    const out = path.join(dir, "frame.jpg");
    await writeFile(src, image);
    const { width: w, height: h } = FRAME;
    const size = await imageSize(src);
    const scale = Math.min(w / size.width, h / size.height);
    const sw = Math.round((size.width * scale) / 2) * 2;
    const sh = Math.round((size.height * scale) / 2) * 2;
    const x = (w - sw) / 2;
    const y = (h - sh) / 2;
    // Wide or square photo → bands above and below; tall photo → bands left and right.
    const vertical = sh < h;
    const [first, second] = await Promise.all(vertical ? [cornersColor(src, ["tl", "tr"]), cornersColor(src, ["bl", "br"])] : [cornersColor(src, ["tl", "bl"]), cornersColor(src, ["tr", "br"])]);
    const band = vertical ? `drawbox=x=0:y=${y + sh}:w=${w}:h=${h - y - sh}:color=${second}:t=fill` : `drawbox=x=${x + sw}:y=0:w=${w - x - sw}:h=${h}:color=${second}:t=fill`;
    await run(["-i", src, "-vf", `scale=${sw}:${sh},pad=${w}:${h}:${x}:${y}:color=${first},${band},format=yuvj420p`, "-frames:v", "1", "-q:v", "2", "-y", out]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface ClipShape {
  ok: boolean;
  /** Thai note for the reviewer when the clip won't fill a 9:16 frame cleanly. */
  note: string | null;
}

/**
 * Does a generated clip fill 9:16? Checks the frame size and, with ffmpeg's cropdetect, black
 * bars baked into the picture (a letterboxed square inside a 9:16 file).
 */
export async function checkClipShape(file: string, size: { width: number | null; height: number | null }): Promise<ClipShape> {
  const notes: string[] = [];
  if (size.width && size.height && Math.abs(size.width / size.height - 9 / 16) > 0.02) notes.push(`คลิปไม่ใช่แนวตั้ง 9:16 (${size.width}×${size.height}) — ตอน render จะถูกครอปขอบ`);
  try {
    const log = await new Promise<string>((resolve, reject) => {
      const p = spawn(FFMPEG(), ["-hide_banner", "-i", file, "-vf", "cropdetect=limit=24:round=2:reset=0", "-f", "null", "-"]);
      let err = "";
      p.stderr.on("data", (d) => (err += d));
      p.on("error", reject);
      p.on("close", () => resolve(err));
    });
    const last = [...log.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].at(-1);
    if (last && size.width && size.height) {
      const [cw, ch] = [Number(last[1]), Number(last[2])];
      if (ch < size.height * 0.92 || cw < size.width * 0.92) notes.push(`คลิปมีขอบดำในภาพ (ภาพจริง ${cw}×${ch} จาก ${size.width}×${size.height}) — ขอบดำจะติดไปในวิดีโอ`);
    }
  } catch {
    // ffmpeg missing: the size check above still applies.
  }
  return { ok: notes.length === 0, note: notes.length ? notes.join(" · ") : null };
}
