"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { Bell, Brain, Crosshair, ListChecks, Newspaper, Settings } from "lucide-react";

import { cn } from "@/lib/utils";

const navItems = [
  { href: "/watchlist", label: "自选股", icon: ListChecks },
  { href: "/focus", label: "今日关注", icon: Crosshair },
  { href: "/focus?section=decision", label: "AI 决策", icon: Brain, section: "decision" },
  { href: "/news", label: "新闻", icon: Newspaper },
  { href: "/alerts", label: "提醒", icon: Bell },
  { href: "/settings", label: "设置", icon: Settings }
];

export function AppNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeSection = searchParams.get("section");

  return (
    <nav className="flex w-max max-w-[calc(100vw-2rem)] items-center gap-1 overflow-x-auto rounded-full border border-border/70 bg-card/70 p-1 shadow-[0_10px_30px_hsl(220_20%_20%/0.08)] backdrop-blur-xl">
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = isNavItemActive(item, pathname, activeSection);
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

function isNavItemActive(item: (typeof navItems)[number], pathname: string, activeSection: string | null) {
  const hrefPath = item.href.split("?")[0];
  if (item.section) return pathname === hrefPath && activeSection === item.section;
  if (hrefPath === "/focus") return pathname === "/focus" && !activeSection;
  return pathname === hrefPath || (hrefPath !== "/" && pathname.startsWith(`${hrefPath}/`));
}

function NavItem({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "group inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-medium transition-all duration-150 hover:bg-secondary/70 hover:text-foreground active:scale-[0.98]",
        active ? "bg-primary/10 text-primary shadow-sm ring-1 ring-primary/15" : "text-muted-foreground"
      )}
    >
      {children}
    </Link>
  );
}
