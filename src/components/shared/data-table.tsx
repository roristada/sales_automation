import { cn } from "@/lib/utils";

/*
 * Table primitives with one consistent look (design.md §8 Tables). Secondary columns use
 * `hideBelow` so mobile shows a limited-column layout; put the most important secondary
 * facts inside the first cell with `md:hidden` for a stacked row on small screens.
 */

const HIDE = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" } as const;

export function DataTable({ children, caption, className }: { children: React.ReactNode; caption?: string; className?: string }) {
  return (
    <div className={cn("overflow-x-auto rounded-lg border bg-surface", className)}>
      <table className="w-full text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function Th({ children, numeric, hideBelow, className }: { children?: React.ReactNode; numeric?: boolean; hideBelow?: keyof typeof HIDE; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b bg-surface-muted/60 px-4 py-2.5 text-left text-xs font-medium whitespace-nowrap text-muted-foreground",
        numeric && "text-right",
        hideBelow && HIDE[hideBelow],
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, numeric, hideBelow, className }: { children?: React.ReactNode; numeric?: boolean; hideBelow?: keyof typeof HIDE; className?: string }) {
  return <td className={cn("px-4 py-3 align-top", numeric && "text-right tabular-nums", hideBelow && HIDE[hideBelow], className)}>{children}</td>;
}

export function Tr({ children, className }: { children: React.ReactNode; className?: string }) {
  return <tr className={cn("border-b transition-colors last:border-0 hover:bg-surface-muted/50", className)}>{children}</tr>;
}
