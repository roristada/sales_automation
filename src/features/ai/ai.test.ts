import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAiSpend, DEFAULT_AI_SPEND } from "./budget";
import { DEFAULT_MODELS, modelFor, parseModelPicks, textModelsFor, textPriceLabel, usdToThb, videoModelsFor } from "./models";
import { chat, errorMessage, getKeyInfo, OpenRouterError, videoPricePerSecond, type TextModel, type VideoModel } from "./openrouter";

/*
 * Contract tests for the OpenRouter client: request shape, response parsing and error handling,
 * with a stub fetch. They don't stand in for a real call — Settings has "ทดสอบเรียก AI จริง".
 */

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("OpenRouter client", () => {
  beforeEach(() => vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test"));
  afterEach(() => vi.unstubAllEnvs());

  it("sends the key and a JSON-schema request, and reads text, tokens and cost", async () => {
    // OpenRouter streams keep-alive whitespace before the JSON body.
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        "\n  " +
          JSON.stringify({ id: "gen-1", model: "deepseek/deepseek-v4.1-flash", choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 38, completion_tokens: 12, cost: 0.00002 } }),
        { status: 200 },
      ),
    );
    const r = await chat({ model: "deepseek/deepseek-v4.1-flash", messages: [{ role: "user", content: "hi" }], schema: { name: "x", schema: { type: "object" } }, maxTokens: 50, fetchImpl });
    expect(r).toEqual({ text: '{"ok":true}', model: "deepseek/deepseek-v4.1-flash", generationId: "gen-1", inputTokens: 38, outputTokens: 12, costUsd: 0.00002, finishReason: "stop" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer sk-or-test");
    expect(JSON.parse(init!.body as string)).toMatchObject({ max_tokens: 50, usage: { include: true }, response_format: { type: "json_schema", json_schema: { name: "x", strict: true } } });
  });

  it("refuses without a key and never calls out", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const fetchImpl = vi.fn();
    await expect(chat({ model: "a/b", messages: [], fetchImpl })).rejects.toThrow(/OPENROUTER_API_KEY/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps errors to Thai messages, including errors inside a 200 body", async () => {
    const insufficient = vi.fn(async () => json({ error: { code: 402, message: "Insufficient credits" } }, 402));
    await expect(chat({ model: "a/b", messages: [], fetchImpl: insufficient })).rejects.toMatchObject({ status: 402, message: expect.stringContaining("เครดิต OpenRouter ไม่พอ") });
    const inBody = vi.fn(async () => json({ error: { code: 404, message: "No endpoints found" } }));
    await expect(chat({ model: "a/b", messages: [], fetchImpl: inBody })).rejects.toMatchObject({ status: 404 });
    expect(errorMessage(401)).toMatch(/API key/);
  });

  it("doesn't retry a chat call (it may already be billed) but retries free GETs", async () => {
    vi.useFakeTimers();
    try {
      const busy = vi.fn(async () => json({ error: { message: "busy" } }, 503));
      await expect(chat({ model: "a/b", messages: [], fetchImpl: busy })).rejects.toBeInstanceOf(OpenRouterError);
      expect(busy).toHaveBeenCalledTimes(1);

      const flaky = vi.fn().mockResolvedValueOnce(json({}, 429)).mockResolvedValueOnce(json({ data: { limit: 15, limit_remaining: 14.5, usage: 0.5, limit_reset: "monthly" } }));
      const p = getKeyInfo({ fetchImpl: flaky });
      await vi.runAllTimersAsync();
      expect(await p).toEqual({ limitUsd: 15, remainingUsd: 14.5, usageUsd: 0.5, limitReset: "monthly" });
      expect(flaky).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("video pricing", () => {
  it("reads per-second 720p prices in cents or dollars, and null for token pricing", () => {
    expect(videoPricePerSecond({ cents_per_image_input: "1", cents_per_video_output_second_480p: "2", cents_per_video_output_second_720p: "3" })).toBeCloseTo(0.03);
    expect(videoPricePerSecond({ duration_seconds_with_audio: "0.08", duration_seconds_without_audio: "0.05", duration_seconds_without_audio_720p: "0.05" })).toBeCloseTo(0.05);
    expect(videoPricePerSecond({ duration_seconds: "0.084", duration_seconds_with_audio: "0.126" })).toBeCloseTo(0.084);
    expect(videoPricePerSecond({ video_tokens: "0.0000107" })).toBeNull();
  });
});

describe("model picks", () => {
  it("keeps known tasks with well-formed ids and falls back to defaults", () => {
    const picks = parseModelPicks({ script: "anthropic/claude-haiku-5.5", review: "not a model", other: "a/b", extract: 5 });
    expect(picks).toEqual({ script: "anthropic/claude-haiku-5.5" });
    expect(modelFor("script", picks)).toBe("anthropic/claude-haiku-5.5");
    expect(modelFor("review", picks)).toBe(DEFAULT_MODELS.review);
    expect(parseModelPicks(null)).toEqual({});
  });

  it("offers only models that fit the task", () => {
    const t = (id: string, inputModalities: string[], structuredOutputs = true): TextModel => ({ id, name: id, prompt: 0, completion: 0, inputModalities, structuredOutputs, expiresAt: null });
    const text = [t("a/text", ["text"]), t("a/vision", ["text", "image"]), t("a/video", ["text", "image", "video"]), t("a/nojson", ["text", "image", "video"], false)];
    expect(textModelsFor("script", text).map((m) => m.id)).toEqual(["a/text", "a/vision", "a/video"]);
    expect(textModelsFor("extract", text).map((m) => m.id)).toEqual(["a/vision", "a/video"]);
    expect(textModelsFor("review", text).map((m) => m.id)).toEqual(["a/video"]);
    const v = (id: string, aspectRatios: string[], frameImages: string[]): VideoModel => ({ id, name: id, aspectRatios, durations: [5], frameImages, resolutions: [], pricing: {} });
    const video = [v("v/wide", ["16:9"], ["first_frame"]), v("v/t2v", ["9:16"], []), v("v/i2v", ["9:16"], ["first_frame"])];
    expect(videoModelsFor("video_product", video).map((m) => m.id)).toEqual(["v/i2v"]);
    expect(videoModelsFor("video_lifestyle", video).map((m) => m.id)).toEqual(["v/t2v", "v/i2v"]);
  });

  it("formats prices and converts USD to THB", () => {
    expect(textPriceLabel({ prompt: 0.00000003, completion: 0.00000012 })).toBe("$0.03 / $0.12 ต่อล้าน token");
    expect(textPriceLabel({ prompt: 0.000002, completion: 0.00001 })).toBe("$2 / $10 ต่อล้าน token");
    expect(textPriceLabel({ prompt: 0, completion: 0 })).toBe("ฟรี");
    expect(usdToThb(0.42, 35)).toBe(14.7);
    expect(usdToThb(0.00002, 35)).toBe(0.0007);
  });
});

describe("checkAiSpend", () => {
  const spent = { today_thb: 10, month_thb: 100 };
  it("blocks over the daily/monthly cap and the per-video cap", () => {
    expect(checkAiSpend({ limits: { daily_thb: 20, monthly_thb: null }, spent, settings: DEFAULT_AI_SPEND, estimate: 15 })).toMatchObject({ ok: false, needsConfirm: false, message: expect.stringContaining("รายวัน") });
    expect(checkAiSpend({ limits: null, spent, settings: DEFAULT_AI_SPEND, videoSpent: 140, estimate: 15 })).toMatchObject({ ok: false, needsConfirm: false, message: expect.stringContaining("ต่อวิดีโอ") });
    expect(checkAiSpend({ limits: null, spent, settings: { per_video_cap_thb: null, confirm_over_thb: 30 }, videoSpent: 140, estimate: 15 })).toEqual({ ok: true });
  });
  it("asks for confirmation above the threshold until confirmed", () => {
    expect(checkAiSpend({ limits: null, spent, settings: DEFAULT_AI_SPEND, estimate: 31 })).toMatchObject({ ok: false, needsConfirm: true });
    expect(checkAiSpend({ limits: null, spent, settings: DEFAULT_AI_SPEND, estimate: 31, confirmed: true })).toEqual({ ok: true });
    expect(checkAiSpend({ limits: null, spent, settings: DEFAULT_AI_SPEND, estimate: 30 })).toEqual({ ok: true });
  });
});
