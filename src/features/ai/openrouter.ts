/**
 * OpenRouter client (docs/AI_VIDEO_PLAN.md AI-1). One key for text, video and speech models.
 * Server and worker only: the key comes from OPENROUTER_API_KEY, which is never NEXT_PUBLIC_, so
 * it can't reach a browser bundle. Errors are Thai messages safe to show the user (no key, no
 * raw response body).
 */

const BASE = "https://openrouter.ai/api/v1";
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
  fetchImpl?: typeof fetch;
}

async function request<T>(path: string, { method = "GET", body, auth = true, timeoutMs = DEFAULT_TIMEOUT_MS, retry = true, fetchImpl = fetch }: RequestOptions = {}): Promise<T> {
  const key = openRouterKey();
  if (auth && !key) throw new OpenRouterError("ยังไม่ได้ตั้งค่า OPENROUTER_API_KEY ใน .env.local");
  const headers: Record<string, string> = { "X-Title": "Sales Automation" };
  if (key) headers.Authorization = `Bearer ${key}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  for (let attempt = 0; ; attempt++) {
    let error: OpenRouterError;
    try {
      const res = await fetchImpl(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text.trim() ? JSON.parse(text) : null;
      } catch {
        // Non-JSON body (e.g. an HTML error page): fall through to the status check.
      }
      // OpenRouter can also report a failure inside a 200 body.
      const apiError = (json as { error?: { code?: number; message?: string } } | null)?.error;
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
