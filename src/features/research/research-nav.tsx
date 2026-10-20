import Link from "next/link";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/research", label: "เปรียบเทียบสินค้า" },
  { href: "/research/sources", label: "แหล่งข้อมูลและความใหม่" },
  { href: "/research/trends", label: "เทรนด์" },
] as const;

/** Sub-navigation for the Product Research area (stays inside one sidebar item, design.md §6). */
export function ResearchNav({ current }: { current: (typeof ITEMS)[number]["href"] }) {
  return (
    <nav aria-label="ส่วนของการค้นหาสินค้า" className="mb-5 flex gap-1 overflow-x-auto border-b">
      {ITEMS.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={current === i.href ? "page" : undefined}
          className={cn(
            "-mb-px shrink-0 border-b-2 border-transparent px-3 py-2 text-[13px] font-medium whitespace-nowrap text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            current === i.href && "border-primary text-foreground",
          )}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
