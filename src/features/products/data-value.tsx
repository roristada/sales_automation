import { TrustBadge } from "@/components/shared/status-badge";
import { cn } from "@/lib/utils";
import type { DataStatus } from "./schema";

/**
 * A value with its data-trust label (design.md §10). Unavailable values render as "—"
 * plus the label, never as 0. User-entered values stay unlabelled in dense views
 * unless `alwaysTag` is set, to keep tables calm.
 */
export function DataValue({ value, status, alwaysTag = false }: { value: React.ReactNode; status: DataStatus; alwaysTag?: boolean }) {
  const missing = status === "unavailable";
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={cn(missing && "text-muted-foreground")}>{missing ? "—" : value}</span>
      {(alwaysTag || missing || status !== "user_provided") && <TrustBadge status={status} />}
    </span>
  );
}

const thb = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 2 });
export const formatTHB = (n: number | null) => (n === null ? "—" : thb.format(n));
export const formatPercent = (n: number | null) => (n === null ? "—" : `${n}%`);
export const formatDateTime = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(iso)) : "—";
export const formatDate = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" }).format(new Date(iso)) : "—";

/** "3 วันที่แล้ว" style relative age, for freshness columns. */
export function formatAge(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "ไม่ทราบ";
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "วันนี้";
  if (days === 1) return "เมื่อวาน";
  if (days < 30) return `${days} วันที่แล้ว`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months} เดือนที่แล้ว` : `${Math.floor(months / 12)} ปีที่แล้ว`;
}
