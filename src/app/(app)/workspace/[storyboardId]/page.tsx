import { ArrowDown, CheckCircle2, Circle, CircleDot, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader, SectionHeader } from "@/components/shared/page-header";
import { Chip, StatusBadge } from "@/components/shared/status-badge";
import { DEFAULT_VISUAL_LEVEL, VISUAL_LEVEL, type VisualLevel } from "@/features/ai/clips";
import { DEFAULT_MODELS, modelFor, speechModelsFor, TASK_LABEL, textModelsFor, textPriceLabel, usdToThb, VIDEO_OVERRIDE_TASKS, videoModelsFor } from "@/features/ai/models";
import { isOpenRouterConfigured, videoPricePerSecond } from "@/features/ai/openrouter";
import { getAiSettings, getCatalog, getVideoOverrides } from "@/features/ai/queries";
import { speechPriceLabel, voiceFor } from "@/features/ai/voiceover";
import { FactsEditor } from "@/features/content/facts-editor";
import { LLM_STATUS } from "@/features/content/llm";
import { loadStudio } from "@/features/content/queries";
import { StudioShell } from "@/features/content/studio-shell";
import { getTemplate, type Platform, PLATFORM_LABEL } from "@/features/content/templates";
import { formatDate, formatTHB } from "@/features/products/data-value";
import { galleryList } from "@/features/products/schema";
import { ClipsToolbar, SceneVisual } from "@/features/video/clips-panel";
import { sceneKey } from "@/features/video/scene-key";
import { loadVideoStudio } from "@/features/video/studio-data";
import { OutputSection, RenderAside, RenderHistory } from "@/features/video/studio-sections";
import { CostCard, videoCost } from "@/features/workspace/cost-card";
import { ProductImages } from "@/features/workspace/product-images";
import { nextStep, type StepState, stepStatuses, STEPS } from "@/features/workspace/steps";
import { type SettingChoice, VideoSettings } from "@/features/workspace/video-settings";
import { getCurrentUser } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "ห้องทำวิดีโอ" };

const STATE_ICON: Record<StepState, { icon: typeof Circle; className: string; label: string }> = {
  done: { icon: CheckCircle2, className: "text-success", label: "เสร็จ" },
  attention: { icon: TriangleAlert, className: "text-warning", label: "ต้องดู" },
  todo: { icon: CircleDot, className: "text-primary", label: "ต้องทำ" },
  optional: { icon: Circle, className: "text-muted-foreground", label: "ไม่บังคับ" },
};

const baht = (n: number) => `฿${n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * One page per video (a script version): product photos, this video's AI settings, facts, the
 * script with each scene's visual under it, render and publishing. Each step's state shows in
 * the rail, and a bar at the bottom names the one next thing to do.
 */
export default async function WorkspacePage({ params }: { params: Promise<{ storyboardId: string }> }) {
  const { storyboardId } = await params;
  if (!z.uuid().safeParse(storyboardId).success) notFound();
  const { supabase } = await getCurrentUser();
  const db = supabase!;
  const [bundle, d] = await Promise.all([loadStudio(db, storyboardId), loadVideoStudio(db, storyboardId)]);
  if (!bundle || !d) notFound();
  const { storyboard: sb, project, product, scenes, facts, factRows, issues, versions, assets } = bundle;
  const aiReady = isOpenRouterConfigured();
  const locked = sb.status === "approved";

  const [{ data: productMore }, account, overrides, catalog, { data: spentRows }] = await Promise.all([
    db.from("products").select("image_url, gallery_urls, product_url, affiliate_url").eq("id", product.id).single(),
    getAiSettings(db),
    getVideoOverrides(db, storyboardId),
    aiReady ? getCatalog() : Promise.resolve({ error: "ยังไม่ได้ตั้งค่า" } as const),
    db.from("ai_requests").select("task, cost_thb").eq("storyboard_id", storyboardId),
  ]);
  const gallery = galleryList(productMore?.gallery_urls);

  // This video's AI picks, each defaulting to the Settings model for its task. The scene-prompt
  // model stays in Settings (one less choice here).
  const choices: SettingChoice[] = VIDEO_OVERRIDE_TASKS.filter((t) => t !== "scene_prompt").map((task) => {
    const options =
      "error" in catalog
        ? []
        : task === "tts"
          ? speechModelsFor(catalog.speech).map((m) => ({ id: m.id, label: `${m.name} · ${speechPriceLabel(m)}` }))
          : task === "video_product" || task === "video_lifestyle"
            ? videoModelsFor(task, catalog.video).map((m) => {
                const perSecond = videoPricePerSecond(m.pricing);
                return { id: m.id, label: `${m.name} · ${perSecond === null ? "ราคาตาม token" : `฿${(perSecond * usdToThb(1)).toFixed(2)}/วิ`}` };
              })
            : textModelsFor(task, catalog.text)
                .filter((m) => !m.id.endsWith(":batch"))
                .sort((a, b) => a.prompt + a.completion - (b.prompt + b.completion))
                .map((m) => ({ id: m.id, label: `${m.name} · ${textPriceLabel(m)}` }));
    return { task, label: TASK_LABEL[task], defaultModel: modelFor(task, account.models) ?? DEFAULT_MODELS[task], value: overrides?.models[task] ?? "", options };
  });
  const ttsModel = modelFor("tts", { ...account.models, ...overrides?.models });

  // Spend on this video vs its cap; clips still generating count at their estimate.
  const cost = videoCost(d, spentRows ?? []);
  const spent = cost.spent.text + cost.spent.clips + cost.spent.voice;
  const inFlight = d.clipScenes.flatMap((s) => s.generations).filter((g) => g.status === "queued" || g.status === "generating");
  const pending = cost.generating;
  const cap = account.per_video_cap_thb;
  const level = (overrides?.visualLevel as VisualLevel | null) ?? DEFAULT_VISUAL_LEVEL;

  const state = {
    hasImage: !!productMore?.image_url,
    factsUsable: factRows.filter((f) => f.status !== "ai_estimate").length,
    factsPending: factRows.filter((f) => f.status === "ai_estimate").length,
    approved: locked,
    blocks: issues.filter((i) => i.level === "block").length,
    aiScenes: d.aiScenes,
    aiScenesReady: d.aiScenesReady,
    clipsGenerating: inFlight.length > 0,
    render: d.active ? ("active" as const) : d.output ? ("done" as const) : d.lastFailed ? ("failed" as const) : ("none" as const),
    published: d.pubs.filter((p) => p.status === "published").length,
  };
  const status = stepStatuses(state);
  const next = nextStep(state);
  const sceneExtras = Object.fromEntries(
    d.clipScenes.map((s) => [s.id, <SceneVisual key={sceneKey(s)} scene={s} approved={locked} reusable={d.reusable} choices={d.videoChoices} usdThb={d.usdThb} hasFrame={d.hasFrame} embedded />]),
  );

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "วางแผนคอนเทนต์", href: "/content" }, { label: project.title }]}
        title={product.name}
        meta={
          <>
            <StatusBadge status={locked ? "approved" : "draft"} />
            <span>{getTemplate(sb.template_id)?.name ?? sb.template_id}</span>
            <span>
              {PLATFORM_LABEL[project.platform as Platform]} · {project.target_duration_s} วินาที
            </span>
            <span>เวอร์ชัน {sb.version}</span>
          </>
        }
        actions={
          <div className="flex flex-col items-start gap-1 rounded-lg border bg-surface px-3 py-2 text-[13px] sm:items-end" aria-label="ค่าใช้จ่ายของวิดีโอนี้">
            <span className="font-medium tabular-nums">
              ใช้แล้ว {baht(spent)}
              {pending > 0 && <span className="text-muted-foreground"> + กำลังสร้าง {baht(pending)}</span>}
            </span>
            <span className="text-xs text-muted-foreground">{cap === null ? "ไม่จำกัดต่อวิดีโอ" : `เพดานต่อวิดีโอ ${baht(cap)}`}</span>
          </div>
        }
      />

      {versions.length > 1 && (
        <nav aria-label="เวอร์ชัน" className="mb-5 flex flex-wrap items-center gap-1 text-[13px]">
          <span className="mr-1 text-muted-foreground">เวอร์ชัน</span>
          {versions.map((v) => (
            <Link
              key={v.id}
              href={`/workspace/${v.id}`}
              aria-current={v.id === sb.id ? "page" : undefined}
              className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-1 hover:bg-surface-muted", v.id === sb.id && "border-primary bg-primary-subtle")}
            >
              {v.version}
              {v.status === "approved" && <Chip tone="success">อนุมัติ</Chip>}
            </Link>
          ))}
        </nav>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 pb-24 lg:grid-cols-[210px_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4">
          <nav aria-label="ขั้นตอน" className="min-w-0">
            <ol className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible">
              {STEPS.map((s, i) => {
                const st = status[s.id];
                const Icon = STATE_ICON[st.state].icon;
                return (
                  <li key={s.id} className="shrink-0">
                    <a
                      href={`#${s.id}`}
                      className={cn(
                        "flex items-start gap-2 rounded-md border px-3 py-2 text-[13px] hover:bg-surface-muted lg:border-transparent",
                        next.step === s.id && "border-primary bg-primary-subtle lg:border-primary",
                      )}
                    >
                      <Icon className={cn("mt-0.5 size-4 shrink-0", STATE_ICON[st.state].className)} aria-label={STATE_ICON[st.state].label} />
                      <span className="min-w-0">
                        <span className="block font-medium">
                          {i + 1}. {s.label}
                        </span>
                        <span className="block text-xs text-muted-foreground">{st.note}</span>
                      </span>
                    </a>
                  </li>
                );
              })}
            </ol>
          </nav>
          <CostCard cost={cost} cap={cap} />
        </div>

        <div className="flex min-w-0 flex-col gap-10">
          <section id="product" aria-labelledby="product-h" className="scroll-mt-4">
            <SectionHeader id="product-h" title="1. สินค้า & รูป" description="รูปหลักใช้ในวิดีโอและเป็นเฟรมแรกของคลิป AI" />
            <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[minmax(0,1fr)_260px]">
              <ProductImages productId={product.id} imageUrl={productMore?.image_url ?? ""} gallery={gallery} />
              <dl className="grid grid-cols-[auto_1fr] content-start gap-x-3 gap-y-1.5 rounded-lg border bg-surface p-4 text-[13px]">
                <dt className="text-muted-foreground">ราคา</dt>
                <dd>{product.price === null ? "ไม่มีข้อมูล" : formatTHB(product.price)}</dd>
                <dt className="text-muted-foreground">ข้อมูลเมื่อ</dt>
                <dd>{product.retrieved_at ? formatDate(product.retrieved_at) : "ไม่มีข้อมูล"}</dd>
                <dt className="text-muted-foreground">ลิงก์ affiliate</dt>
                <dd className="min-w-0 truncate">
                  {product.affiliate_url ? (
                    <a href={product.affiliate_url} className="text-primary hover:underline" target="_blank" rel="noreferrer">
                      {product.affiliate_url}
                    </a>
                  ) : (
                    "ยังไม่มี"
                  )}
                </dd>
                <dd className="col-span-2 mt-1">
                  <Link href={`/products/${product.id}/edit`} className="text-xs text-primary hover:underline">
                    แก้ข้อมูลสินค้าอื่นๆ
                  </Link>
                </dd>
              </dl>
            </div>
          </section>

          <section id="settings" aria-labelledby="settings-h" className="scroll-mt-4">
            <SectionHeader id="settings-h" title="2. ตั้งค่าวิดีโอนี้" description="เลือกโมเดลสำหรับวิดีโอนี้ได้ตรงนี้ — ไม่เลือก = ใช้ค่าเริ่มต้นจากหน้าตั้งค่า" />
            <VideoSettings
              projectId={project.id}
              choices={choices}
              voice={overrides?.ttsVoice ?? ""}
              voiceDefault={voiceFor(ttsModel, account.ttsVoice) ?? "ค่าของโมเดล"}
              visualLevel={level}
              aiReady={aiReady}
            />
          </section>

          <section id="facts" aria-labelledby="facts-h" className="scroll-mt-4">
            <SectionHeader id="facts-h" title="3. ข้อเท็จจริง" description="สคริปต์อ้างได้เฉพาะข้อที่อยู่ที่นี่และยืนยันแล้ว" />
            <FactsEditor
              productId={product.id}
              productName={product.name}
              description={product.description}
              facts={factRows}
              aiReady={aiReady}
              imageCount={Math.min(5, new Set([productMore?.image_url, ...gallery].filter(Boolean)).size)}
            />
          </section>

          <section id="script" aria-labelledby="script-h" className="scroll-mt-4">
            <SectionHeader
              id="script-h"
              title="4. สคริปต์ & ภาพต่อฉาก"
              description="แต่ละฉาก: บทและ claim ด้านบน ภาพของฉาก (รูปสินค้า หรือคลิป AI + โมเดล + ทรานซิชัน) ด้านล่าง · อนุมัติแล้วบทล็อก แต่ภาพยังแก้ได้"
            />
            <div className="mb-4">
              <ClipsToolbar storyboardId={sb.id} scenes={d.clipScenes} aiReady={aiReady} approved={locked} level={VISUAL_LEVEL[level]} />
            </div>
            <StudioShell
              storyboardId={sb.id}
              productId={product.id}
              hook={sb.hook}
              caption={sb.caption}
              cta={sb.cta}
              disclosure={sb.disclosure}
              scenes={scenes}
              facts={facts}
              issues={issues}
              locked={locked}
              targetSeconds={project.target_duration_s}
              approvedAt={sb.approved_at}
              llmNote={aiReady ? "เชื่อม AI ผ่าน OpenRouter แล้ว — โมเดลเขียนสคริปต์ของวิดีโอนี้ตั้งได้ในขั้นที่ 2" : LLM_STATUS.note}
              assets={assets}
              promptContext={{
                productName: product.name,
                templateName: getTemplate(sb.template_id)?.name ?? sb.template_id,
                platformLabel: PLATFORM_LABEL[project.platform as Platform],
                targetSeconds: project.target_duration_s,
                aiReady,
              }}
              sceneExtras={sceneExtras}
              inWorkspace
            />
          </section>

          <section id="render" aria-labelledby="render-h" className="scroll-mt-4">
            <SectionHeader id="render-h" title="5. Render & เผยแพร่" description="เสียงพากย์ เพลง แล้ว render — ได้ MP4 แนวตั้ง ซับไทย ภาพปก และแคปชันพร้อมโพสต์" />
            <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="flex min-w-0 flex-col gap-6">
                <OutputSection d={d} />
              </div>
              <aside aria-label="Render" className="order-first flex flex-col gap-4 lg:order-none">
                <RenderAside d={d} />
              </aside>
            </div>
            <RenderHistory d={d} />
          </section>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-surface/95 backdrop-blur" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <div className="mx-auto flex max-w-screen-xl flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
          <p className="min-w-0">
            <span className="text-muted-foreground">ขั้นถัดไป: </span>
            <span className="font-medium">{next.text}</span>
          </p>
          <a href={`#${next.step}`} className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:opacity-90">
            ไปที่ขั้นนี้ <ArrowDown className="size-3.5" aria-hidden />
          </a>
        </div>
      </div>
    </>
  );
}
