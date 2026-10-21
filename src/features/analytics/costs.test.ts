import { describe, expect, it } from "vitest";
import { batchBudgetLeft, runnableItems } from "@/features/content/batch";
import { videoCosts } from "./costs";

describe("cost per video (AI-6)", () => {
  it("splits AI calls by kind per project, adds renders, keeps untied calls out", () => {
    const projectOf = new Map([
      ["sb1", "p1"],
      ["sb1v2", "p1"],
      ["sb2", "p2"],
    ]);
    const { byProject, untied } = videoCosts(
      [
        { storyboardId: "sb1", task: "script", costThb: 0.02, status: "succeeded" },
        { storyboardId: "sb1v2", task: "video_product", costThb: 14.7, status: "succeeded" },
        { storyboardId: "sb1v2", task: "video_product", costThb: 0, status: "failed" },
        { storyboardId: "sb1", task: "tts", costThb: 0.3, status: "succeeded" },
        { storyboardId: null, task: "extract", costThb: 0.05, status: "succeeded" },
        { storyboardId: "gone", task: "script", costThb: 0.01, status: "succeeded" },
      ],
      projectOf,
      new Map([
        ["p1", 0.5],
        ["p3", 1],
      ]),
    );
    expect(byProject.get("p1")).toEqual({ projectId: "p1", text: 0.02, clips: 14.7, voice: 0.3, render: 0.5, total: 15.52, calls: 4, failedCalls: 1 });
    expect(byProject.get("p3")).toMatchObject({ render: 1, total: 1, calls: 0 });
    expect(byProject.has("p2")).toBe(false);
    expect(untied).toBe(0.06);
  });
});

describe("batches (AI-6)", () => {
  it("tracks the AI budget left", () => {
    expect(batchBudgetLeft(null, [1, 2])).toBeNull();
    expect(batchBudgetLeft(5, [0.02, 0.03])).toBe(4.95);
    expect(batchBudgetLeft(0.04, [0.02, 0.03])).toBeLessThan(0);
  });

  it("runs not-started items, AI-pending drafts, and failed ones only when retrying", () => {
    const items = [
      { id: "a", status: "pending", error: null },
      { id: "b", status: "drafted", error: null },
      { id: "c", status: "drafted", error: "งบ AI ของชุดนี้หมดแล้ว" },
      { id: "d", status: "written", error: null },
      { id: "e", status: "failed", error: "x" },
      { id: "f", status: "working", error: null },
    ];
    expect(runnableItems(items, true, false).map((i) => i.id)).toEqual(["a", "b"]);
    expect(runnableItems(items, false, false).map((i) => i.id)).toEqual(["a"]);
    expect(runnableItems(items, true, true).map((i) => i.id)).toEqual(["a", "b", "e"]);
  });
});
