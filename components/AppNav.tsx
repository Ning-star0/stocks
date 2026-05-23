"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Bell, Brain, Crosshair, ListChecks, Newspaper, Settings } from "lucide-react";

import { cn } from "@/lib/utils";

const navItems = [
  { href: "/watchlist", label: "自选股", icon: ListChecks },
  { href: "/focus", label: "今日关注", icon: Crosshair },
  { href: "/focus#decision", label: "AI 决策", icon: Brain, activePath: "/focus" },
  { href: "/news", label: "新闻", icon: Newspaper },
  { href: "/alerts", label: "提醒", icon: Bell },
  { href: "/settings", label: "设置", icon: Settings }
];

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav className="flex min-w-0 items-center gap-1 overflow-x-auto rounded-full border border-border bg-background/65 p-1 shadow-sm backdrop-blur-xl">
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = pathname === (item.activePath ?? item.href) || (!item.activePath && item.href !== "/" && pathname.startsWith(`${item.href}/`));
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

function NavItem({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "group inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm transition-all duration-150 hover:bg-secondary/80 hover:text-foreground active:scale-[0.98]",
        active ? "bg-primary/10 text-primary shadow-sm ring-1 ring-primary/15" : "text-muted-foreground"
      )}
    >
      {children}
    </Link>
  );
}
