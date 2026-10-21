import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildVisualPlanPrompt, clipBlocker, clipSpec, parseVisualPlanJson, VISUAL_PLAN_SCHEMA } from "./clips";
import { estimateVideoUsd, getVideoJob, nearestDuration, submitVideo } from "./openrouter";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("visual plan", () => {
  it("prompt lists verified facts and every scene, and forbids inventing features or real people", () => {
    const p = buildVisualPlanPrompt("Edifier Comfo Bass", "หูฟัง", [{ label: "กันน้ำ", value: "IP55" }], [
      { kindLabel: "แนะนำสินค้า", narration: "นี่คือหูฟัง", on_screen_text: "" },
      { kindLabel: "ราคา", narration: "ราคา 1,425", on_screen_text: "฿1,425" },
    ]);
    expect(p).toContain("- กันน้ำ: IP55");
    expect(p).toContain("Scenes (2,");
    expect(p).toMatch(/Never add features/);
    expect(p).toMatch(/No real people's likeness/);
    expect(VISUAL_PLAN_SCHEMA.schema.properties.scenes.items.additionalProperties).toBe(false);
  });

  it("parses a plan with one entry per scene, refuses AI scenes without a prompt and malformed replies", () => {
    const ok = { scenes: [{ mode: "ai_video", video_task: "video_product", prompt: " slow rotation " }, { mode: "product_motion", video_task: "video_product", prompt: "" }] };
    expect(parseVisualPlanJson(ok, 2)).toEqual({ ok: true, plans: [{ mode: "ai_video", video_task: "video_product", prompt: "slow rotation" }, { mode: "product_motion", video_task: "video_product", prompt: "" }] });
    expect(parseVisualPlanJson(ok, 3)).toMatchObject({ ok: false, error: expect.stringContaining("3 ฉาก") });
    expect(parseVisualPlanJson({ scenes: [{ mode: "ai_video", video_task: "video_product", prompt: "" }] }, 1)).toMatchObject({ ok: false, error: expect.stringContaining("ไม่มี prompt") });
    expect(parseVisualPlanJson({ scenes: [{ mode: "dance" }] }, 1)).toMatchObject({ ok: false });
  });

  it("says why a scene can't be generated yet", () => {
    expect(clipBlocker(null, "https://x/p.jpg")).toMatch(/motion graphics/);
    expect(clipBlocker({ mode: "ai_video", video_task: "video_product", prompt: " " }, "https://x/p.jpg")).toMatch(/prompt/);
    expect(clipBlocker({ mode: "ai_video", video_task: "video_product", prompt: "p" }, null)).toMatch(/ไม่มีรูป/);
    expect(clipBlocker({ mode: "ai_video", video_task: "video_lifestyle", prompt: "p" }, null)).toBeNull();
  });
});

describe("clip spec and pricing", () => {
  const kling = { durations: [5, 10], resolutions: ["720p", "1080p"], pricing: { duration_seconds: "0.084", duration_seconds_with_audio: "0.126" } };
  const grok = { durations: [1, 2, 3, 4, 5, 6], resolutions: ["480p", "720p"], pricing: { cents_per_image_input: "1", cents_per_video_output_second_720p: "3" } };
  it("snaps to a supported duration and estimates from catalog prices", () => {
    expect(nearestDuration(7, [5, 10])).toBe(5);
    expect(nearestDuration(8, [5, 10])).toBe(10);
    expect(nearestDuration(4, [])).toBe(4);
    expect(clipSpec(kling, 6, true)).toEqual({ duration: 5, resolution: "720p", estUsd: expect.closeTo(0.42), priced: true });
    expect(estimateVideoUsd(grok.pricing, 5, true)).toBeCloseTo(0.16);
    expect(estimateVideoUsd(grok.pricing, 5, false)).toBeCloseTo(0.15);
  });
  it("assumes a cautious price for token-priced or unknown models", () => {
    expect(clipSpec({ durations: [5], resolutions: [], pricing: { video_tokens: "0.0000107" } }, 5, false)).toMatchObject({ estUsd: 0.75, priced: false });
    expect(clipSpec(undefined, 4, false)).toMatchObject({ duration: 4, estUsd: 0.6, priced: false });
  });
});

describe("video client", () => {
  beforeEach(() => vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test"));
  afterEach(() => vi.unstubAllEnvs());

  it("submits once, without audio, with the first frame; a server error isn't retried", async () => {
    const ok = vi.fn<typeof fetch>(async () => json({ id: "job-1", status: "pending" }, 202));
    expect(await submitVideo({ model: "m/v", prompt: "p", duration: 5, aspectRatio: "9:16", resolution: "720p", firstFrameUrl: "https://x/p.jpg", fetchImpl: ok })).toMatchObject({ id: "job-1", status: "pending" });
    expect(JSON.parse(ok.mock.calls[0][1]!.body as string)).toMatchObject({ generate_audio: false, aspect_ratio: "9:16", frame_images: [{ frame_type: "first_frame", image_url: { url: "https://x/p.jpg" } }] });
    const bad = vi.fn<typeof fetch>(async () => json({ error: { message: "x" } }, 503));
    await expect(submitVideo({ model: "m/v", prompt: "p", duration: 5, aspectRatio: "9:16", resolution: "720p", fetchImpl: bad })).rejects.toThrow();
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it("reads job status, cost and error; rejects odd job ids", async () => {
    const done = vi.fn<typeof fetch>(async () => json({ id: "j", status: "completed", generation_id: "g", usage: { cost: 0.25 } }));
    expect(await getVideoJob("j", { fetchImpl: done })).toEqual({ id: "j", status: "completed", generationId: "g", costUsd: 0.25, error: null });
    const failed = vi.fn<typeof fetch>(async () => json({ id: "j", status: "failed", error: "content policy" }));
    expect((await getVideoJob("j", { fetchImpl: failed })).error).toBe("content policy");
    await expect(getVideoJob("../key")).rejects.toThrow();
  });
});

describe("AI clips in the render (AI-4)", () => {
  it("uses the approved clip for AI scenes and reports AI scenes without one", async () => {
    const { resolveAiClips, missingClipsMessage } = await import("./clips");
    const scenes = [{ id: "s1" }, { id: "s2" }, { id: "s3" }];
    const plans = [
      { scene_id: "s1", mode: "ai_video" },
      { scene_id: "s2", mode: "product_motion" },
      { scene_id: "s3", mode: "ai_video" },
    ];
    const r = resolveAiClips(scenes, plans, [
      { scene_id: "s1", asset_id: "a1" },
      { scene_id: "s2", asset_id: "a2" },
    ]);
    expect([...r.assetByScene]).toEqual([["s1", "a1"]]);
    expect(r.missing).toEqual([3]);
    expect(missingClipsMessage(r.missing)).toMatch(/^ฉากที่ 3 ตั้งเป็นคลิป AI/);
    expect(resolveAiClips(scenes, [], []).missing).toEqual([]);
  });

  it("adds the AI note to the caption only for videos with AI clips", async () => {
    const { composeCaption } = await import("@/features/publishing/publishing");
    const base = { caption: "หูฟัง", disclosure: "#ได้รับค่าคอมมิชชัน", affiliateUrl: null, platform: "tiktok" as const };
    expect(composeCaption({ ...base, aiGenerated: true })).toBe("หูฟัง\n\n#ได้รับค่าคอมมิชชัน\n\nมีภาพบางส่วนในคลิปนี้สร้างด้วย AI");
    expect(composeCaption(base)).toBe("หูฟัง\n\n#ได้รับค่าคอมมิชชัน");
  });
});
