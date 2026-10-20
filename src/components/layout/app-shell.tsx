"use client";

import { LogOut, Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { isActive, NAV_ITEMS, type NavItem } from "./nav-config";

export const SIDEBAR_COOKIE = "sidebar_collapsed";

interface Account {
  email: string;
  displayName: string | null;
}

function NavEntry({ item, collapsed, onNavigate }: { item: NavItem; collapsed: boolean; onNavigate?: () => void }) {
  const path = usePathname();
  const active = isActive(item, path);
  const Icon = item.icon;
  const base = "relative flex h-9 items-center gap-3 rounded-md px-3 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring";

  const content = item.href ? (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        base,
        "text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground",
        active && "bg-surface-muted text-foreground before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary",
        collapsed && "justify-center px-0",
      )}
    >
      <Icon className={cn("size-4 shrink-0", active && "text-primary")} aria-hidden />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {collapsed && <span className="sr-only">{item.label}</span>}
    </Link>
  ) : (
    // Planned module: not a link, not focusable as an action; labelled honestly.
    <div aria-disabled="true" className={cn(base, "cursor-not-allowed text-muted-foreground/70", collapsed && "justify-center px-0")}>
      <Icon className="size-4 shrink-0" aria-hidden />
      {!collapsed && (
        <>
          <span className="truncate">{item.label}</span>
          <span className="ml-auto rounded border px-1 text-[10px] leading-4 font-normal">เร็วๆ นี้</span>
        </>
      )}
      {collapsed && <span className="sr-only">{item.label} (เร็วๆ นี้)</span>}
    </div>
  );

  if (!collapsed && item.href) return <li>{content}</li>;
  return (
    <li>
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="right">{item.href ? item.label : `${item.label} — เร็วๆ นี้ (${item.plannedFor})`}</TooltipContent>
      </Tooltip>
    </li>
  );
}

function NavList({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {NAV_ITEMS.map((item) => (
        <NavEntry key={item.label} item={item} collapsed={collapsed} onNavigate={onNavigate} />
      ))}
    </ul>
  );
}

function AccountBlock({ account, signOut, collapsed, onNavigate }: { account: Account; signOut: () => Promise<void>; collapsed: boolean; onNavigate?: () => void }) {
  return (
    <div className="border-t pt-3">
      {!collapsed && (
        <Link href="/settings" onClick={onNavigate} className="mb-1 block rounded-md px-3 py-1.5 hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          {account.displayName && <p className="truncate text-[13px] font-medium">{account.displayName}</p>}
          <p className="truncate text-xs text-muted-foreground" title={account.email}>
            {account.email}
          </p>
        </Link>
      )}
      <form action={signOut}>
        <Button type="submit" variant="ghost" size="sm" className={cn("w-full justify-start text-muted-foreground", collapsed && "justify-center px-0")} aria-label="ออกจากระบบ">
          <LogOut aria-hidden />
          {!collapsed && "ออกจากระบบ"}
        </Button>
      </form>
    </div>
  );
}

export function AppShell({
  account,
  signOut,
  initialCollapsed,
  children,
}: {
  account: Account;
  signOut: () => Promise<void>;
  initialCollapsed: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  }, [collapsed]);

  return (
    <div className="min-h-dvh lg:flex">
      <a href="#main" className="sr-only z-50 rounded-md bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        ข้ามไปเนื้อหาหลัก
      </a>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-sidebar px-3 py-4 transition-[width] duration-150 lg:flex",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <div className={cn("mb-5 flex items-center", collapsed ? "justify-center" : "justify-between pl-3")}>
          {!collapsed && <span className="text-sm font-semibold tracking-tight">Sales Automation</span>}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "ขยายแถบเมนู" : "ย่อแถบเมนู"}
            aria-expanded={!collapsed}
          >
            {collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
          </Button>
        </div>
        <nav aria-label="เมนูหลัก" className="min-h-0 flex-1 overflow-y-auto">
          <NavList collapsed={collapsed} />
        </nav>
        <AccountBlock account={account} signOut={signOut} collapsed={collapsed} />
      </aside>

      {/* Mobile / tablet top bar + drawer */}
      <div className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-surface px-3 lg:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="เปิดเมนู">
              <Menu aria-hidden />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="flex w-72 flex-col gap-0 p-3">
            <SheetHeader className="px-3 pt-1 pb-4">
              <SheetTitle className="text-sm">Sales Automation</SheetTitle>
              <SheetDescription className="sr-only">เมนูหลัก</SheetDescription>
            </SheetHeader>
            <nav aria-label="เมนูหลัก" className="min-h-0 flex-1 overflow-y-auto">
              <NavList collapsed={false} onNavigate={() => setMobileOpen(false)} />
            </nav>
            <AccountBlock account={account} signOut={signOut} collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
        <span className="text-sm font-semibold tracking-tight">Sales Automation</span>
      </div>

      <main id="main" className="mx-auto w-full max-w-[1440px] min-w-0 px-4 py-5 sm:px-5 lg:px-8 lg:py-8">
        {children}
      </main>
    </div>
  );
}
