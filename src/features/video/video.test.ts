import { describe, expect, it } from "vitest";
import { checkBudget, estimateRenderCost } from "@/features/usage/budget";
import { probeFacts, qaReport } from "./qa";
import { buildTimeline, resolveTransition, splitSubtitle, SUBTITLE_MAX_CHARS, toSrt, toVtt } from "./timeline";

const input = {
  productName: "พัดลมพกพา",
  imageSrc: null,
  hook: "3 จุดเด่นของพัดลมพกพา",
  cta: "ดูรายละเอียดได้ที่ลิงก์ในคลิป",
  disclosure: "#ได้รับค่าคอมมิชชัน",
  scenes: [
    { id: "a", kind: "feature", narration: "ความเร็วลมปรับได้ 3 ระดับ เหมาะกับอากาศร้อนในเมืองไทยมากๆ ใช้ได้ทั้งวัน", on_screen_text: "ลม 3 ระดับ" },
    { id: "b", kind: "cta", narration: "", on_screen_text: "ลิงก์ในคลิป" },
  ],
};

describe("splitSubtitle", () => {
  it("splits Thai on word boundaries within the line limit", () => {
    const lines = splitSubtitle(input.scenes[0].narration);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(SUBTITLE_MAX_CHARS);
    expect(lines.join("").replace(/\s/g, "")).toBe(input.scenes[0].narration.replace(/\s/g, ""));
    // no Thai word cut in half: "อากาศ" stays whole
    expect(lines.some((l) => l.includes("อากาศ"))).toBe(true);
  });
  it("hard-wraps a single overlong token and ignores empty text", () => {
    expect(splitSubtitle("a".repeat(60), 26).map((l) => l.length)).toEqual([26, 26, 8]);
    expect(splitSubtitle("   ")).toEqual([]);
  });
});

describe("buildTimeline", () => {
  const t = buildTimeline(input);
  it("lays scenes back to back, then the end card", () => {
    expect(t.scenes[0].from).toBe(0);
    expect(t.scenes[1].from).toBe(t.scenes[0].duration);
    expect(t.scenes[1].duration).toBe(60); // empty narration → 2 s minimum
    expect(t.endCard.from).toBe(t.scenes[0].duration + 60);
    expect(t.durationInFrames).toBe(t.endCard.from + t.endCard.duration);
    expect([t.width, t.height, t.fps]).toEqual([1080, 1920, 30]);
  });
  it("covers each scene's narration with contiguous cues", () => {
    const cues = t.cues.filter((c) => c.from < t.scenes[0].duration);
    expect(cues[0].from).toBe(0);
    for (let i = 1; i < cues.length; i++) expect(cues[i].from).toBe(cues[i - 1].from + cues[i - 1].duration);
    const last = cues.at(-1)!;
    expect(last.from + last.duration).toBe(t.scenes[0].duration);
  });
  it("uses measured audio length when given", () => {
    const withAudio = buildTimeline({ ...input, scenes: [{ ...input.scenes[0], audioSeconds: 7 }] });
    expect(withAudio.scenes[0].duration).toBe(210);
  });
  it("writes SRT/VTT of the spoken lines (the disclosure goes in the caption, not the video)", () => {
    const srt = toSrt(t);
    expect(srt).not.toContain("#ได้รับค่าคอมมิชชัน");
    expect(srt.startsWith("1\n00:00:00,000 --> ")).toBe(true);
    expect(toVtt(t).startsWith("WEBVTT\n\n00:00:00.000 --> ")).toBe(true);
  });
});

describe("QA", () => {
  const probe = {
    streams: [
      { codec_type: "video", codec_name: "h264", width: 1080, height: 1920, avg_frame_rate: "30/1" },
      { codec_type: "audio", codec_name: "aac" },
    ],
    format: { duration: "12.03", size: "1048576" },
  };
  it("passes a correct render", () => {
    const facts = probeFacts(probe);
    expect(facts).toEqual({ width: 1080, height: 1920, fps: 30, videoCodec: "h264", audioCodec: "aac", durationS: 12.03, sizeBytes: 1048576 });
    expect(qaReport(facts, { width: 1080, height: 1920, fps: 30, durationS: 12 }).ok).toBe(true);
  });
  it("fails on missing audio or wrong size, but not on warnings", () => {
    const facts = probeFacts({ ...probe, streams: [{ ...probe.streams[0], width: 720 }] });
    const r = qaReport(facts, { width: 1080, height: 1920, fps: 30, durationS: 12 }, [{ key: "image", label: "รูป", ok: false, detail: "", level: "warn" }]);
    expect(r.ok).toBe(false);
    expect(r.checks.filter((c) => !c.ok).map((c) => c.key)).toEqual(["resolution", "audio_codec", "image"]);
  });
});

describe("budget", () => {
  it("never blocks free work", () => {
    expect(checkBudget({ daily_thb: 0, monthly_thb: 0 }, { today_thb: 5, month_thb: 5 }, 0)).toEqual({ ok: true });
  });
  it("blocks paid work that would pass a cap, with a message", () => {
    const r = checkBudget({ daily_thb: 10, monthly_thb: 100 }, { today_thb: 9.5, month_thb: 20 }, 1);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/เกินงบรายวัน ฿10\.00/);
    expect(checkBudget({ daily_thb: null, monthly_thb: 100 }, { today_thb: 99, month_thb: 99.5 }, 1).ok).toBe(false);
    expect(checkBudget({ daily_thb: 10, monthly_thb: 100 }, { today_thb: 0, month_thb: 0 }, 1).ok).toBe(true);
    expect(checkBudget(null, { today_thb: 1e6, month_thb: 1e6 }, 1).ok).toBe(true);
  });
  it("estimates render cost from the per-second rate", () => {
    expect(estimateRenderCost(20, 0)).toBe(0);
    expect(estimateRenderCost(20, 0.05)).toBe(1);
  });
});

describe("timeline media", () => {
  it("carries scene media through", () => {
    const t = buildTimeline({ ...input, scenes: [{ ...input.scenes[0], media: { kind: "video", src: "x.mp4", durationS: 1 } }] });
    expect(t.scenes[0].media).toEqual({ kind: "video", src: "x.mp4", durationS: 1 });
    expect(buildTimeline(input).scenes[0].media).toBeNull();
  });
});

describe("SSRF guard", () => {
  it("allows only public addresses", async () => {
    const { isPublicAddress } = await import("./safe-fetch");
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) expect(isPublicAddress(ip)).toBe(true);
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "not-an-ip"]) {
      expect(isPublicAddress(ip)).toBe(false);
    }
  });
  it("refuses loopback and private targets before connecting", async () => {
    const { fetchPublic } = await import("./safe-fetch");
    for (const url of ["http://127.0.0.1:55321/rest/v1/", "http://localhost:3000/", "http://[::1]/", "http://169.254.169.254/latest/meta-data/", "file:///etc/passwd"]) {
      await expect(fetchPublic(url, { timeoutMs: 2000, maxBytes: 1000 })).rejects.toThrow();
    }
  });
});

describe("template layout", () => {
  it("shrinks long on-screen text so it stays inside its zone", async () => {
    const { fitFontSize, textWidth, ZONES, TEXT_WIDTH } = await import("./layout");
    const opts = { maxWidth: TEXT_WIDTH, maxHeight: ZONES.text.height, sizes: [72, 62, 54, 46, 40], padding: 28 };
    expect(fitFontSize("ลิงก์ในคลิป", opts)).toBe(72);
    // The overlapping case from a real render: a 60-character Thai line.
    const long = "ดีไซน์ Open-Ear แบบคลิปออน: หูฟังไร้สายแบบเปิดหู (Open-Ear) หนีบใบหู";
    const size = fitFontSize(long, opts);
    expect(size).toBeLessThan(72);
    const lines = Math.ceil(textWidth(long, size) / (TEXT_WIDTH - 28));
    expect(lines * size * 1.3 + 28).toBeLessThanOrEqual(ZONES.text.height);
    // Text zone ends above the subtitle zone (bottom-anchored, ~100px tall).
    expect(ZONES.text.top + ZONES.text.height).toBeLessThan(1920 - ZONES.subtitle.bottom - 100);
    expect(ZONES.card.top + ZONES.card.size).toBeLessThan(ZONES.text.top);
  });

  it("splits spec callouts and ignores Thai marks when measuring", async () => {
    const { splitLabel, textWidth } = await import("./layout");
    expect(splitLabel("กันน้ำ: IP55")).toEqual({ label: "กันน้ำ", value: "IP55" });
    expect(splitLabel("ลิงก์ในคลิป")).toBeNull();
    expect(textWidth("ที่", 100)).toBe(textWidth("ท", 100));
  });
});

describe("timeline photos and badges", () => {
  it("cycles product photos through scenes without media and numbers features", () => {
    const t = buildTimeline({
      productName: "x",
      imageSrc: "main.jpg",
      gallery: ["g1.jpg", "g2.jpg"],
      hook: "",
      cta: "",
      disclosure: "d",
      scenes: [
        { id: "a", kind: "intro", narration: "หนึ่ง", on_screen_text: "" },
        { id: "b", kind: "feature", narration: "สอง", on_screen_text: "", media: { kind: "video", src: "clip", durationS: 3 } },
        { id: "c", kind: "feature", narration: "สาม", on_screen_text: "" },
        { id: "d", kind: "price", narration: "สี่", on_screen_text: "฿99" },
        { id: "e", kind: "cta", narration: "ห้า", on_screen_text: "" },
      ],
    });
    expect(t.images).toEqual(["main.jpg", "g1.jpg", "g2.jpg"]);
    expect(t.scenes.map((s) => s.image)).toEqual(["main.jpg", null, "g1.jpg", "g2.jpg", "main.jpg"]);
    expect(t.scenes.map((s) => s.badge)).toEqual([null, "จุดเด่น 1", "จุดเด่น 2", "ราคา", null]);
    expect(buildTimeline({ productName: "x", imageSrc: null, hook: "", cta: "", disclosure: "d", scenes: [{ id: "a", kind: "intro", narration: "ก", on_screen_text: "" }] }).scenes[0].image).toBeNull();
  });
});

describe("transitions", () => {
  it("first scene cuts in; auto and unknown values crossfade; chosen ones are kept", () => {
    expect(resolveTransition("slide", 0)).toBe("cut");
    expect(resolveTransition("auto", 1)).toBe("fade");
    expect(resolveTransition(null, 2)).toBe("fade");
    expect(resolveTransition("explode", 1)).toBe("fade");
    for (const t of ["cut", "fade", "slide", "zoom"] as const) expect(resolveTransition(t, 3)).toBe(t);
  });
  it("timeline carries each scene's transition without changing its timing", () => {
    const scenes = ["intro", "feature", "cta"].map((kind, i) => ({ id: String(i), kind, narration: "หูฟังตัวนี้ดี", on_screen_text: "", transition: ["zoom", "slide", "auto"][i] }));
    const t = buildTimeline({ productName: "x", imageSrc: null, hook: "", cta: "", disclosure: "d", scenes });
    expect(t.scenes.map((s) => s.transition)).toEqual(["cut", "slide", "fade"]);
    const plain = buildTimeline({ productName: "x", imageSrc: null, hook: "", cta: "", disclosure: "d", scenes: scenes.map((s) => ({ ...s, transition: undefined })) });
    expect(t.scenes.map((s) => [s.from, s.duration])).toEqual(plain.scenes.map((s) => [s.from, s.duration]));
  });
});
