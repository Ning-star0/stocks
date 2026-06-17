import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { motionClassNames, staggerDelay } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn(motionClassNames.pageEnter, "mx-auto w-full max-w-7xl space-y-6", className)}>{children}</div>;
}

export function SectionHeader({
  title,
  action,
  eyebrow,
  className
}: {
  title: string;
  action?: ReactNode;
  eyebrow?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 md:flex-row md:items-end md:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow ? <div className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-primary/80">{eyebrow}</div> : null}
        <h1 className="text-2xl font-semibold tracking-normal text-foreground md:text-3xl">{title}</h1>
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
  delayIndex = 0,
  className
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "neutral" | "success" | "warning" | "danger";
  delayIndex?: number;
  className?: string;
}) {
  const toneClass = {
    neutral: "from-slate-500/[0.08] to-transparent",
    success: "from-emerald-500/[0.10] to-transparent",
    warning: "from-amber-500/[0.12] to-transparent",
    danger: "from-rose-500/[0.12] to-transparent"
  }[tone];
  return (
    <Card className={cn("soft-card overflow-hidden bg-gradient-to-br p-4", motionClassNames.cardEnter, motionClassNames.hoverLift, toneClass, className)} style={{ animationDelay: `${staggerDelay(delayIndex)}ms` }}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <AnimatedNumberValue className="mt-2 text-2xl font-semibold tabular-nums tracking-tight" value={value} />
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </Card>
  );
}

export function InsightCard({ children, className, delayIndex = 0 }: { children: ReactNode; className?: string; delayIndex?: number }) {
  return <Card className={cn("soft-card", motionClassNames.cardEnter, className)} style={{ animationDelay: `${staggerDelay(delayIndex)}ms` }}>{children}</Card>;
}

export function LoadingInsight({ text = "正在综合行情、技术指标与新闻情绪...", activeStepIndex = 0 }: { text?: string; activeStepIndex?: number }) {
  const steps = ["读取行情数据", "分析技术指标", "综合新闻情绪", "生成策略观察"];
  const normalizedStep = Math.min(Math.max(activeStepIndex, 0), steps.length - 1);
  return (
    <div className={cn("glow-card rounded-xl border border-border bg-muted/20 p-4", motionClassNames.fadeUp, motionClassNames.loadingSweep)}>
      <div className="flex items-center gap-3 text-sm font-medium">
        <span className={motionClassNames.softDots} aria-hidden="true">
          <span />
        </span>
        {text}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        {steps.map((step, index) => (
          <div
            key={step}
            className={cn(
              "glow-card rounded-lg border px-3 py-2 text-xs transition-colors",
              index <= normalizedStep
                ? "border-primary/25 bg-primary/5 text-foreground"
                : "border-border bg-background/60 text-muted-foreground",
              motionClassNames.fadeUp
            )}
            style={{ animationDelay: `${staggerDelay(index)}ms` }}
          >
            {step}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AnimatedNumberValue({ value, className }: { value: ReactNode; className?: string }) {
  return <div key={String(value)} className={cn(motionClassNames.numberChange, className)}>{value}</div>;
}
