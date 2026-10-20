import { AlertTriangle, CheckCircle2, Database, Inbox, Info, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Empty state: what is missing + one useful next action (design.md §1.5). */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-surface px-6 py-12 text-center", className)}>
      <Icon className="size-5 text-muted-foreground" aria-hidden />
      <p className="font-medium">{title}</p>
      {description && <div className="max-w-md text-muted-foreground">{description}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "เกิดข้อผิดพลาด", description, action }: { title?: string; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive-subtle px-6 py-12 text-center">
      <AlertTriangle className="size-5 text-destructive" aria-hidden />
      <p className="font-medium">{title}</p>
      {description && <div className="max-w-md text-muted-foreground">{description}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

const NOTICE = {
  error: { icon: AlertTriangle, className: "border-destructive/30 bg-destructive-subtle text-destructive", role: "alert" },
  warning: { icon: AlertTriangle, className: "border-warning/30 bg-warning-subtle text-warning", role: "status" },
  success: { icon: CheckCircle2, className: "border-success/30 bg-success-subtle text-success", role: "status" },
  info: { icon: Info, className: "border-info/30 bg-info-subtle text-info", role: "status" },
} as const;

/** Inline message for errors/warnings that need action — never only a toast (design.md §8 Feedback). */
export function Notice({ tone, children, className }: { tone: keyof typeof NOTICE; children: React.ReactNode; className?: string }) {
  const { icon: Icon, className: toneClass, role } = NOTICE[tone];
  return (
    <div role={role} className={cn("flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[13px]", toneClass, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 text-foreground">{children}</div>
    </div>
  );
}

/** Shown when Supabase env vars are missing. Never pretends data exists. */
export function SetupRequired({ feature }: { feature: string }) {
  return (
    <EmptyState
      icon={Database}
      title={`${feature} ยังใช้งานไม่ได้: ยังไม่ได้ตั้งค่า Supabase`}
      description={
        <>
          ตั้งค่า <code>NEXT_PUBLIC_SUPABASE_URL</code> และ <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> ใน <code>.env.local</code> (ดู docs/SETUP.md)
        </>
      }
    />
  );
}
