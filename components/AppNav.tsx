"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Bell, Brain, ListChecks, Newspaper, Settings } from "lucide-react";

import { cn } from "@/lib/utils";

const navItems = [
  { href: "/watchlist", label: "自选股", icon: ListChecks },
  { href: "/focus", label: "AI 决策", icon: Brain },
  { href: "/news", label: "新闻", icon: Newspaper },
  { href: "/alerts", label: "提醒", icon: Bell },
  { href: "/settings", label: "设置", icon: Settings }
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="liquid-glass flex w-max max-w-[calc(100vw-2rem)] items-center gap-1 overflow-x-auto rounded-full p-1">
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = isNavItemActive(item, pathname);
        return (
          <NavItem key={item.label} href={item.href} active={active}>
            <Icon className="h-4 w-4 transition-transform duration-150 group-hover:-translate-y-px" />
            <span className="whitespace-nowrap">{item.label}</span>
          </NavItem>
        );
      })}
    </nav>
  );
}

function isNavItemActive(item: (typeof navItems)[number], pathname: string) {
  const hrefPath = item.href.split("?")[0];
  return pathname === hrefPath || (hrefPath !== "/" && pathname.startsWith(`${hrefPath}/`));
}

function NavItem({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "group inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-medium transition-all duration-150 hover:bg-white/42 hover:text-foreground active:scale-[0.98] dark:hover:bg-white/8",
        active ? "bg-white/72 text-primary shadow-[inset_0_1px_0_hsl(0_0%_100%/0.72),0_8px_22px_hsl(166_45%_28%/0.14)] ring-1 ring-white/60 dark:bg-white/12 dark:ring-white/10" : "text-muted-foreground"
      )}
    >
      {children}
    </Link>
  );
}
