import "server-only";

import { DEFAULT_CLIP_SECONDS, VIDEO_TASKS, type VideoTask, type VisualMode } from "@/features/ai/clips";
import { modelFor, usdThbRate, usdToThb, videoModelsFor } from "@/features/ai/models";
import { isOpenRouterConfigured } from "@/features/ai/openrouter";
import { getAiSettings, getCatalog } from "@/features/ai/queries";
import { estimateVoiceoverUsd, voiceFor } from "@/features/ai/voiceover";
import { licenseVerdict } from "@/features/assets/licensing";
import type { Db } from "@/features/content/queries";
import { type Platform, PLATFORMS, SCENE_KIND_LABEL } from "@/features/content/templates";
import { getWorkerStatus } from "@/features/monitoring/queries";
import { workerState } from "@/features/monitoring/status";
import { galleryList } from "@/features/products/schema";
import type { ClipScene, ReusableClip, VideoChoices } from "./clips-panel";
import type { QaReport } from "./qa";
import type { ActiveJob, MusicOption, VoiceOption } from "./render-panel";
import { buildTimeline, type TransitionChoice } from "./timeline";

/**
 * Everything the video side of a script needs: AI clips per scene, live preview, render state,
 * outputs, QA and publications. Shared by Video Studio and the video workspace.
 */
export async function loadVideoStudio(db: Db, storyboardId: string) {
  const { data: sb } = await db
    .from("storyboards")
    .select("*, project:content_projects(id, title, platform, target_duration_s, product:products(id, name, image_url, gallery_urls))")
    .eq("id", storyboardId)
    .maybeSingle();
  if (!sb?.project?.product) return null;
  const { project } = sb;
  const product = project.product!;
  const aiReady = isOpenRouterConfigured();
  const [{ data: scenes }, { data: jobs }, { data: pubs }, { data: plans }, { data: generations }, aiSettings, catalog, { data: tracks }] = await Promise.all([
    db.from("storyboard_scenes").select("id, kind, narration, on_screen_text, asset:assets(id, kind, duration_s)").eq("storyboard_id", storyboardId).order("position"),
    db.from("render_jobs").select("*, output:render_outputs(*)").eq("storyboard_id", storyboardId).order("created_at", { ascending: false }).limit(20),
    db.from("publications").select("id, platform, status").eq("project_id", project.id).neq("status", "withdrawn").order("created_at"),
    db.from("scene_visual_plans").select("scene_id, mode, video_task, prompt, duration_s, transition, model").eq("storyboard_id", storyboardId),
    db.from("scene_generations").select("*").eq("storyboard_id", storyboardId).order("created_at", { ascending: false }).limit(200),
    getAiSettings(db, { storyboardId }),
    aiReady ? getCatalog() : Promise.resolve({ error: "ยังไม่ได้ตั้งค่า" } as const),
    db.from("assets").select("id, name, license, attribution, source, ai_generated, duration_s").eq("kind", "audio").order("created_at", { ascending: false }).limit(100),
  ]);
  // AI-6: approved clips of this product in its other scripts can be reused for free.
  const { data: others } = await db
    .from("scene_generations")
    .select("id, prompt, duration_s, model, created_at, storyboard:storyboards!inner(version, project:content_projects!inner(title, product_id))")
    .eq("review_status", "approved")
    .neq("storyboard_id", storyboardId)
    .eq("storyboard.project.product_id", product.id)
    .order("created_at", { ascending: false })
    .limit(30);
  const reusable: ReusableClip[] = (others ?? []).map((g) => ({
    id: g.id,
    label: `${g.storyboard.project.title} v${g.storyboard.version} · ${g.duration_s} วิ · ${g.prompt.slice(0, 60)}${g.prompt.length > 60 ? "…" : ""}`,
  }));
  const planOf = new Map((plans ?? []).map((p) => [p.scene_id, p]));
  const hasFrame = !!product.image_url && /^https?:\/\//i.test(product.image_url);
  const clipScenes: ClipScene[] = (scenes ?? []).map((s, i) => {
    const p = planOf.get(s.id);
    const plan = {
      mode: (p?.mode ?? "product_motion") as VisualMode,
      video_task: (p?.video_task ?? "video_product") as VideoTask,
      prompt: p?.prompt ?? "",
      duration_s: p?.duration_s ?? DEFAULT_CLIP_SECONDS,
      transition: (p?.transition ?? "auto") as TransitionChoice,
      model: p?.model ?? null,
    };
    const gens = (generations ?? []).filter((g) => g.scene_id === s.id);
    // Latest few attempts plus the approved one if it's older.
    const shown = [...gens.slice(0, 3), ...gens.slice(3).filter((g) => g.review_status === "approved")];
    return {
      id: s.id,
      n: i + 1,
      kindLabel: SCENE_KIND_LABEL[s.kind] ?? s.kind,
      narration: s.narration,
      plan,
      generations: shown.map((g) => ({
        id: g.id,
        status: g.status,
        reviewStatus: g.review_status,
        model: g.model,
        durationS: g.duration_s,
        assetId: g.asset_id,
        costThb: g.cost_thb === null ? null : Number(g.cost_thb),
        estThb: Number(g.est_cost_thb),
        error: g.error,
        qualityNote: g.quality_note,
        createdAt: g.created_at,
      })),
    };
  });

  // Video models per task (from the live catalog) for the per-scene pick; estimates are worked
  // out in the panel from each model's prices, so they follow the pick and the duration.
  const videoChoices: VideoChoices = Object.fromEntries(
    VIDEO_TASKS.map((task) => {
      const list = "error" in catalog ? [] : videoModelsFor(task, catalog.video);
      return [task, { defaultModel: modelFor(task, aiSettings.models), models: list.map((m) => ({ id: m.id, name: m.name, durations: m.durations, resolutions: m.resolutions, pricing: m.pricing })) }];
    }),
  ) as VideoChoices;

  const preview = buildTimeline({
    productName: product.name,
    imageSrc: product.image_url,
    gallery: galleryList(product.gallery_urls),
    hook: sb.hook,
    cta: sb.cta,
    disclosure: sb.disclosure,
    scenes: (scenes ?? []).map((s) => {
      // Same rule as the render: a scene planned as an AI clip shows its approved clip.
      const clip = planOf.get(s.id)?.mode === "ai_video" ? generations?.find((g) => g.scene_id === s.id && g.review_status === "approved" && g.asset_id) : undefined;
      const media = clip
        ? { kind: "video" as const, src: `/api/assets/${clip.asset_id}`, durationS: clip.duration_s }
        : s.asset
          ? { kind: s.asset.kind as "image" | "video", src: `/api/assets/${s.asset.id}`, durationS: s.asset.duration_s }
          : null;
      return { ...s, media, transition: planOf.get(s.id)?.transition };
    }),
  });
  const activeRow = jobs?.find((j) => j.status === "queued" || j.status === "processing");
  // Only asked while a job waits: tells "worker not running" apart from "queued behind another job".
  const worker = activeRow?.status === "queued" ? workerState(await getWorkerStatus(db)) : "unknown";
  const active: ActiveJob | null = activeRow
    ? {
        id: activeRow.id,
        status: activeRow.status as ActiveJob["status"],
        progress: activeRow.progress,
        stage: activeRow.stage,
        attempt: activeRow.attempt,
        createdAt: activeRow.created_at,
        errorMessage: activeRow.error_message,
      }
    : null;
  const ttsModel = modelFor("tts", aiSettings.models);
  const ttsVoice = voiceFor(ttsModel, aiSettings.ttsVoice);
  const ttsInfo = "error" in catalog ? undefined : catalog.speech.find((m) => m.id === ttsModel);
  const lastSettings = (jobs?.[0]?.settings ?? null) as { tts?: unknown; music_asset_id?: unknown } | null;
  const voiceOption: VoiceOption | null = aiReady
    ? {
        label: `${ttsModel}${ttsVoice ? ` · เสียง ${ttsVoice}` : ""}`,
        estThb: usdToThb(estimateVoiceoverUsd(ttsInfo, (scenes ?? []).map((s) => s.narration))),
        lastUsed: !!lastSettings?.tts && lastSettings.tts !== "none",
      }
    : null;
  const musicOptions: MusicOption[] = (tracks ?? []).map((t) => {
    const v = licenseVerdict(t);
    return { id: t.id, name: t.name, durationS: t.duration_s, level: v.level, message: v.message };
  });
  const lastMusic = lastSettings?.music_asset_id;
  const latestDone = jobs?.find((j) => j.status === "completed" && j.output) ?? null;
  const output = latestDone?.output ?? null;
  // Suggest the project's platform first, then one this content isn't on yet.
  const taken = new Set(pubs?.map((p) => p.platform));
  const nextPlatform = [project.platform as Platform, ...PLATFORMS].find((p) => !taken.has(p)) ?? (project.platform as Platform);

  return {
    sb,
    project,
    product,
    aiReady,
    jobs: jobs ?? [],
    pubs: pubs ?? [],
    clipScenes,
    reusable,
    videoChoices,
    hasFrame,
    usdThb: usdThbRate(),
    preview,
    active,
    workerOnline: worker === "unknown" ? null : worker === "online" || worker === "busy",
    voiceOption,
    musicOptions,
    lastMusicId: typeof lastMusic === "string" && musicOptions.some((m) => m.id === lastMusic) ? lastMusic : null,
    latestDone,
    output,
    report: (output?.report ?? undefined) as QaReport | undefined,
    lastFailed: jobs?.[0]?.status === "failed" ? jobs[0] : null,
    nextPlatform,
    fileBase: `${product.name.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40)}-v${sb.version}`,
    /** AI clips planned / approved, for step status. */
    aiScenes: clipScenes.filter((s) => s.plan.mode === "ai_video").length,
    aiScenesReady: clipScenes.filter((s) => s.plan.mode === "ai_video" && s.generations.some((g) => g.reviewStatus === "approved")).length,
  };
}

export type VideoStudioData = NonNullable<Awaited<ReturnType<typeof loadVideoStudio>>>;
