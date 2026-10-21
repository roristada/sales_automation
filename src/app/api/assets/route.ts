import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ACCEPTED_TYPES, ASSET_LICENSES, ASSET_SOURCES } from "@/features/assets/licensing";
import { runFfprobe } from "@/features/video/ffprobe";
import { probeFacts } from "@/features/video/qa";
import { getStorage } from "@/features/video/storage";
import { getCurrentUser } from "@/lib/supabase/server";

/*
 * Upload one asset (multipart: file + metadata). Streams to a temp file while hashing, so large
 * clips don't sit in memory; identical files (same SHA-256) for the same user are not stored twice.
 * Width/height/duration come from ffprobe when it is installed.
 */

const metaSchema = z.object({
  name: z.string().trim().max(200).optional(),
  source: z.enum(ASSET_SOURCES, { error: "เลือกแหล่งที่มา" }),
  license: z.enum(ASSET_LICENSES, { error: "เลือกสิทธิ์การใช้งาน" }),
  source_url: z
    .string()
    .trim()
    .max(2000)
    .transform((s) => s || null)
    .pipe(z.url({ protocol: /^https?$/, error: "ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://" }).nullable()),
  attribution: z
    .string()
    .trim()
    .max(300)
    .transform((s) => s || null),
  ai_generated: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
  product_id: z.preprocess((v) => (v === "" ? null : v), z.uuid().nullable()),
});

const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function POST(request: Request) {
  const { supabase, user } = await getCurrentUser();
  if (!supabase || !user) return json({ error: "ยังไม่ได้เข้าสู่ระบบ" }, 401);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "อ่านไฟล์ที่อัปโหลดไม่สำเร็จ" }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return json({ error: "เลือกไฟล์ก่อน" }, 400);
  const type = ACCEPTED_TYPES[file.type];
  if (!type) return json({ error: "รองรับเฉพาะ JPG, PNG, WebP, MP4, MOV, WebM และเพลง MP3, M4A, WAV" }, 400);
  if (file.size > type.maxBytes) return json({ error: `ไฟล์ใหญ่เกิน ${type.maxBytes / 1024 / 1024} MB` }, 400);

  const meta = metaSchema.safeParse({
    name: form.get("name") ?? undefined,
    source: form.get("source"),
    license: form.get("license"),
    source_url: form.get("source_url") ?? "",
    attribution: form.get("attribution") ?? "",
    ai_generated: form.get("ai_generated") ?? "false",
    product_id: form.get("product_id") ?? "",
  });
  if (!meta.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of meta.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return json({ error: "ข้อมูลไม่ครบหรือไม่ถูกต้อง", fieldErrors }, 400);
  }

  const tmp = await mkdtemp(path.join(os.tmpdir(), "asset-"));
  try {
    const tmpFile = path.join(tmp, `upload.${type.ext}`);
    const hash = createHash("sha256");
    await pipeline(Readable.fromWeb(file.stream() as import("node:stream/web").ReadableStream), async function* (src) {
      for await (const chunk of src) {
        hash.update(chunk);
        yield chunk;
      }
    }, createWriteStream(tmpFile));
    const sha256 = hash.digest("hex");

    const { data: dup } = await supabase.from("assets").select("id, name").eq("sha256", sha256).maybeSingle();
    if (dup) return json({ id: dup.id, duplicate: true, name: dup.name });

    let facts: ReturnType<typeof probeFacts> | null = null;
    try {
      facts = probeFacts(await runFfprobe(tmpFile));
    } catch {
      // ffprobe missing or unreadable file: keep the asset without dimensions.
    }
    if (type.kind === "video" && facts && !facts.videoCodec) return json({ error: "ไฟล์วิดีโอเสีย หรืออ่านไม่ได้" }, 400);
    if (type.kind === "audio" && facts && !facts.audioCodec) return json({ error: "ไฟล์เสียงเสีย หรืออ่านไม่ได้" }, 400);

    const id = randomUUID();
    const key = `${user.id}/${id}/original.${type.ext}`;
    await getStorage().put(key, tmpFile);
    const { error } = await supabase.from("assets").insert({
      id,
      owner_id: user.id,
      kind: type.kind,
      storage_key: key,
      name: (meta.data.name || file.name).slice(0, 200),
      mime: file.type,
      size_bytes: file.size,
      sha256,
      width: type.kind === "audio" ? null : (facts?.width ?? null),
      height: type.kind === "audio" ? null : (facts?.height ?? null),
      duration_s: type.kind === "image" ? null : (facts?.durationS ?? null),
      source: meta.data.source,
      source_url: meta.data.source_url,
      license: meta.data.license,
      attribution: meta.data.attribution,
      ai_generated: meta.data.ai_generated || meta.data.source === "ai_generated",
      product_id: meta.data.product_id,
    });
    if (error) {
      await getStorage().removePrefix(`${user.id}/${id}`);
      return json({ error: `บันทึกไม่สำเร็จ: ${error.message}` }, 400);
    }
    revalidatePath("/assets");
    return json({ id, duplicate: false });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
