import { spawn } from "node:child_process";

/** Runs ffprobe (FFPROBE_PATH or PATH) and returns its JSON. Error.code "ENOENT" = not installed. */
export function runFfprobe(file: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file]);
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(Object.assign(new Error(err.trim() || `ffprobe exited ${code}`), { code: "FFPROBE_FAILED" }))));
  });
}
