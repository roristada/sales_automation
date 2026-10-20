import { z } from "zod";
import { serveStored } from "@/features/video/serve-file";
import { getCurrentUser } from "@/lib/supabase/server";

/*
 * Serves render outputs to their owner. Ownership is checked by reading the output row under
 * RLS. Supports HTTP Range so the <video> element can seek. ?download=1&name=… → attachment.
 */

const FILES = {
  video: { column: "video_key", type: "video/mp4", name: "video.mp4" },
  thumbnail: { column: "thumbnail_key", type: "image/jpeg", name: "thumbnail.jpg" },
  srt: { column: "srt_key", type: "application/x-subrip; charset=utf-8", name: "subtitles.srt" },
  vtt: { column: "vtt_key", type: "text/vtt; charset=utf-8", name: "subtitles.vtt" },
} as const;

export async function GET(request: Request, { params }: { params: Promise<{ outputId: string; file: string }> }) {
  const { outputId, file } = await params;
  const spec = FILES[file as keyof typeof FILES];
  if (!spec || !z.uuid().safeParse(outputId).success) return new Response("ไม่พบไฟล์", { status: 404 });

  const { supabase } = await getCurrentUser();
  if (!supabase) return new Response("ยังไม่ได้เข้าสู่ระบบ", { status: 401 });
  const { data: out } = await supabase.from("render_outputs").select("video_key, thumbnail_key, srt_key, vtt_key").eq("id", outputId).maybeSingle();
  const key = out?.[spec.column];
  if (!key) return new Response("ไม่พบไฟล์", { status: 404 });

  const url = new URL(request.url);
  const download = url.searchParams.get("download") ? url.searchParams.get("name") || spec.name : undefined;
  return serveStored(request, key, spec.type, download);
}
