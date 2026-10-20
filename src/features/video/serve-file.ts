import type { ReadStream } from "node:fs";
import { getStorage } from "./storage";

/**
 * Node stream → web stream that tolerates the client going away (e.g. <video> cancelling a
 * range request): stops reading and never enqueues after close. `Readable.toWeb` throws
 * "Controller is already closed" in that case, as an uncaught exception.
 */
function toWebStream(node: ReadStream): ReadableStream<Uint8Array> {
  let done = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      node.on("data", (chunk) => {
        if (done) return;
        controller.enqueue(chunk as Buffer);
        if ((controller.desiredSize ?? 1) <= 0) node.pause();
      });
      node.on("end", () => {
        if (done) return;
        done = true;
        controller.close();
      });
      node.on("error", (e) => {
        if (done) return;
        done = true;
        controller.error(e);
      });
    },
    pull() {
      node.resume();
    },
    cancel() {
      done = true;
      node.destroy();
    },
  });
}

/**
 * Streams a stored file with HTTP Range support (so <video> can seek). The caller has already
 * checked the user may read `key`. `download` → Content-Disposition attachment with that name.
 */
export async function serveStored(request: Request, key: string, contentType: string, download?: string): Promise<Response> {
  const storage = getStorage();
  const size = await storage.size(key);
  if (size === null) return new Response("ไฟล์หายจากที่เก็บ", { status: 410 });

  const headers = new Headers({ "Content-Type": contentType, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600" });
  if (download) headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(download)}`);

  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    return new Response(toWebStream(storage.read(key, { start, end })), { status: 206, headers });
  }
  headers.set("Content-Length", String(size));
  return new Response(toWebStream(storage.read(key)), { status: 200, headers });
}
