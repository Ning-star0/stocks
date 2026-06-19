"use client";

import { useEffect, useRef, useState } from "react";
import { BarChart3, CircleDot, ShieldCheck } from "lucide-react";

import { motionDurations, motionEase } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { AppNav } from "@/components/AppNav";

export function AppHeader({ signedIn }: { signedIn: boolean }) {
  const lastScrollY = useRef(0);
  const ticking = useRef(false);
  const hiddenRef = useRef(false);
  const [hidden, setHidden] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateReducedMotion = () => setReducedMotion(mediaQuery.matches);

    updateReducedMotion();
    mediaQuery.addEventListener("change", updateReducedMotion);
    return () => mediaQuery.removeEventListener("change", updateReducedMotion);
  }, []);

  useEffect(() => {
    function updateHeaderVisibility() {
      const currentY = window.scrollY;
      const delta = currentY - lastScrollY.current;
      let nextHidden = hiddenRef.current;

      if (currentY < 24) {
        nextHidden = false;
      } else if (Math.abs(delta) > 8) {
        nextHidden = delta > 0 && currentY > 96;
      }

      if (nextHidden !== hiddenRef.current) {
        hiddenRef.current = nextHidden;
        setHidden(nextHidden);
      }

      lastScrollY.current = Math.max(currentY, 0);
      ticking.current = false;
    }

    function onScroll() {
      if (ticking.current) return;
      ticking.current = true;
      window.requestAnimationFrame(updateHeaderVisibility);
    }

    lastScrollY.current = window.scrollY;
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b border-white/35 bg-background/28 backdrop-blur-lg will-change-[transform,opacity] dark:border-white/10",
        hidden && "pointer-events-none border-transparent bg-transparent"
      )}
      style={{
        transform: reducedMotion || !hidden ? "translate3d(0, 0, 0)" : "translate3d(0, -88%, 0)",
        opacity: hidden ? 0 : 1,
        transition: reducedMotion
          ? `opacity 120ms ${motionEase}, background-color 120ms ${motionEase}, border-color 120ms ${motionEase}`
          : `transform ${motionDurations.page}ms ${motionEase}, opacity 240ms ${motionEase}, background-color 240ms ${motionEase}, border-color 240ms ${motionEase}`
      }}
    >
      <div className="mx-auto flex w-full max-w-[90rem] items-center justify-between gap-3 px-3 py-2 sm:px-5 sm:py-3 lg:px-7">
        {signedIn ? (
          <>
            <div className="hidden shrink-0 items-center gap-2 rounded-full border border-border/70 bg-background/58 px-3 py-2 text-sm font-semibold shadow-sm lg:flex">
              <BarChart3 className="h-4 w-4 text-primary" />
              <span>股票 AI 监控</span>
            </div>
            <div className="flex min-w-0 flex-1 justify-center">
              <AppNav />
            </div>
            <div className="hidden shrink-0 items-center gap-2 rounded-full border border-border/70 bg-background/58 px-3 py-2 text-xs text-muted-foreground shadow-sm md:flex">
              <CircleDot className="h-3.5 w-3.5 text-emerald-500" />
              运行中
            </div>
          </>
        ) : (
          <div className="glow-card mx-auto flex shrink-0 items-center gap-2 rounded-full border border-border/70 bg-background/58 px-4 py-2 font-semibold shadow-sm">
            <BarChart3 className="h-5 w-5 text-primary" />
            股票 AI 监控
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
      </div>
    </header>
  );
}
