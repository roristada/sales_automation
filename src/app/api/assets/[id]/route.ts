import { z } from "zod";
import { serveStored } from "@/features/video/serve-file";
import { getCurrentUser } from "@/lib/supabase/server";

/** Serves an asset file to its owner (RLS check), with Range support for video seeking. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("ไม่พบไฟล์", { status: 404 });
  const { supabase } = await getCurrentUser();
  if (!supabase) return new Response("ยังไม่ได้เข้าสู่ระบบ", { status: 401 });
  const { data: asset } = await supabase.from("assets").select("storage_key, mime, name").eq("id", id).maybeSingle();
  if (!asset) return new Response("ไม่พบไฟล์", { status: 404 });
  return serveStored(request, asset.storage_key, asset.mime, new URL(request.url).searchParams.get("download") ? asset.name : undefined);
}
