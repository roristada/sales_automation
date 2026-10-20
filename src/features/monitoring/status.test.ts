import { describe, expect, it } from "vitest";
import { ago, formatBytes, workerState } from "./status";

describe("workerState", () => {
  it("tells busy, idle and stopped apart", () => {
    expect(workerState(null)).toBe("unknown");
    expect(workerState({ online: 0, busy: 0, lastSeen: null })).toBe("offline");
    expect(workerState({ online: 0, busy: 0, lastSeen: "2026-10-21T00:00:00Z" })).toBe("offline");
    expect(workerState({ online: 1, busy: 0, lastSeen: "2026-10-21T00:00:00Z" })).toBe("online");
    expect(workerState({ online: 1, busy: 1, lastSeen: "2026-10-21T00:00:00Z" })).toBe("busy");
    expect(workerState({ online: 2, busy: 1, lastSeen: "2026-10-21T00:00:00Z" })).toBe("online");
  });
});

describe("formatting", () => {
  it("formats bytes and ages", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(250 * 1024 ** 3)).toBe("250 GB");
    const now = Date.parse("2026-10-21T12:00:00Z");
    expect(ago("2026-10-21T11:59:30Z", now)).toBe("30 วินาทีที่แล้ว");
    expect(ago("2026-10-21T09:00:00Z", now)).toBe("3 ชั่วโมงที่แล้ว");
    expect(ago("2026-10-22T00:00:00Z", now)).toBeNull();
  });
});
