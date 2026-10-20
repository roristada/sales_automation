import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Form field shell: visible label above, required/optional marker, hint, and an error
 * associated with the input via aria-describedby (design.md §8 Forms, §12).
 * Children receive the ids through the render prop.
 */
export function Field({
  id,
  label,
  required,
  optional,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  optional?: boolean;
  hint?: React.ReactNode;
  error?: string;
  className?: string;
  children: (a11y: { id: string; "aria-invalid": boolean; "aria-describedby"?: string; required?: boolean }) => React.ReactNode;
}) {
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id} className="text-[13px]">
        {label}
        {required && (
          <span className="text-destructive" aria-hidden>
            *
          </span>
        )}
        {optional && <span className="font-normal text-muted-foreground">(ไม่บังคับ)</span>}
      </Label>
      {children({ id, "aria-invalid": !!error, "aria-describedby": describedBy, required })}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** Native select styled like Input — simple, accessible, works in plain GET forms. */
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-10 rounded-lg border border-input bg-surface px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
