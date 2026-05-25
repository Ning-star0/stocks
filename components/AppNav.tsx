"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Bell, Brain, ListChecks, Newspaper, Settings } from "lucide-react";

import { motionDurations, motionEase } from "@/lib/motion";
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
  const navRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [activePill, setActivePill] = useState({ left: 6, width: 0, ready: false });
  const [reducedMotion, setReducedMotion] = useState(false);

  const activeIndex = navItems.findIndex((item) => isNavItemActive(item, pathname));

  const measureActivePill = useCallback(() => {
    const nav = navRef.current;
    const item = itemRefs.current[activeIndex];
    if (!nav || !item || activeIndex < 0) return;

    const navRect = nav.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const left = itemRect.left - navRect.left + nav.scrollLeft;

    setActivePill({
      left,
      width: itemRect.width,
      ready: true
    });
  }, [activeIndex]);

  useLayoutEffect(() => {
    measureActivePill();
  }, [measureActivePill, pathname]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateReducedMotion = () => setReducedMotion(mediaQuery.matches);

    updateReducedMotion();
    mediaQuery.addEventListener("change", updateReducedMotion);
    return () => mediaQuery.removeEventListener("change", updateReducedMotion);
  }, []);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    const resizeObserver = new ResizeObserver(measureActivePill);

    measureActivePill();
    resizeObserver.observe(nav);
    itemRefs.current.forEach((item) => {
      if (item) resizeObserver.observe(item);
    });
    nav.addEventListener("scroll", measureActivePill, { passive: true });
    window.addEventListener("resize", measureActivePill);
    return () => {
      resizeObserver.disconnect();
      nav.removeEventListener("scroll", measureActivePill);
      window.removeEventListener("resize", measureActivePill);
    };
  }, [measureActivePill]);

  return (
    <nav
      ref={navRef}
      className="liquid-nav liquid-glass relative flex h-12 w-max max-w-[calc(100vw-1rem)] items-center gap-1.5 overflow-x-auto rounded-full p-1.5 sm:max-w-[calc(100vw-2rem)]"
    >
      {activeIndex >= 0 ? (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute bottom-1.5 top-1.5 rounded-full bg-white/72 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.90),inset_0_-10px_22px_hsl(210_28%_72%/0.16),0_10px_28px_hsl(166_42%_28%/0.14)] ring-1 ring-white/75 dark:bg-white/13 dark:shadow-[inset_0_1px_0_hsl(0_0%_100%/0.22),inset_0_-10px_24px_hsl(0_0%_100%/0.05),0_12px_30px_hsl(0_0%_0%/0.24)] dark:ring-white/16",
            activePill.ready ? "opacity-100" : "opacity-0"
          )}
          style={{
            width: `${activePill.width}px`,
            transform: `translate3d(${activePill.left}px, 0, 0)`,
            transition: reducedMotion
              ? `opacity 120ms ${motionEase}`
              : `transform ${motionDurations.page}ms ${motionEase}, width ${motionDurations.page}ms ${motionEase}, opacity 160ms ${motionEase}`
          }}
        />
      ) : null}

      {navItems.map((item, index) => {
        const Icon = item.icon;
        const active = isNavItemActive(item, pathname);
        return (
          <NavItem
            key={item.label}
            href={item.href}
            active={active}
            refCallback={(node) => {
              itemRefs.current[index] = node;
            }}
          >
            <Icon className="h-4 w-4 transition-transform duration-150 group-hover:-translate-y-px" />
            <span className="hidden whitespace-nowrap min-[420px]:inline">{item.label}</span>
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

function NavItem({
  href,
  active,
  children,
  refCallback
}: {
  href: string;
  active: boolean;
  children: ReactNode;
  refCallback: (node: HTMLAnchorElement | null) => void;
}) {
  return (
    <Link
      ref={refCallback}
      href={href}
      className={cn(
        "group relative z-10 inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-full px-3 text-sm font-semibold tracking-normal transition-[color,transform] duration-150 hover:text-foreground active:scale-[0.98] min-[420px]:px-4",
        active ? "text-primary dark:text-foreground" : "text-muted-foreground"
      )}
    >
      {children}
    </Link>
  );
}
