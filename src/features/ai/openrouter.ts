/**
 * OpenRouter client (docs/AI_VIDEO_PLAN.md AI-1). One key for text, video and speech models.
 * Server and worker only: the key comes from OPENROUTER_API_KEY, which is never NEXT_PUBLIC_, so
 * it can't reach a browser bundle. Errors are Thai messages safe to show the user (no key, no
 * raw response body).
 */

/** Overridable only so tests can point the worker at a local fake server. */
const base = () => process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const DEFAULT_TIMEOUT_MS = 60_000;
const RETRY_DELAYS_MS = [1_000, 3_000];

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

export function openRouterKey(): string | null {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  return key ? key : null;
}

export function isOpenRouterConfigured(): boolean {
  return openRouterKey() !== null;
}

/** Thai message for an HTTP status; `detail` is OpenRouter's own error message, if any. */
export function errorMessage(status: number, detail?: string): string {
  const base =
    status === 401
      ? "OpenRouter ไม่รับ API key — ตรวจ OPENROUTER_API_KEY ใน .env.local"
      : status === 402
        ? "เครดิต OpenRouter ไม่พอหรือ key ถึงเพดานแล้ว — เติมเครดิต/ปรับเพดานที่ openrouter.ai/settings"
        : status === 403
          ? "OpenRouter ปฏิเสธคำขอนี้ (อาจถูกระบบกลั่นกรองเนื้อหาบล็อก)"
          : status === 404
            ? "ไม่พบโมเดลนี้บน OpenRouter — อาจถูกปิดแล้ว เลือกโมเดลใหม่ในหน้าตั้งค่า"
            : status === 408 || status === 504
              ? "OpenRouter ตอบช้าเกินไป ลองใหม่อีกครั้ง"
              : status === 429
                ? "เรียก OpenRouter ถี่เกินไป รอสักครู่แล้วลองใหม่"
                : status >= 500
                  ? "OpenRouter หรือผู้ให้บริการโมเดลขัดข้องชั่วคราว ลองใหม่อีกครั้ง"
                  : `OpenRouter ตอบกลับผิดพลาด (HTTP ${status})`;
  return detail ? `${base} · ${detail.slice(0, 200)}` : base;
}

const isRetryable = (status: number) => status === 408 || status === 429 || status >= 500;

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  /** Public endpoints (model catalogs) work without a key. */
  auth?: boolean;
  timeoutMs?: number;
  /** Retry on 408/429/5xx and network errors. Off for calls that may be billed twice. */
  retry?: boolean;
  /** Off where `error` is part of a normal payload (a failed video job). */
  inBodyErrors?: boolean;
  fetchImpl?: typeof fetch;
}

async function request<T>(path: string, { method = "GET", body, auth = true, timeoutMs = DEFAULT_TIMEOUT_MS, retry = true, inBodyErrors = true, fetchImpl = fetch }: RequestOptions = {}): Promise<T> {
  const key = openRouterKey();
  if (auth && !key) throw new OpenRouterError("ยังไม่ได้ตั้งค่า OPENROUTER_API_KEY ใน .env.local");
  const headers: Record<string, string> = { "X-Title": "Sales Automation" };
  if (key) headers.Authorization = `Bearer ${key}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  for (let attempt = 0; ; attempt++) {
    let error: OpenRouterError;
    try {
      const res = await fetchImpl(base() + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text.trim() ? JSON.parse(text) : null;
      } catch {
        // Non-JSON body (e.g. an HTML error page): fall through to the status check.
      }
      // OpenRouter can also report a failure inside a 200 body.
      const apiError = inBodyErrors || !res.ok ? (json as { error?: { code?: number; message?: string } } | null)?.error : undefined;
      if (res.ok && !apiError) {
        if (json === null) throw new OpenRouterError("OpenRouter ตอบกลับไม่ใช่ JSON");
        return json as T;
      }
      const status = res.ok ? Number(apiError?.code) || 500 : res.status;
      error = new OpenRouterError(errorMessage(status, apiError?.message), status, isRetryable(status));
    } catch (e) {
      if (e instanceof OpenRouterError) throw e;
      const timedOut = e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
      error = new OpenRouterError(timedOut ? errorMessage(408) : "เชื่อมต่อ OpenRouter ไม่ได้ — ตรวจอินเทอร์เน็ต", null, true);
    }
    if (!retry || !error.retryable || attempt >= RETRY_DELAYS_MS.length) throw error;
    await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
  }
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

export interface KeyInfo {
  /** USD; null = the key has no limit. */
  limitUsd: number | null;
  remainingUsd: number | null;
  usageUsd: number;
  limitReset: string | null;
}

/** `GET /key` — free, no generation. Also the connection test. */
export async function getKeyInfo(opts?: Pick<RequestOptions, "fetchImpl" | "timeoutMs">): Promise<KeyInfo> {
  const { data } = await request<{ data: { limit: number | null; limit_remaining: number | null; usage?: number; limit_reset?: string | null } }>("/key", { ...opts, timeoutMs: opts?.timeoutMs ?? 10_000 });
  return { limitUsd: data.limit ?? null, remainingUsd: data.limit_remaining ?? null, usageUsd: Number(data.usage ?? 0), limitReset: data.limit_reset ?? null };
}

/** `GET /credits` — purchased credits and total usage on the account, USD. */
export async function getCredits(opts?: Pick<RequestOptions, "fetchImpl" | "timeoutMs">): Promise<{ totalUsd: number; usedUsd: number }> {
  const { data } = await request<{ data: { total_credits: number; total_usage: number } }>("/credits", { ...opts, timeoutMs: opts?.timeoutMs ?? 10_000 });
  return { totalUsd: Number(data.total_credits), usedUsd: Number(data.total_usage) };
}

// ---------------------------------------------------------------------------
// Catalogs
// ---------------------------------------------------------------------------

export interface TextModel {
  id: string;
  name: string;
  /** USD per token. */
  prompt: number;
  completion: number;
  inputModalities: string[];
  structuredOutputs: boolean;
  expiresAt: string | null;
}

export interface VideoModel {
  id: string;
  name: string;
  aspectRatios: string[];
  durations: number[];
  frameImages: string[];
  resolutions: string[];
  /** As listed by OpenRouter; units differ per model (see videoPricePerSecond). */
  pricing: Record<string, string>;
}

interface RawTextModel {
  id: string;
  name: string;
  pricing: { prompt: string; completion: string };
  architecture: { input_modalities?: string[]; output_modalities?: string[] };
  supported_parameters?: string[];
  expiration_date?: string | null;
}

interface RawVideoModel {
  id: string;
  name: string;
  supported_aspect_ratios?: string[] | null;
  supported_durations?: number[] | null;
  supported_frame_images?: string[] | null;
  supported_resolutions?: string[] | null;
  pricing_skus?: Record<string, string> | null;
}

/** Text-output models (`GET /models`, public). */
export async function listTextModels(opts?: Pick<RequestOptions, "fetchImpl">): Promise<TextModel[]> {
  const { data } = await request<{ data: RawTextModel[] }>("/models", { ...opts, auth: false, timeoutMs: 15_000 });
  return data
    .filter((m) => m.architecture.output_modalities?.includes("text") ?? true)
    .map((m) => ({
      id: m.id,
      name: m.name,
      prompt: Number(m.pricing.prompt),
      completion: Number(m.pricing.completion),
      inputModalities: m.architecture.input_modalities ?? ["text"],
      structuredOutputs: m.supported_parameters?.includes("structured_outputs") ?? false,
      expiresAt: m.expiration_date ?? null,
    }));
}

/** Video models (`GET /videos/models`, public). */
export async function listVideoModels(opts?: Pick<RequestOptions, "fetchImpl">): Promise<VideoModel[]> {
  const { data } = await request<{ data: RawVideoModel[] }>("/videos/models", { ...opts, auth: false, timeoutMs: 15_000 });
  return data.map((m) => ({
    id: m.id,
    name: m.name,
    aspectRatios: m.supported_aspect_ratios ?? [],
    durations: m.supported_durations ?? [],
    frameImages: m.supported_frame_images ?? [],
    resolutions: m.supported_resolutions ?? [],
    pricing: m.pricing_skus ?? {},
  }));
}

/**
 * USD per second of 720p video without audio, when the catalog prices it per second. Keys named
 * `cents_*` are in US cents, the rest in dollars. Null when priced another way (e.g. per token).
 */
export function videoPricePerSecond(pricing: Record<string, string>): number | null {
  const keys = Object.keys(pricing).filter((k) => /second/.test(k) && !/reference|with_audio|text_to_video|with_video_input|upscale|megapixel|minimum/.test(k));
  const pick = keys.find((k) => /720p/.test(k)) ?? keys.find((k) => !/\d+p|\dk/.test(k)) ?? keys.find((k) => /768p/.test(k));
  if (!pick) return null;
  const v = Number(pricing[pick]);
  if (!Number.isFinite(v)) return null;
  return pick.startsWith("cents_") ? v / 100 : v;
}

// ---------------------------------------------------------------------------
// Chat completions
// ---------------------------------------------------------------------------

export type ChatContent = string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];

export interface ChatInput {
  model: string;
  messages: { role: "system" | "user" | "assistant"; content: ChatContent }[];
  maxTokens?: number;
  temperature?: number;
  /** JSON schema for structured output. */
  schema?: { name: string; schema: Record<string, unknown> };
  /** Reasoning models: "low" keeps cost and latency down for simple tasks. */
  reasoningEffort?: "low" | "medium" | "high";
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface ChatResult {
  text: string;
  model: string;
  generationId: string | null;
  inputTokens: number;
  outputTokens: number;
  /** As charged by OpenRouter (usage.cost, USD). */
  costUsd: number;
  finishReason: string | null;
}

interface RawChat {
  id?: string;
  model?: string;
  choices?: { finish_reason?: string | null; message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
}

/**
 * `POST /chat/completions`. Not retried after the request was sent: a call that timed out may
 * still have been billed, and the caller logs whatever came back.
 */
export async function chat(input: ChatInput): Promise<ChatResult> {
  const body: Record<string, unknown> = { model: input.model, messages: input.messages, usage: { include: true } };
  if (input.maxTokens) body.max_tokens = input.maxTokens;
  if (input.temperature !== undefined) body.temperature = input.temperature;
  if (input.reasoningEffort) body.reasoning = { effort: input.reasoningEffort };
  if (input.schema) body.response_format = { type: "json_schema", json_schema: { name: input.schema.name, strict: true, schema: input.schema.schema } };
  const raw = await request<RawChat>("/chat/completions", { method: "POST", body, retry: false, timeoutMs: input.timeoutMs, fetchImpl: input.fetchImpl });
  const choice = raw.choices?.[0];
  return {
    text: choice?.message?.content ?? "",
    model: raw.model ?? input.model,
    generationId: raw.id ?? null,
    inputTokens: raw.usage?.prompt_tokens ?? 0,
    outputTokens: raw.usage?.completion_tokens ?? 0,
    costUsd: Number(raw.usage?.cost ?? 0),
    finishReason: choice?.finish_reason ?? null,
  };
}

// ---------------------------------------------------------------------------
// Video generation (async jobs)
// ---------------------------------------------------------------------------

export interface VideoInput {
  model: string;
  prompt: string;
  duration: number;
  aspectRatio: "9:16";
  resolution: string;
  /** Product photo used as the first frame (image-to-video). */
  firstFrameUrl?: string | null;
  fetchImpl?: typeof fetch;
}

export type VideoJobStatus = "pending" | "in_progress" | "completed" | "failed";

export interface VideoJob {
  id: string;
  status: VideoJobStatus;
  generationId: string | null;
  costUsd: number | null;
  error: string | null;
}

interface RawVideoJob {
  id: string;
  status: VideoJobStatus;
  generation_id?: string | null;
  usage?: { cost?: number | null } | null;
  error?: string | { message?: string } | null;
}

const toJob = (r: RawVideoJob): VideoJob => ({
  id: r.id,
  status: r.status,
  generationId: r.generation_id ?? null,
  costUsd: r.usage?.cost ?? null,
  error: typeof r.error === "string" ? r.error : (r.error?.message ?? null),
});

/**
 * `POST /videos` — submits a job (202 + id). Never retried: a duplicate submit is a second bill.
 * Audio is off: narration and music are added in Remotion.
 */
export async function submitVideo(input: VideoInput): Promise<VideoJob> {
  const body: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
    duration: input.duration,
    aspect_ratio: input.aspectRatio,
    resolution: input.resolution,
    generate_audio: false,
  };
  if (input.firstFrameUrl) body.frame_images = [{ type: "image_url", image_url: { url: input.firstFrameUrl }, frame_type: "first_frame" }];
  return toJob(await request<RawVideoJob>("/videos", { method: "POST", body, retry: false, timeoutMs: 60_000, fetchImpl: input.fetchImpl }));
}

/** `GET /videos/{id}` — job status; `usage.cost` once completed. */
export async function getVideoJob(id: string, opts?: Pick<RequestOptions, "fetchImpl">): Promise<VideoJob> {
  if (!/^[\w-]{1,200}$/.test(id)) throw new OpenRouterError("รหัสงานวิดีโอไม่ถูกต้อง");
  return toJob(await request<RawVideoJob>(`/videos/${id}`, { ...opts, timeoutMs: 20_000, inBodyErrors: false }));
}

/** `GET /videos/{id}/content?index=0` — the finished MP4 (needs the key). */
export async function downloadVideo(id: string, opts?: { fetchImpl?: typeof fetch; maxBytes?: number }): Promise<Buffer> {
  if (!/^[\w-]{1,200}$/.test(id)) throw new OpenRouterError("รหัสงานวิดีโอไม่ถูกต้อง");
  const key = openRouterKey();
  if (!key) throw new OpenRouterError("ยังไม่ได้ตั้งค่า OPENROUTER_API_KEY ใน .env.local");
  const res = await (opts?.fetchImpl ?? fetch)(`${base()}/videos/${id}/content?index=0`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new OpenRouterError(errorMessage(res.status), res.status, isRetryable(res.status));
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > (opts?.maxBytes ?? 200 * 1024 * 1024)) throw new OpenRouterError("ไฟล์วิดีโอใหญ่เกินกำหนด");
  return buf;
}

/** The supported duration closest to what the scene wants (models accept only listed values). */
export function nearestDuration(wanted: number, supported: number[]): number {
  if (!supported.length) return wanted;
  return supported.reduce((best, d) => (Math.abs(d - wanted) < Math.abs(best - wanted) || (Math.abs(d - wanted) === Math.abs(best - wanted) && d < best) ? d : best));
}

/** USD for one clip from catalog prices (per second + per input image); null when priced by token. */
export function estimateVideoUsd(pricing: Record<string, string>, seconds: number, withImage: boolean): number | null {
  const perSecond = videoPricePerSecond(pricing);
  if (perSecond === null) return null;
  const imageKey = Object.keys(pricing).find((k) => /image_input/.test(k));
  const image = withImage && imageKey ? Number(pricing[imageKey]) / (imageKey.startsWith("cents_") ? 100 : 1) : 0;
  return perSecond * seconds + (Number.isFinite(image) ? image : 0);
}

// ---------------------------------------------------------------------------
// Speech (TTS) — https://openrouter.ai/docs/guides/overview/multimodal/tts
// ---------------------------------------------------------------------------

export interface SpeechModel {
  id: string;
  name: string;
  /**
   * As listed under `pricing`: most models charge `prompt` per input character; Gemini TTS
   * charges per token (`prompt` text tokens, `completion` audio tokens); a few charge
   * `completion` per second of audio.
   */
  prompt: number;
  completion: number;
}

/** Speech-output models (`GET /models?output_modalities=speech`, public). */
export async function listSpeechModels(opts?: Pick<RequestOptions, "fetchImpl">): Promise<SpeechModel[]> {
  const { data } = await request<{ data: RawTextModel[] }>("/models?output_modalities=speech", { ...opts, auth: false, timeoutMs: 15_000 });
  return data.map((m) => ({ id: m.id, name: m.name, prompt: Number(m.pricing.prompt), completion: Number(m.pricing.completion) }));
}

export interface SpeechInput {
  model: string;
  text: string;
  /** Omitted when the model has a default voice. */
  voice?: string | null;
  /** Delivery directions (tone, pace); models that don't support them ignore them. */
  instructions?: string | null;
  fetchImpl?: typeof fetch;
}

export interface SpeechResult {
  /** MP3 bytes. */
  audio: Buffer;
  generationId: string | null;
}

const MAX_SPEECH_BYTES = 20 * 1024 * 1024;

/** Providers that only return raw PCM; converted to MP3 here (Gemini TTS refuses "mp3"). */
const PCM_ONLY = ["google/"];

/**
 * `POST /audio/speech` — the body is the audio itself. MP3 is asked for, except from providers
 * that only send raw PCM, which is converted to MP3 with ffmpeg. Never retried: each call is
 * billed. Errors come back as JSON.
 */
export async function speak(input: SpeechInput): Promise<SpeechResult> {
  const key = openRouterKey();
  if (!key) throw new OpenRouterError("ยังไม่ได้ตั้งค่า OPENROUTER_API_KEY ใน .env.local");
  const pcm = PCM_ONLY.some((p) => input.model.startsWith(p));
  const body: Record<string, unknown> = { model: input.model, input: input.text, response_format: pcm ? "pcm" : "mp3" };
  if (input.voice) body.voice = input.voice;
  if (input.instructions) body.instructions = input.instructions;
  let res: Response;
  try {
    res = await (input.fetchImpl ?? fetch)(`${base()}/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Sales Automation" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    const timedOut = e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new OpenRouterError(timedOut ? errorMessage(408) : "เชื่อมต่อ OpenRouter ไม่ได้ — ตรวจอินเทอร์เน็ต", null, true);
  }
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || type.includes("json")) {
    let detail: string | undefined;
    try {
      detail = ((await res.json()) as { error?: { message?: string } })?.error?.message;
    } catch {
      // not JSON
    }
    const status = res.ok ? 500 : res.status;
    throw new OpenRouterError(errorMessage(status, detail), status, isRetryable(status));
  }
  if (!type.startsWith("audio/mpeg") && !type.startsWith("audio/pcm")) throw new OpenRouterError(`OpenRouter ส่งเสียงกลับมาเป็นชนิดที่ไม่รองรับ (${type || "ไม่ทราบชนิด"})`);
  const raw = Buffer.from(await res.arrayBuffer());
  if (!raw.length) throw new OpenRouterError("OpenRouter ส่งไฟล์เสียงว่างกลับมา");
  if (raw.length > MAX_SPEECH_BYTES) throw new OpenRouterError("ไฟล์เสียงใหญ่เกินกำหนด");
  const generationId = res.headers.get("x-generation-id");
  if (type.startsWith("audio/mpeg")) return { audio: raw, generationId };
  // Imported here so the Next.js side never loads child_process for the other calls.
  const { pcmFormat, pcmToMp3 } = await import("./pcm");
  try {
    return { audio: await pcmToMp3(raw, pcmFormat(type)), generationId };
  } catch (e) {
    throw new OpenRouterError(`แปลงเสียงจาก OpenRouter เป็น MP3 ไม่สำเร็จ (ต้องติดตั้ง FFmpeg หรือตั้ง FFMPEG_PATH): ${(e as Error).message}`);
  }
}

/**
 * `GET /generation?id=` — the billed cost of a finished generation, USD. Null while OpenRouter
 * hasn't recorded it yet (it can take a few seconds) or when the lookup fails.
 */
export async function getGenerationCost(id: string, opts?: Pick<RequestOptions, "fetchImpl">): Promise<number | null> {
  if (!/^[\w-]{1,200}$/.test(id)) return null;
  try {
    const { data } = await request<{ data: { total_cost?: number | null } }>(`/generation?id=${id}`, { ...opts, timeoutMs: 10_000, retry: false });
    return typeof data?.total_cost === "number" ? data.total_cost : null;
  } catch {
    return null;
  }
}
