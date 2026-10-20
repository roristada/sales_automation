import { Film, ImageIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { NativeSelect } from "@/components/shared/field";
import { PageHeader, SectionHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { Chip, type Tone } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AssetUpload, DeleteAssetButton, EditAssetButton } from "@/features/assets/asset-forms";
import { type AssetLicense, LICENSE_LABEL, licenseVerdict, SOURCE_LABEL, type AssetSource } from "@/features/assets/licensing";
import { likeEscape } from "@/features/products/filters";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "คลังไฟล์" };

const TONE = { ok: "success", warn: "warning", block: "danger" } as const satisfies Record<string, Tone>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || "";

export default async function AssetsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = one(sp.q).slice(0, 100);
  const kind = ["image", "video"].includes(one(sp.kind)) ? one(sp.kind) : "";
  const review = one(sp.review) === "1";

  const { supabase } = await getCurrentUser();
  const db = supabase!;
  let query = db.from("assets").select("*, product:products(id, name)").order("created_at", { ascending: false }).limit(300);
  if (q) query = query.ilike("name", `%${likeEscape(q)}%`);
  if (kind) query = query.eq("kind", kind);
  const [{ data: assets, error }, { data: products }] = await Promise.all([query, db.from("products").select("id, name").order("name").limit(1000)]);

  const ids = (assets ?? []).map((a) => a.id);
  const { data: uses } = ids.length
    ? await db.from("storyboard_scenes").select("asset_id, position, storyboard:storyboards(id, version, status, project:content_projects(title))").in("asset_id", ids)
    : { data: [] };
  const usage = new Map<string, { href: string; label: string }[]>();
  for (const u of uses ?? []) {
    if (!u.asset_id || !u.storyboard) continue;
    const list = usage.get(u.asset_id) ?? [];
    list.push({ href: `/studio/${u.storyboard.id}`, label: `${u.storyboard.project?.title ?? "สคริปต์"} · เวอร์ชัน ${u.storyboard.version} · ฉากที่ ${u.position + 1}` });
    usage.set(u.asset_id, list);
  }

  const rows = (assets ?? [])
    .map((a) => ({ a, verdict: licenseVerdict(a) }))
    .filter(({ verdict }) => !review || verdict.level !== "ok");
  const productOptions = products ?? [];

  return (
    <>
      <PageHeader title="คลังไฟล์" description="รูปและคลิปของคุณสำหรับใส่ในฉากวิดีโอ พร้อมที่มาและสิทธิ์การใช้งาน" />

      <section aria-labelledby="upload-h" className="mb-8 max-w-3xl">
        <SectionHeader id="upload-h" title="อัปโหลดไฟล์" description="ระบุสิทธิ์ตามจริง ไฟล์ที่ไม่ทราบสิทธิ์จะถูกเตือนทุกครั้งที่ใช้ และไฟล์ห้ามใช้เชิงพาณิชย์จะอนุมัติสคริปต์ไม่ได้" />
        <AssetUpload products={productOptions} />
      </section>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <label className="sr-only" htmlFor="asset-q">
          ค้นหาชื่อไฟล์
        </label>
        <Input id="asset-q" name="q" defaultValue={q} placeholder="ค้นหาชื่อไฟล์" className="w-full sm:w-64" />
        <label className="sr-only" htmlFor="asset-kind">
          ชนิดไฟล์
        </label>
        <NativeSelect id="asset-kind" name="kind" defaultValue={kind} className="w-full sm:w-auto">
          <option value="">ทุกชนิด</option>
          <option value="image">รูป</option>
          <option value="video">วิดีโอ</option>
        </NativeSelect>
        <label className="flex h-10 items-center gap-2 text-[13px]">
          <input type="checkbox" name="review" value="1" defaultChecked={review} className="accent-primary" /> เฉพาะที่ต้องตรวจสิทธิ์
        </label>
        <Button type="submit" variant="outline">
          ใช้ตัวกรอง
        </Button>
        {(q || kind || review) && (
          <Button asChild variant="ghost">
            <Link href="/assets">ล้าง</Link>
          </Button>
        )}
      </form>

      {error ? (
        <ErrorState title="โหลดคลังไฟล์ไม่สำเร็จ" description={error.message} />
      ) : !rows.length ? (
        <EmptyState title={q || kind || review ? "ไม่พบไฟล์ที่ตรงกับตัวกรอง" : "ยังไม่มีไฟล์"} description="อัปโหลดรูปหรือคลิปที่คุณมีสิทธิ์ใช้ แล้วเลือกใช้ในฉากของสคริปต์" />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label="ไฟล์ในคลัง">
          {rows.map(({ a, verdict }) => {
            const used = usage.get(a.id) ?? [];
            return (
              <li key={a.id} className="flex flex-col overflow-hidden rounded-lg border bg-surface">
                <div className="relative aspect-video overflow-hidden bg-surface-muted">
                  {a.kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element -- private, auth-checked file route
                    <img src={`/api/assets/${a.id}`} alt={a.name} loading="lazy" className="absolute inset-0 h-full w-full object-contain" />
                  ) : (
                    <video src={`/api/assets/${a.id}#t=0.1`} preload="metadata" muted className="absolute inset-0 h-full w-full object-contain" aria-label={a.name} />
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-1.5 p-3 text-[13px]">
                  <p className="flex items-start gap-1.5 font-medium">
                    {a.kind === "image" ? <ImageIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-label="รูป" /> : <Film className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-label="วิดีโอ" />}
                    <span className="line-clamp-2 break-all">{a.name}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[a.width && a.height ? `${a.width}×${a.height}` : null, a.duration_s ? `${a.duration_s.toFixed(1)} วิ` : null, a.size_bytes < 1024 * 1024 ? `${Math.max(1, Math.round(a.size_bytes / 1024))} KB` : `${(a.size_bytes / 1024 / 1024).toFixed(1)} MB`].filter(Boolean).join(" · ")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {SOURCE_LABEL[a.source as AssetSource]}
                    {a.product && <> · {a.product.name}</>}
                  </p>
                  <div className="flex flex-wrap items-center gap-1">
                    <Chip tone={TONE[verdict.level]}>{LICENSE_LABEL[a.license as AssetLicense]}</Chip>
                    {a.ai_generated && <Chip tone="info">AI</Chip>}
                  </div>
                  {verdict.level !== "ok" && <p className={verdict.level === "block" ? "text-xs text-destructive" : "text-xs text-warning"}>{verdict.message}</p>}
                  <p className="text-xs text-muted-foreground">{used.length ? `ใช้ใน ${used.length} ฉาก` : "ยังไม่ได้ใช้"}</p>
                  <div className="mt-auto flex justify-end gap-1 pt-1">
                    <EditAssetButton id={a.id} asset={a} products={productOptions} usage={used} />
                    <DeleteAssetButton id={a.id} name={a.name} used={used.length > 0} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
