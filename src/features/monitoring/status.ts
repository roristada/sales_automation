/*
 * System health shown in Settings → สถานะระบบ and /api/health (PLAN.md M8). Pure helpers here;
 * the queries live in queries.ts so tests don't need a database.
 */

export interface WorkerStatus {
  online: number;
  busy: number;
  lastSeen: string | null;
}

export type WorkerState = "online" | "busy" | "offline" | "unknown";

export function workerState(s: WorkerStatus | null): WorkerState {
  if (!s) return "unknown";
  // A worker that stops cleanly removes its row, so "never started" can't be told apart.
  if (s.online === 0) return "offline";
  return s.busy >= s.online ? "busy" : "online";
}

export const WORKER_STATE_LABEL: Record<WorkerState, string> = {
  online: "ทำงานอยู่ · ว่าง",
  busy: "ทำงานอยู่ · กำลัง render",
  offline: "ไม่ได้เปิด",
  unknown: "ตรวจสอบไม่ได้",
};

/** Below this, renders (a few MB each) and uploads may start failing. */
export const LOW_DISK_BYTES = 2 * 1024 ** 3;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n;
  let i = -1;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < units.length - 1);
  return `${v.toLocaleString("en-US", { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[i]}`;
}

/** "5 นาทีที่แล้ว" style age; null for future/invalid times. */
export function ago(iso: string, now = Date.now()): string | null {
  const s = Math.floor((now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s) || s < 0) return null;
  if (s < 60) return `${s} วินาทีที่แล้ว`;
  if (s < 3600) return `${Math.floor(s / 60)} นาทีที่แล้ว`;
  if (s < 86_400) return `${Math.floor(s / 3600)} ชั่วโมงที่แล้ว`;
  return `${Math.floor(s / 86_400)} วันที่แล้ว`;
}
