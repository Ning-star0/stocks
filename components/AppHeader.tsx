"use client";

import { useEffect, useRef, useState } from "react";
import { BarChart3 } from "lucide-react";

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
      <div className="mx-auto flex w-full max-w-7xl items-center justify-center gap-4 px-5 py-3 lg:px-8">
        {signedIn ? (
          <AppNav />
        ) : (
          <div className="flex shrink-0 items-center gap-2 font-semibold">
            <BarChart3 className="h-5 w-5 text-primary" />
            股票 AI 监控
          </div>
        )}
      </div>
    </header>
  );
}
