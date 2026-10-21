import { spawn } from "node:child_process";

/**
 * Runs ffprobe (FFPROBE_PATH or PATH) and returns its JSON. Error.code "ENOENT" = not installed.
 * Only the file protocol is allowed. For files from outside (uploads, downloads) pass `format`
 * (an ffmpeg demuxer: "mov", "mp3", "jpeg_pipe"…) so a playlist posing as media is never parsed
 * as one: an HLS or concat file would otherwise make ffprobe open other files.
 */
export function runFfprobe(file: string, opts: { format?: string } = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const args = ["-v", "error", "-protocol_whitelist", "file", ...(opts.format ? ["-f", opts.format] : []), "-print_format", "json", "-show_streams", "-show_format", file];
    const p = spawn(process.env.FFPROBE_PATH || "ffprobe", args);
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(Object.assign(new Error(err.trim() || `ffprobe exited ${code}`), { code: "FFPROBE_FAILED" }))));
  });
}
