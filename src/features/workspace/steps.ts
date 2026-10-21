/**
 * The video workspace's steps and what to do next, from the state of one video. Pure, so the
 * page, the next-step bar and the tests agree.
 */

export const STEPS = [
  { id: "product", label: "สินค้า & รูป" },
  { id: "settings", label: "ตั้งค่าวิดีโอนี้" },
  { id: "facts", label: "ข้อเท็จจริง" },
  { id: "script", label: "สคริปต์ & ภาพต่อฉาก" },
  { id: "render", label: "Render & เผยแพร่" },
] as const;
export type StepId = (typeof STEPS)[number]["id"];

export type StepState = "done" | "todo" | "attention" | "optional";

export interface WorkspaceState {
  hasImage: boolean;
  /** Product facts the user added or confirmed. */
  factsUsable: number;
  /** Facts the AI pulled that wait for confirmation. */
  factsPending: number;
  approved: boolean;
  /** Approval blockers in the script (unchecked claims, placeholders, …). */
  blocks: number;
  aiScenes: number;
  aiScenesReady: number;
  /** A clip is queued or generating. */
  clipsGenerating: boolean;
  render: "none" | "active" | "failed" | "done";
  published: number;
}

export interface StepStatus {
  state: StepState;
  note: string;
}

export function stepStatuses(s: WorkspaceState): Record<StepId, StepStatus> {
  return {
    product: s.hasImage ? { state: "done", note: "มีรูปหลัก" } : { state: "attention", note: "ยังไม่มีรูปหลัก — คลิป AI แบบสินค้าเคลื่อนไหวต้องใช้" },
    settings: { state: "optional", note: "ค่าเริ่มต้นจากหน้าตั้งค่า" },
    facts: s.factsPending
      ? { state: "attention", note: `รอยืนยัน ${s.factsPending} ข้อ` }
      : s.factsUsable
        ? { state: "done", note: `${s.factsUsable} ข้อ` }
        : { state: "todo", note: "ยังไม่มี — สคริปต์จะอ้างอะไรไม่ได้" },
    script: s.approved
      ? s.aiScenes > s.aiScenesReady
        ? { state: "attention", note: `คลิป AI อนุมัติแล้ว ${s.aiScenesReady}/${s.aiScenes} ฉาก` }
        : { state: "done", note: s.aiScenes ? `อนุมัติแล้ว · คลิป AI ${s.aiScenes} ฉาก` : "อนุมัติแล้ว" }
      : { state: s.blocks ? "attention" : "todo", note: s.blocks ? `ต้องแก้ ${s.blocks} รายการก่อนอนุมัติ` : "พร้อมอนุมัติ" },
    render:
      s.render === "done"
        ? { state: "done", note: s.published ? `เผยแพร่แล้ว ${s.published} แพลตฟอร์ม` : "render แล้ว — เตรียมเผยแพร่ได้" }
        : s.render === "active"
          ? { state: "todo", note: "กำลัง render" }
          : s.render === "failed"
            ? { state: "attention", note: "render ล่าสุดล้มเหลว" }
            : { state: "todo", note: s.approved ? "ยังไม่ได้ render" : "รออนุมัติสคริปต์" },
  };
}

/** The one thing to do next, and where on the page it is. */
export function nextStep(s: WorkspaceState): { step: StepId; text: string } {
  if (s.factsPending) return { step: "facts", text: `ยืนยันข้อเท็จจริงที่ AI ดึงมา ${s.factsPending} ข้อ` };
  if (!s.factsUsable) return { step: "facts", text: "เพิ่มข้อเท็จจริงของสินค้า (ให้ AI ดึงจากคำอธิบายได้)" };
  if (!s.approved) return { step: "script", text: s.blocks ? `ตรวจสคริปต์ — ต้องแก้ ${s.blocks} รายการก่อนอนุมัติ` : "อนุมัติสคริปต์" };
  if (s.clipsGenerating) return { step: "script", text: "รอคลิป AI สร้างเสร็จ แล้วตรวจ/อนุมัติ" };
  if (s.aiScenes > s.aiScenesReady) return { step: "script", text: `สร้างหรืออนุมัติคลิป AI อีก ${s.aiScenes - s.aiScenesReady} ฉาก` };
  if (s.render === "active") return { step: "render", text: "กำลัง render — เปิด npm run worker ไว้" };
  if (s.render === "none" || s.render === "failed") return { step: "render", text: s.render === "failed" ? "render ใหม่ (ครั้งก่อนล้มเหลว)" : "Render วิดีโอ" };
  if (!s.published) return { step: "render", text: "เตรียมเผยแพร่ แล้วโพสต์" };
  return { step: "render", text: "เสร็จแล้ว — บันทึกผลโพสต์ได้ในหน้า Analytics" };
}
