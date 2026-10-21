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
import { AI_TASKS, DEFAULT_MODELS, modelFor, speechModelsFor, TASK_HINT, TASK_KIND, TASK_LABEL, textModelsFor, textPriceLabel, usdThbRate, usdToThb, videoModelsFor } from "@/features/ai/models";
import { GEMINI_VOICES, speechPriceLabel, voiceFor } from "@/features/ai/voiceover";
import { videoPricePerSecond } from "@/features/ai/openrouter";
import { getAccountStatus, getAiSettings, getCatalog } from "@/features/ai/queries";
import { AiSettingsForm, type TaskChoice, TestAiButton } from "./ai-form";
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
  const since = new Date(Date.now() - 32 * 86_400_000).toISOString();
  const [{ data: limits }, { data: spent }, { data: events }, { data: aiLog }, workerStatus, queue, disk, aiSettings, account, catalog] = await Promise.all([
    supabase!.from("spending_limits").select("daily_thb, monthly_thb").maybeSingle(),
    supabase!.rpc("spend_summary"),
    supabase!.from("usage_events").select("provider, units, unit, est_cost_thb").gte("created_at", since).limit(1000),
    supabase!.from("ai_requests").select("id, task, model, status, cost_thb, error, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(1000),
    getWorkerStatus(supabase!),
    getQueueStatus(supabase!),
    getDiskStatus(),
    getAiSettings(supabase!),
    getAccountStatus(),
    getCatalog(),
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
  for (const r of aiLog ?? []) {
    const row = byProvider.get("openrouter") ?? { units: 0, unit: "calls", cost: 0, count: 0 };
    row.units += 1;
    row.cost += Number(r.cost_thb);
    row.count += 1;
    byProvider.set("openrouter", row);
  }
  const tasks: TaskChoice[] = AI_TASKS.map((task) => {
    const current = modelFor(task, aiSettings.models);
    const hint = `${TASK_HINT[task]} · ค่าเริ่มต้น ${DEFAULT_MODELS[task]}`;
    if ("error" in catalog) return { task, label: TASK_LABEL[task], hint, current, missing: false, options: [{ id: current, label: current }] };
    const options =
      TASK_KIND[task] === "text"
        ? textModelsFor(task, catalog.text)
            .filter((m) => !m.id.endsWith(":batch"))
            .sort((a, b) => a.prompt + a.completion - (b.prompt + b.completion))
            .map((m) => ({ id: m.id, label: `${m.name} · ${textPriceLabel(m)}` }))
        : TASK_KIND[task] === "speech"
          ? speechModelsFor(catalog.speech).map((m) => ({ id: m.id, label: `${m.name} · ${speechPriceLabel(m)}` }))
          : videoModelsFor(task, catalog.video).map((m) => {
              const perSecond = videoPricePerSecond(m.pricing);
              return { id: m.id, label: `${m.name} · ${perSecond === null ? "ราคาตาม token" : `$${perSecond}/วินาที`}` };
            });
    return { task, label: TASK_LABEL[task], hint, current, missing: !options.some((o) => o.id === current), options };
  });
  const baht = (n: number) => `฿${n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const baht4 = (n: number) => `฿${n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

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

      <Group id="ai-h" title="AI (OpenRouter)" description="key เดียวสำหรับโมเดลข้อความ วิดีโอ และเสียง — ตั้งใน .env.local ระบบไม่แสดงค่า key">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-1 rounded-lg border bg-surface px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0 text-[13px]">
              <p className="font-medium">สถานะ OpenRouter</p>
              <p className="text-xs text-muted-foreground">
                {account.state === "not_configured"
                  ? "ยังไม่ได้ตั้งค่า — ใส่ OPENROUTER_API_KEY ใน .env.local แล้วเปิด npm run dev ใหม่ · ปุ่มคัดลอกคำสั่งไปแชท AI ยังใช้ได้ตามเดิม"
                  : account.state === "error"
                    ? account.message
                    : account.key.limitUsd === null
                      ? "key นี้ไม่มีเพดานบน OpenRouter — แนะนำให้ตั้งที่ openrouter.ai/settings/keys"
                      : `เพดานของ key $${account.key.limitUsd}${account.key.limitReset === "monthly" ? " ต่อเดือน" : ""} · เหลือ $${(account.key.remainingUsd ?? 0).toFixed(2)} ≈ ${baht(usdToThb(account.key.remainingUsd ?? 0))}`}
              </p>
            </div>
            <Chip tone={account.state === "connected" ? "success" : account.state === "error" ? "danger" : "neutral"} className="self-start">
              {account.state === "connected" ? "เชื่อมต่อแล้ว" : account.state === "error" ? "เชื่อมต่อไม่ได้" : "ยังไม่ได้ตั้งค่า"}
            </Chip>
          </div>
          <TestAiButton disabled={account.state !== "connected"} />
          <AiSettingsForm
            tasks={tasks}
            ttsVoice={aiSettings.ttsVoice ?? ""}
            ttsVoiceHint={`ว่าง = ${voiceFor(modelFor("tts", aiSettings.models), null) ?? "เสียงเริ่มต้นของโมเดล"} · Gemini: ${GEMINI_VOICES.join(", ")} · ElevenLabs ใช้ voice ID`}
            perVideoCap={aiSettings.per_video_cap_thb}
            confirmOver={aiSettings.confirm_over_thb}
            catalogError={"error" in catalog ? catalog.error : undefined}
          />
          <div>
            <p className="mb-2 text-[13px] font-medium">การเรียก AI ล่าสุด</p>
            {aiLog?.length ? (
              <ul className="max-w-2xl divide-y rounded-lg border bg-surface text-[13px]">
                {aiLog.slice(0, 10).map((r) => (
                  <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-2">
                    <span className="min-w-0">
                      {TASK_LABEL[r.task as keyof typeof TASK_LABEL] ?? r.task} · <span className="break-all">{r.model}</span>
                      <span className="block text-xs text-muted-foreground">
                        {ago(r.created_at) ?? "เมื่อสักครู่"}
                        {r.status === "failed" && ` · ${r.error ?? "ล้มเหลว"}`}
                      </span>
                    </span>
                    {r.status === "failed" ? <Chip tone="danger">ล้มเหลว</Chip> : <span className="shrink-0 tabular-nums">{baht4(Number(r.cost_thb))}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted-foreground">ยังไม่มีการเรียก AI</p>
            )}
          </div>
        </div>
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
                      {r.count} ครั้ง · {r.unit === "video_seconds" ? `${(r.units / 60).toFixed(1)} นาทีวิดีโอ` : r.unit === "calls" ? "เรียก AI" : `${r.units} ${r.unit}`} (30 วันล่าสุด)
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
            Render บนเครื่องนี้ (Remotion Free License) คิด {baht(renderRateThbPerSecond() * 60)} ต่อนาทีวิดีโอ · AI ผ่าน OpenRouter ใช้ค่าใช้จ่ายจริงที่ OpenRouter รายงาน (USD) คิด {usdThbRate()} บาท/USD (ตั้งด้วย USD_THB_RATE) —
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
