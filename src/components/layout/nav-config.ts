import {
  BarChart3,
  Clapperboard,
  FileText,
  ImageIcon,
  LayoutDashboard,
  ListChecks,
  type LucideIcon,
  Package,
  SearchCheck,
  Send,
  Settings,
} from "lucide-react";

export interface NavItem {
  label: string;
  icon: LucideIcon;
  /** Present only for modules that work today. Planned modules have no href and render as "เร็วๆ นี้". */
  href?: string;
  /** Milestone that delivers a planned module (shown in the tooltip). */
  plannedFor?: string;
  /** Extra path prefixes that should highlight this item. */
  match?: string[];
  /** Path prefixes that must NOT highlight this item even if they share its prefix. */
  exclude?: string[];
}

/** Navigation order from design.md §6. */
export const NAV_ITEMS: NavItem[] = [
  { label: "ภาพรวม", icon: LayoutDashboard, href: "/dashboard", match: ["/imports"] },
  { label: "ค้นหาสินค้า", icon: SearchCheck, href: "/research" },
  { label: "สินค้า", icon: Package, href: "/products" },
  { label: "วางแผนคอนเทนต์", icon: ListChecks, href: "/content" },
  { label: "Script Studio", icon: FileText, href: "/studio" },
  { label: "Video Studio", icon: Clapperboard, href: "/videos" },
  { label: "คลังไฟล์", icon: ImageIcon, href: "/assets" },
  { label: "เผยแพร่", icon: Send, href: "/publishing" },
  { label: "Analytics", icon: BarChart3, plannedFor: "Milestone 7" },
  { label: "ตั้งค่า", icon: Settings, href: "/settings" },
];

export function isActive(item: NavItem, path: string): boolean {
  if (!item.href) return false;
  const prefixes = [item.href, ...(item.match ?? [])];
  return prefixes.some((p) => path === p || path.startsWith(`${p}/`));
}
