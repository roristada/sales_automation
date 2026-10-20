import { FileUp } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, SectionHeader } from "@/components/shared/page-header";
import { Chip, type Tone } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { getDiskStatus, getQueueStatus, getWorkerStatus } from "@/features/monitoring/queries";
import { ago, formatBytes, LOW_DISK_BYTES, WORKER_STATE_LABEL, workerState } from "@/features/monitoring/status";
import { getIntegrationStatuses, type IntegrationState } from "@/lib/integrations";
import { getCurrentUser } from "@/lib/supabase/server";
import { PROVIDER_LABEL, renderRateThbPerSecond } from "@/features/usage/budget";
import { LimitsForm } from "./limits-form";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "ตั้งค่า" };

const STATE: Record<IntegrationState, { label: string; tone: Tone }> = {
  connected: { label: "เชื่อมต่อแล้ว", tone: "success" },
  configured_untested: { label: "ตั้งค่าแล้ว · ยังไม่ทดสอบ", tone: "info" },
  not_configured: { label: "ยังไม่ได้ตั้งค่า", tone: "neutral" },
  not_available: { label: "ยังไม่รองรับ", tone: "neutral" },
};

function Group({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid items-start gap-4 border-b py-8 first:pt-0 last:border-0 lg:grid-cols-[240px_1fr] lg:gap-10">
      <SectionHeader id={id} title={title} description={description} />
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export default async function SettingsPage() {
  const { supabase, user } = await getCurrentUser();
  const { data: profile } = await supabase!.from("profiles").select("display_name").eq("id", user!.id).maybeSingle();
  const integrations = getIntegrationStatuses();
  const [{ data: limits }, { data: spent }, { data: events }, workerStatus, queue, disk] = await Promise.all([
    supabase!.from("spending_limits").select("daily_thb, monthly_thb").maybeSingle(),
    supabase!.rpc("spend_summary"),
    supabase!
      .from("usage_events")
      .select("provider, units, unit, est_cost_thb")
      .gte("created_at", new Date(Date.now() - 32 * 86_400_000).toISOString())
      .limit(1000),
    getWorkerStatus(supabase!),
    getQueueStatus(supabase!),
    getDiskStatus(),
  ]);
  const worker = workerState(workerStatus);
  const byProvider = new Map<string, { units: number; unit: string; cost: number; count: number }>();
  for (const e of events ?? []) {
    const row = byProvider.get(e.provider) ?? { units: 0, unit: e.unit, cost: 0, count: 0 };
    row.units += Number(e.units);
    row.cost += Number(e.est_cost_thb);
    row.count += 1;
    byProvider.set(e.provider, row);
  }
  const baht = (n: number) => `฿${n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <>
      <PageHeader title="ตั้งค่า" description="โปรไฟล์ การเชื่อมต่อบริการภายนอก และการนำเข้าข้อมูล" />

      <Group id="profile-h" title="โปรไฟล์" description={user!.email}>
        <ProfileForm displayName={profile?.display_name ?? ""} />
      </Group>

      <Group id="integrations-h" title="การเชื่อมต่อ" description="สถานะจริงของผู้ให้บริการ — ระบบไม่แสดงค่า API key หรือ secret">
        <ul className="divide-y rounded-lg border bg-surface">
          {integrations.map((i) => (
            <li key={i.key} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <p className="font-medium">{i.name}</p>
                <p className="text-[13px] text-muted-foreground">{i.purpose}</p>
                <p className="mt-1 text-xs text-muted-foreground">{i.note}</p>
              </div>
              <Chip tone={STATE[i.state].tone} className="self-start">
                {STATE[i.state].label}
              </Chip>
            </li>
          ))}
        </ul>
      </Group>

      <Group id="system-h" title="สถานะระบบ" description="ตัว render (worker) คิวงาน และพื้นที่เก็บไฟล์ — ตรวจจากระบบจริงทุกครั้งที่เปิดหน้านี้">
        <ul className="divide-y rounded-lg border bg-surface text-[13px]">
          <li className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="font-medium">ตัว render วิดีโอ (worker)</p>
              <p className="text-xs text-muted-foreground">
                {worker === "online" || worker === "busy" ? (
                  `ส่งสัญญาณล่าสุด ${ago(workerStatus!.lastSeen!) ?? "เมื่อสักครู่"}`
                ) : worker === "unknown" ? (
                  "ถามสถานะจากฐานข้อมูลไม่ได้"
                ) : (
                  <>
                    {workerStatus?.lastSeen && `ส่งสัญญาณล่าสุด ${ago(workerStatus.lastSeen) ?? "-"} · `}เปิดด้วย <code>npm run worker</code> ในโฟลเดอร์โปรเจกต์
                  </>
                )}
              </p>
            </div>
            <Chip tone={worker === "online" || worker === "busy" ? "success" : worker === "unknown" ? "danger" : "warning"} className="self-start">
              {WORKER_STATE_LABEL[worker]}
            </Chip>
          </li>
          <li className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="font-medium">คิว render ของคุณ</p>
              <p className="text-xs text-muted-foreground">
                รอคิว {queue.queued} · กำลังทำ {queue.processing}
                {queue.oldestQueuedAt && ` · งานที่รอนานสุดเข้าคิว ${ago(queue.oldestQueuedAt) ?? "-"}`}
              </p>
            </div>
            {queue.failedLastDay > 0 ? (
              <Link href="/videos" className="self-start">
                <Chip tone="danger">ล้มเหลว {queue.failedLastDay} งานใน 24 ชม.</Chip>
              </Link>
            ) : (
              <Chip tone="success" className="self-start">
                ไม่มีงานล้มเหลวใน 24 ชม.
              </Chip>
            )}
          </li>
          <li className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="font-medium">พื้นที่เก็บวิดีโอและไฟล์</p>
              <p className="text-xs break-all text-muted-foreground">{disk ? `ว่าง ${formatBytes(disk.free)} จาก ${formatBytes(disk.total)} · ${disk.root}` : "อ่านพื้นที่ดิสก์ไม่ได้"}</p>
            </div>
            <Chip tone={!disk ? "neutral" : disk.free < LOW_DISK_BYTES ? "danger" : "success"} className="self-start">
              {!disk ? "ไม่ทราบ" : disk.free < LOW_DISK_BYTES ? "พื้นที่ใกล้เต็ม" : "พอใช้"}
            </Chip>
          </li>
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          สำรองข้อมูลด้วย <code>npm run backup</code> — ดู docs/DEPLOY.md
        </p>
      </Group>

      <Group id="usage-h" title="การใช้งานและค่าใช้จ่าย" description="ค่าใช้จ่ายเป็นการประมาณจากอัตราที่ตั้งไว้ งานที่มีค่าใช้จ่ายจะถูกหยุดเมื่อเกินเพดาน">
        <div className="flex flex-col gap-6">
          <dl className="grid max-w-md grid-cols-2 gap-4">
            <div>
              <dt className="text-xs text-muted-foreground">วันนี้</dt>
              <dd className="text-lg font-semibold tabular-nums">{baht(Number(spent?.[0]?.today_thb ?? 0))}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">เดือนนี้</dt>
              <dd className="text-lg font-semibold tabular-nums">{baht(Number(spent?.[0]?.month_thb ?? 0))}</dd>
            </div>
          </dl>
          {byProvider.size ? (
            <ul className="max-w-md divide-y rounded-lg border bg-surface text-[13px]">
              {[...byProvider.entries()].map(([provider, r]) => (
                <li key={provider} className="flex items-center justify-between gap-3 px-4 py-2">
                  <span>
                    {PROVIDER_LABEL[provider] ?? provider}
                    <span className="block text-xs text-muted-foreground">
                      {r.count} ครั้ง · {r.unit === "video_seconds" ? `${(r.units / 60).toFixed(1)} นาทีวิดีโอ` : `${r.units} ${r.unit}`} (30 วันล่าสุด)
                    </span>
                  </span>
                  <span className="tabular-nums">{baht(r.cost)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">ยังไม่มีการใช้งานใน 30 วันล่าสุด</p>
          )}
          <p className="max-w-xl text-xs text-muted-foreground">
            Render บนเครื่องนี้ (Remotion Free License) คิด {baht(renderRateThbPerSecond() * 60)} ต่อนาทีวิดีโอ · ยังไม่มีบริการภายนอกที่มีค่าใช้จ่ายเชื่อมต่ออยู่ (TTS, AI ผ่าน API) —
            งานที่ไม่มีค่าใช้จ่ายจะไม่ถูกหยุดแม้ถึงเพดาน
          </p>
          <LimitsForm daily={limits?.daily_thb ?? null} monthly={limits?.monthly_thb ?? null} />
        </div>
      </Group>

      <Group id="data-h" title="นำเข้าข้อมูล" description="นำเข้าสินค้าจากไฟล์ CSV">
        <Button asChild variant="outline">
          <Link href="/products/import">
            <FileUp aria-hidden /> นำเข้า CSV
          </Link>
        </Button>
      </Group>
    </>
  );
}
