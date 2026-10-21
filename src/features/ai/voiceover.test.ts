import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTimeline } from "@/features/video/timeline";
import { sceneSecondsFor } from "../../../worker/voiceover";
import { getGenerationCost, listSpeechModels, speak } from "./openrouter";
import { estimateSpeechUsd, estimateVoiceoverUsd, speechPriceLabel, speechText, VOICE_PAD_S, voiceFor } from "./voiceover";
import { speechCacheKey, speechStorageKey } from "./voiceover-key";

const gemini = { id: "google/gemini-3.8-flash-tts", prompt: 0.0000005, completion: 0.000009 };
const eleven = { id: "elevenlabs/eleven-v4", prompt: 0.00008, completion: 0 };
const seed = { id: "bytedance-seed/seed-audio-1-0", prompt: 0, completion: 0.0025 };
const free = { id: "fish-audio/s2.1-pro-free:free", prompt: 0, completion: 0 };

describe("voice-over pricing and voices", () => {
  it("estimates per character, per audio token (Gemini) or per second", () => {
    expect(estimateSpeechUsd(eleven, 100, 6)).toBeCloseTo(0.008);
    expect(estimateSpeechUsd(gemini, 100, 10)).toBeCloseTo(0.00005 + 0.000009 * 32 * 10);
    expect(estimateSpeechUsd(seed, 100, 10)).toBeCloseTo(0.025);
    expect(estimateSpeechUsd(free, 100, 10)).toBe(0);
    expect(estimateSpeechUsd(undefined, 100, 10)).toBeCloseTo(0.01);
    // A 30-second script on Gemini stays well under one baht.
    expect(estimateVoiceoverUsd(gemini, ["หูฟังตัวนี้เบสแน่น ใส่สบาย", "  ", "กันน้ำ IP55 ใส่ออกกำลังกายได้"]) * 35).toBeLessThan(1);
  });

  it("labels prices the way each model is billed", () => {
    expect(speechPriceLabel(free)).toBe("ฟรี");
    expect(speechPriceLabel(eleven)).toBe("$80 ต่อล้านตัวอักษร");
    expect(speechPriceLabel(gemini)).toBe("$0.5 / $9 ต่อล้าน token");
    expect(speechPriceLabel(seed)).toBe("$0.0025/วินาที");
  });

  it("picks a default voice only where one is needed", () => {
    expect(voiceFor(gemini.id, null)).toBe("Puck");
    expect(voiceFor(eleven.id, null)).toBe("21m00Tcm4TlvDq8ikWAM");
    expect(voiceFor(gemini.id, "Puck")).toBe("Puck");
    expect(voiceFor(free.id, null)).toBeNull();
    expect(speechText("  หูฟัง \n ดี  ")).toBe("หูฟัง ดี");
  });

  it("caches by model, voice, delivery and text", () => {
    const k = { model: gemini.id, voice: "Kore", instructions: "warm", text: "สวัสดี" };
    expect(speechCacheKey(k)).toMatch(/^[0-9a-f]{64}$/);
    expect(speechCacheKey(k)).toBe(speechCacheKey({ ...k }));
    for (const change of [{ voice: "Puck" }, { instructions: null }, { text: "สวัสดีค่ะ" }, { model: eleven.id }]) expect(speechCacheKey({ ...k, ...change })).not.toBe(speechCacheKey(k));
    expect(speechStorageKey("11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222")).toBe("11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/voice.mp3");
  });
});

describe("speech client", () => {
  beforeEach(() => vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test"));
  afterEach(() => vi.unstubAllEnvs());

  it("asks for MP3 with voice and delivery, returns the bytes and generation id; never retries", async () => {
    const ok = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg", "X-Generation-Id": "gen-tts-1" } }));
    const r = await speak({ model: eleven.id, text: "สวัสดี", voice: "Rachel", instructions: "warm", fetchImpl: ok });
    expect([...r.audio]).toEqual([1, 2, 3]);
    expect(r.generationId).toBe("gen-tts-1");
    expect(String(ok.mock.calls[0][0])).toMatch(/\/audio\/speech$/);
    expect(JSON.parse(ok.mock.calls[0][1]!.body as string)).toEqual({ model: eleven.id, input: "สวัสดี", voice: "Rachel", instructions: "warm", response_format: "mp3" });

    const noVoice = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1]), { headers: { "Content-Type": "audio/mpeg" } }));
    await speak({ model: free.id, text: "x", fetchImpl: noVoice });
    expect(JSON.parse(noVoice.mock.calls[0][1]!.body as string)).toEqual({ model: free.id, input: "x", response_format: "mp3" });

    const broke = vi.fn<typeof fetch>(async () => Response.json({ error: { code: 402, message: "Insufficient credits" } }, { status: 402 }));
    await expect(speak({ model: gemini.id, text: "x", fetchImpl: broke })).rejects.toThrow(/เครดิต OpenRouter ไม่พอ.* · Insufficient credits/);
    expect(broke).toHaveBeenCalledTimes(1);
    const wrongType = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1]), { headers: { "Content-Type": "audio/wav" } }));
    await expect(speak({ model: eleven.id, text: "x", fetchImpl: wrongType })).rejects.toThrow(/audio\/wav/);
  });

  it("asks Gemini for PCM (it refuses mp3); the worker converts it to MP3 at the rate the header gives", async () => {
    // 0.5 s of silence, 16-bit mono at 24 kHz.
    const pcm = Buffer.alloc(24_000);
    const res = vi.fn<typeof fetch>(async () => new Response(pcm, { headers: { "Content-Type": "audio/pcm;rate=24000;channels=1" } }));
    const r = await speak({ model: gemini.id, text: "สวัสดี", voice: "Kore", fetchImpl: res });
    expect(JSON.parse(res.mock.calls[0][1]!.body as string)).toMatchObject({ response_format: "pcm" });
    expect(r.contentType).toBe("audio/pcm;rate=24000;channels=1");
    const { pcmFormat, speechToMp3 } = await import("./pcm");
    const mp3 = await speechToMp3(r.audio, r.contentType);
    // An MP3 stream: ID3 tag or an MPEG frame sync.
    expect(mp3.subarray(0, 3).toString() === "ID3" || (mp3[0] === 0xff && (mp3[1] & 0xe0) === 0xe0)).toBe(true);
    expect(await speechToMp3(Buffer.from([1, 2]), "audio/mpeg")).toEqual(Buffer.from([1, 2]));
    expect(pcmFormat("audio/pcm;rate=44100;channels=2")).toEqual({ rate: 44100, channels: 2 });
    expect(pcmFormat("audio/pcm")).toEqual({ rate: 24000, channels: 1 });
  });

  it("lists speech models and looks up a generation's cost (null until recorded)", async () => {
    const list = vi.fn<typeof fetch>(async () => Response.json({ data: [{ id: gemini.id, name: "Gemini", pricing: { prompt: "0.0000005", completion: "0.000009" }, architecture: {} }] }));
    expect(await listSpeechModels({ fetchImpl: list })).toEqual([{ id: gemini.id, name: "Gemini", prompt: 0.0000005, completion: 0.000009 }]);
    expect(String(list.mock.calls[0][0])).toMatch(/\/models\?output_modalities=speech$/);
    expect(await getGenerationCost("gen-1", { fetchImpl: vi.fn<typeof fetch>(async () => Response.json({ data: { total_cost: 0.0012 } })) })).toBe(0.0012);
    expect(await getGenerationCost("gen-1", { fetchImpl: vi.fn<typeof fetch>(async () => Response.json({ error: { message: "not found" } }, { status: 404 })) })).toBeNull();
    expect(await getGenerationCost("../key")).toBeNull();
  });
});

describe("timeline with voice and music", () => {
  const input = {
    productName: "หูฟัง",
    imageSrc: null,
    hook: "",
    cta: "",
    disclosure: "#ได้รับค่าคอมมิชชัน",
    scenes: [
      { id: "a", kind: "intro", narration: "ประโยคยาวมากมากมากมากมากมากมากมากมากมาก", on_screen_text: "", audio: "http://x/a.mp3", audioSeconds: sceneSecondsFor({ storageKey: "k", seconds: 1 }) },
      { id: "b", kind: "feature", narration: "สั้น", on_screen_text: "", audio: "http://x/b.mp3", audioSeconds: sceneSecondsFor({ storageKey: "k", seconds: 4 }) },
    ],
    music: { src: "http://x/m.mp3", volume: 0.12 },
  };
  it("each scene lasts as long as its line (plus a pause, at least 2 s) and carries its audio", () => {
    const t = buildTimeline(input);
    expect(t.scenes.map((s) => s.duration)).toEqual([60, Math.round((4 + VOICE_PAD_S) * 30)]);
    expect(t.scenes.map((s) => s.audio)).toEqual(["http://x/a.mp3", "http://x/b.mp3"]);
    expect(t.music).toEqual({ src: "http://x/m.mp3", volume: 0.12 });
    expect(buildTimeline({ ...input, music: undefined, scenes: [{ ...input.scenes[0], audio: undefined }] })).toMatchObject({ music: null, scenes: [{ audio: null }] });
  });
});
