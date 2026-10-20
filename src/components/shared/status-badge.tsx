import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDashed,
  Clock,
  FileText,
  Hourglass,
  Loader2,
  type LucideIcon,
  Send,
  ShieldCheck,
  Sparkles,
  Upload,
  UserPen,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const TONE: Record<Tone, string> = {
  neutral: "border-border bg-surface-muted text-muted-foreground",
  accent: "border-primary/25 bg-primary-subtle text-primary",
  success: "border-success/25 bg-success-subtle text-success",
  warning: "border-warning/25 bg-warning-subtle text-warning",
  danger: "border-destructive/25 bg-destructive-subtle text-destructive",
  info: "border-info/25 bg-info-subtle text-info",
};

/** Compact chip: icon + text label, restrained colour. Colour is never the only signal. */
export function Chip({ tone = "neutral", icon: Icon, children, className, spin }: { tone?: Tone; icon?: LucideIcon; children: React.ReactNode; className?: string; spin?: boolean }) {
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[11px] leading-none font-medium whitespace-nowrap", TONE[tone], className)}>
      {Icon && <Icon className={cn("size-3", spin && "animate-spin")} aria-hidden />}
      {children}
    </span>
  );
}

/** Workflow statuses (design.md §8 Status indicators). */
export type WorkflowStatus = "draft" | "needs_review" | "approved" | "queued" | "processing" | "ready" | "published" | "failed" | "unavailable" | "stale" | "completed";

const WORKFLOW: Record<WorkflowStatus, { label: string; tone: Tone; icon: LucideIcon; spin?: boolean }> = {
  draft: { label: "ฉบับร่าง", tone: "neutral", icon: FileText },
  needs_review: { label: "รอตรวจ", tone: "warning", icon: AlertTriangle },
  approved: { label: "อนุมัติแล้ว", tone: "success", icon: CheckCircle2 },
  queued: { label: "รอคิว", tone: "neutral", icon: Clock },
  processing: { label: "กำลังประมวลผล", tone: "info", icon: Loader2, spin: true },
  ready: { label: "พร้อมใช้", tone: "success", icon: CheckCircle2 },
  completed: { label: "เสร็จสมบูรณ์", tone: "success", icon: CheckCircle2 },
  published: { label: "เผยแพร่แล้ว", tone: "accent", icon: Send },
  failed: { label: "ล้มเหลว", tone: "danger", icon: XCircle },
  unavailable: { label: "ไม่มีข้อมูล", tone: "neutral", icon: Ban },
  stale: { label: "ข้อมูลเก่า", tone: "warning", icon: Hourglass },
};

export function StatusBadge({ status, label }: { status: WorkflowStatus; label?: string }) {
  const s = WORKFLOW[status];
  return (
    <Chip tone={s.tone} icon={s.icon} spin={s.spin}>
      {label ?? s.label}
    </Chip>
  );
}

/** Data trust labels (design.md §10). */
export type TrustStatus = "verified_source" | "user_provided" | "imported_csv" | "ai_estimate" | "unavailable" | "stale" | "requires_review";

export const TRUST: Record<TrustStatus, { label: string; tone: Tone; icon: LucideIcon }> = {
  verified_source: { label: "ยืนยันจากแหล่งข้อมูล", tone: "success", icon: ShieldCheck },
  user_provided: { label: "ผู้ใช้กรอก", tone: "neutral", icon: UserPen },
  imported_csv: { label: "นำเข้า CSV", tone: "neutral", icon: Upload },
  ai_estimate: { label: "AI ประมาณการ", tone: "info", icon: Sparkles },
  unavailable: { label: "ไม่มีข้อมูล", tone: "neutral", icon: CircleDashed },
  stale: { label: "ข้อมูลเก่า", tone: "warning", icon: Hourglass },
  requires_review: { label: "ต้องตรวจสอบ", tone: "warning", icon: AlertTriangle },
};

export function TrustBadge({ status }: { status: TrustStatus }) {
  const s = TRUST[status];
  return (
    <Chip tone={s.tone} icon={s.icon}>
      {s.label}
    </Chip>
  );
}
