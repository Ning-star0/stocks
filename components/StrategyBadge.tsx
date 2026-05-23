import { Badge } from "@/components/ui/badge";
import { motionClassNames } from "@/lib/motion";
import { cn } from "@/lib/utils";

type Tone = "bullish" | "bearish" | "neutral" | "watch" | "avoid" | "wait";

const toneClass: Record<Tone, string> = {
  bullish: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  bearish: "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  neutral: "border-slate-500/20 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  watch: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  avoid: "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  wait: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
};

export function StrategyBadge({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <Badge variant="outline" className={cn(motionClassNames.badgePop, "border px-2 py-0.5", toneClass[tone], className)}>
      {children}
    </Badge>
  );
}

export function trendToStrategy(trend?: string) {
  if (trend === "bullish") return { label: "偏多", tone: "bullish" as const };
  if (trend === "bearish") return { label: "偏空", tone: "bearish" as const };
  if (trend === "neutral") return { label: "中性", tone: "neutral" as const };
  return { label: "观察", tone: "watch" as const };
}
