import * as React from "react";

import { cn } from "@/lib/utils";

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "flex h-10 w-full rounded-xl border border-white/50 bg-white/42 px-3 py-2 text-sm shadow-[inset_0_1px_0_hsl(0_0%_100%/0.38)] backdrop-blur-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-white/10 dark:bg-white/6 disabled:cursor-not-allowed disabled:opacity-50",
        props.className
      )}
    />
  );
}
