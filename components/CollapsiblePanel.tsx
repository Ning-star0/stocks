"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { motionDurations, motionEase } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function CollapsiblePanel({
  title,
  children,
  defaultOpen = false,
  className
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn("performance-card overflow-hidden rounded-xl border border-border", className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="glow-click-card flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-muted/35"
      >
        {title}
        <ChevronDown
          className={cn("h-4 w-4 text-muted-foreground transition-transform", open ? "rotate-180" : "rotate-0")}
          style={{ transitionDuration: `${motionDurations.collapse}ms`, transitionTimingFunction: motionEase }}
        />
      </button>
      <div
        className={cn("grid transition-all", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}
        style={{ transitionDuration: `${motionDurations.collapse}ms`, transitionTimingFunction: motionEase }}
      >
        <div className="overflow-hidden">
          <div
            className={cn("border-t border-border/70 px-4 py-4 transition-all", open ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0")}
            style={{ transitionDuration: `${motionDurations.collapse}ms`, transitionTimingFunction: motionEase }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
