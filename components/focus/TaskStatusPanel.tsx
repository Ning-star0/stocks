"use client";

import { Clock3 } from "lucide-react";

import { CollapsiblePanel } from "@/components/CollapsiblePanel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AnalysisRunResponse, FocusData, RunMetrics } from "@/components/focus/types";
import { nextMarketScheduledTime } from "@/lib/marketCalendar";
import { cn } from "@/lib/utils";

export function TaskStatusPanel({
  focus,
  runs,
  decisionLoading,
  decisionError
}: {
  focus: FocusData;
  runs: AnalysisRunResponse | null;
  decisionLoading: boolean;
  decisionError: string | null;
}) {
  const enabled = Boolean(focus.symbols.length && focus.capital && focus.analysisTimes.length);
  const latest = runs?.runs[0] ?? null;
  const latestStatus = decisionLoading
    ? "执行中"
    : decisionError
      ? "最近失败"
      : statusLabel(runs?.summary.latestStatus ?? "idle");
  const successCount = runs?.summary.successCount ?? 0;
  const failedCount = runs?.summary.failedCount ?? 0;
  const totalSymbols = runs?.summary.totalSymbols ?? latest?.totalSymbols ?? 0;
  const latestMetrics = runs?.summary.latestMetrics ?? latest?.metrics ?? emptyRunMetrics();
  const concurrency = runs?.summary.concurrency;
  const activeStockItems = decisionLoading
    ? Math.min(focus.symbols.length, concurrency?.focusStockAnalysisLimit ?? 3)
    : concurrency?.runningItems ?? latestMetrics.runningItems ?? 0;
  const activeTasks = concurrency?.runningRuns ?? runs?.summary.runningCount ?? 0;
  const latestTone = decisionError || runs?.summary.latestStatus === "failed"
    ? "danger"
    : runs?.summary.latestStatus === "partial_failed" || runs?.summary.latestFallbackUsed
      ? "warning"
      : runs?.summary.latestStatus === "success"
        ? "success"
        : "neutral";

  return (
    <Card className="soft-card">
      <CardHeader>
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-primary" />
              自动分析任务状态
            </CardTitle>
            <p className="mt-2 text-sm text-muted-foreground">跟踪后台是否按时执行、每只股票是否成功，以及 AI / 行情 / 新闻接口耗时。</p>
          </div>
          <Badge variant={statusBadgeVariant(runs?.summary.latestStatus ?? "idle")}>{latestStatus}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
          <StatusMetric label="自动任务" value={enabled ? "已启用" : "未启用"} tone={enabled ? "success" : "warning"} />
          <StatusMetric label="下一次 AI 分析" value={runs?.summary.nextRunAt ? formatDateTime(runs.summary.nextRunAt) : nextAnalysisLabel(focus.analysisTimes)} />
          <StatusMetric label="今日已执行" value={`${runs?.summary.todayRunCount ?? 0} 次`} />
          <StatusMetric label="最近状态" value={latestStatus} tone={latestTone} />
          <StatusMetric label="成功 / 失败" value={`${successCount} / ${failedCount}`} tone={failedCount > 0 ? "warning" : "success"} />
          <StatusMetric label="兜底触发" value={`${runs?.summary.fallbackCount ?? 0} 次`} tone={(runs?.summary.fallbackCount ?? 0) > 0 ? "warning" : "success"} />
          <StatusMetric label="当前运行" value={concurrency || decisionLoading ? `${activeTasks} 任务 / ${activeStockItems} 股票` : "0 / 0"} tone={activeTasks || activeStockItems ? "warning" : "neutral"} />
          <StatusMetric label="并发上限" value={concurrency ? `${concurrency.jobWorkerLimit} 任务 / ${concurrency.focusStockAnalysisLimit} 股票` : "--"} />
        </div>

        {latest ? (
          <div className="glow-card rounded-xl border border-border bg-background/35 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-sm font-semibold">最近一次执行</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatDateTime(latest.startedAt)} · {runTypeLabel(latest.runType)} · {statusLabel(latest.status)}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant={statusBadgeVariant(latest.status)}>{latest.successCount}/{Math.max(latest.totalSymbols, totalSymbols)} 成功</Badge>
                {latest.fallbackUsed ? <Badge variant="warning">使用兜底</Badge> : null}
                {latest.metrics.runningItems ? <Badge variant="secondary">{latest.metrics.runningItems} 只执行中</Badge> : null}
              </div>
            </div>
            {latest.errorSummary || runs?.summary.latestErrorSummary ? (
              <div className="mt-3 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                {latest.errorSummary || runs?.summary.latestErrorSummary}
              </div>
            ) : null}
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <StatusMetric label="总耗时" value={formatDuration(runs?.summary.latestDurationMs ?? latest.durationMs)} />
              <StatusMetric label="单股平均" value={formatDuration(latestMetrics.averageItemDurationMs)} />
              <StatusMetric label="AI 耗时" value={formatDuration(latestMetrics.aiDurationMs)} />
              <StatusMetric label="行情耗时" value={formatDuration(latestMetrics.quoteDurationMs)} />
              <StatusMetric label="新闻耗时" value={formatDuration(latestMetrics.newsDurationMs)} />
            </div>
          </div>
        ) : (
          <EmptyDecision message="暂无执行记录。到达自动分析时间或点击重新分析后，这里会生成任务日志。" />
        )}

        <div className="space-y-2">
          {(runs?.runs ?? []).slice(0, 4).map((run) => (
            <CollapsiblePanel key={run.id} title={`${formatDateTime(run.startedAt)} · ${runTypeLabel(run.runType)} · ${statusLabel(run.status)} · ${run.successCount}/${run.totalSymbols} 成功`}>
              <div className="space-y-2">
                <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-4 lg:grid-cols-6">
                  <StatusLine label="耗时" value={formatDuration(run.durationMs)} />
                  <StatusLine label="AI耗时" value={formatDuration(run.metrics.aiDurationMs)} />
                  <StatusLine label="行情耗时" value={formatDuration(run.metrics.quoteDurationMs)} />
                  <StatusLine label="新闻耗时" value={formatDuration(run.metrics.newsDurationMs)} />
                  <StatusLine label="股票数量" value={String(run.totalSymbols)} />
                  <StatusLine label="兜底规则" value={run.fallbackUsed ? "已触发" : "未触发"} />
                </div>
                <div className="glow-card overflow-hidden rounded-xl border border-border">
                  {run.items.length ? run.items.map((item) => (
                    <div key={item.id} className="grid gap-2 border-b border-border px-3 py-2 text-xs last:border-0 md:grid-cols-[1fr_76px_86px_86px_86px_120px_1.3fr]">
                      <span className="font-medium">{item.stockName || item.symbol} <span className="text-muted-foreground">{item.symbol}</span></span>
                      <span>{statusLabel(item.status)}</span>
                      <span>AI {apiStatusLabel(item.aiStatus)}</span>
                      <span>行情 {apiStatusLabel(item.quoteStatus)}</span>
                      <span>新闻 {apiStatusLabel(item.newsStatus)}</span>
                      <span className="text-muted-foreground">{formatDuration(item.durationMs)}</span>
                      <span className="text-muted-foreground">{item.errorMessage || `耗时 ${formatDuration(item.durationMs)}`}</span>
                    </div>
                  )) : <div className="px-3 py-2 text-xs text-muted-foreground">暂无单股执行明细。</div>}
                </div>
              </div>
            </CollapsiblePanel>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyDecision({ message }: { message: string }) {
  return <div className="rounded-md border border-dashed border-border bg-background/20 p-4 text-sm text-muted-foreground">{message}</div>;
}

function StatusMetric({
  label,
  value,
  tone = "neutral"
}: {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const toneClass = {
    neutral: "border-border bg-muted/20",
    success: "border-primary/20 bg-primary/10",
    warning: "border-amber-500/25 bg-amber-500/10",
    danger: "border-red-500/25 bg-red-500/10"
  }[tone];
  return (
    <div className={cn("glow-card rounded-lg border px-3 py-3", toneClass)}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  );
}

function nextAnalysisLabel(times: string[]) {
  const next = nextMarketScheduledTime(times);
  return next ? formatRelativeDateTime(next) : "未设置";
}

function formatRelativeDateTime(date: Date) {
  const now = new Date();
  const today = startOfLocalDay(now);
  const target = startOfLocalDay(date);
  const dayDiff = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (dayDiff === 0) return `今天 ${time}`;
  if (dayDiff === 1) return `明天 ${time}`;
  return formatDateTime(date);
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function statusLabel(value?: string | null) {
  const map: Record<string, string> = {
    idle: "空闲",
    running: "执行中",
    success: "成功",
    partial_failed: "部分失败",
    failed: "失败",
    skipped: "跳过"
  };
  return value ? map[value] ?? value : "未知";
}

function apiStatusLabel(value?: string | null) {
  const map: Record<string, string> = {
    success: "成功",
    failed: "失败",
    fallback: "兜底",
    skipped: "跳过"
  };
  return value ? map[value] ?? value : "--";
}

function runTypeLabel(value?: string | null) {
  if (value === "scheduled") return "自动";
  if (value === "manual") return "手动";
  return value || "--";
}

function statusBadgeVariant(status?: string | null): "success" | "warning" | "danger" | "secondary" {
  if (status === "success") return "success";
  if (status === "partial_failed" || status === "running") return "warning";
  if (status === "failed") return "danger";
  return "secondary";
}

function emptyRunMetrics(): RunMetrics {
  return {
    totalItemDurationMs: 0,
    aiDurationMs: 0,
    quoteDurationMs: 0,
    newsDurationMs: 0,
    averageItemDurationMs: null,
    runningItems: 0
  };
}

function formatDuration(value?: number | null) {
  if (!value) return "--";
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function formatDateTime(value?: string | Date | null) {
  if (!value) return "尚未执行";
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
