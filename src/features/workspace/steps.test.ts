import { describe, expect, it } from "vitest";
import { nextStep, stepStatuses, type WorkspaceState } from "./steps";

const base: WorkspaceState = { hasImage: true, factsUsable: 2, factsPending: 0, approved: false, blocks: 0, aiScenes: 0, aiScenesReady: 0, clipsGenerating: false, render: "none", published: 0 };

describe("workspace steps", () => {
  it("names the one next thing, in flow order", () => {
    expect(nextStep({ ...base, factsPending: 2 })).toEqual({ step: "facts", text: "ยืนยันข้อเท็จจริงที่ AI ดึงมา 2 ข้อ" });
    expect(nextStep({ ...base, factsUsable: 0 }).step).toBe("facts");
    expect(nextStep({ ...base, blocks: 3 }).text).toBe("ตรวจสคริปต์ — ต้องแก้ 3 รายการก่อนอนุมัติ");
    expect(nextStep(base).text).toBe("อนุมัติสคริปต์");
    expect(nextStep({ ...base, approved: true, aiScenes: 2, aiScenesReady: 1 }).text).toBe("สร้างหรืออนุมัติคลิป AI อีก 1 ฉาก");
    expect(nextStep({ ...base, approved: true, aiScenes: 2, clipsGenerating: true }).text).toMatch(/รอคลิป AI/);
    expect(nextStep({ ...base, approved: true })).toEqual({ step: "render", text: "Render วิดีโอ" });
    expect(nextStep({ ...base, approved: true, render: "failed" }).text).toMatch(/ล้มเหลว/);
    expect(nextStep({ ...base, approved: true, render: "done" }).text).toBe("เตรียมเผยแพร่ แล้วโพสต์");
    expect(nextStep({ ...base, approved: true, render: "done", published: 1 }).text).toMatch(/Analytics/);
  });

  it("marks each step done, to do, or needing attention", () => {
    const s = stepStatuses({ ...base, hasImage: false, factsPending: 1, approved: true, aiScenes: 1 });
    expect(s.product.state).toBe("attention");
    expect(s.facts).toEqual({ state: "attention", note: "รอยืนยัน 1 ข้อ" });
    expect(s.script).toEqual({ state: "attention", note: "คลิป AI อนุมัติแล้ว 0/1 ฉาก" });
    expect(s.settings.state).toBe("optional");
    expect(stepStatuses({ ...base, approved: true, render: "done", published: 2 }).render).toEqual({ state: "done", note: "เผยแพร่แล้ว 2 แพลตฟอร์ม" });
  });
});
