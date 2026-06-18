"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, Check, Clock3, Loader2, Plus, Save, Sparkles, Trash2, WalletCards } from "lucide-react";

import { CollapsiblePanel } from "@/components/CollapsiblePanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LoadingInsight, PageContainer, SectionHeader } from "@/components/ui/layout";
import { buildStockNameMap, normalizeWatchlistItems } from "@/components/focus/api";
import { CandidateRanking } from "@/components/focus/CandidateRanking";
import { FocusDecisionPanel } from "@/components/focus/FocusDecisionPanel";
import { FocusAnalysisCard } from "@/components/focus/FocusAnalysisCard";
import { TaskStatusPanel } from "@/components/focus/TaskStatusPanel";
import type {
  AnalysisRunResponse,
  DecisionHistoryRecord,
  FocusData,
  FocusDecision,
  StockItem,
  WatchlistResponse
} from "@/components/focus/types";
import { StrategyBadge } from "@/components/StrategyBadge";
import { readJsonResponse } from "@/lib/clientApi";
import { nextMarketScheduledTime } from "@/lib/marketCalendar";
import { motionClassNames, staggerDelay } from "@/lib/motion";
import { cn } from "@/lib/utils";

export default function FocusPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusData>({ name: "今日关注", symbols: [], capital: null, newsFetchTime: "09:30", analysisTimes: [], lastNewsFetch: null, lastAnalysis: null });
  const [watchlist, setWatchlist] = useState<StockItem[]>([]);
  const [newTime, setNewTime] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const [decision, setDecision] = useState<FocusDecision | null>(null);
  const [decisionLoading, setDecisionLoading] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [decisionNotice, setDecisionNotice] = useState<string | null>(null);
  const [runs, setRuns] = useState<AnalysisRunResponse | null>(null);
  const [history, setHistory] = useState<DecisionHistoryRecord[]>([]);

  useEffect(() => {
    Promise.all([
      fetch("/api/focus").then((response) => readJsonResponse<Partial<FocusData>>(response)),
      fetch("/api/watchlist").then((response) => readJsonResponse<WatchlistResponse>(response))
    ])
      .then(async ([focusData, wlData]) => {
        setFocus((prev) => ({ ...prev, ...focusData }));
        const items = normalizeWatchlistItems(wlData);
        setWatchlist(items);
        setNames(buildStockNameMap(items));
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "加载失败"))
      .finally(() => setLoading(false));
  }, []);

  function toggleSymbol(symbol: string) {
    setDecision(null);
    setDecisionError(null);
    setDecisionNotice(null);
    setFocus((prev) => {
      const has = prev.symbols.includes(symbol);
      return { ...prev, symbols: has ? prev.symbols.filter((s) => s !== symbol) : [...prev.symbols, symbol] };
    });
  }

  async function toggleHolding(item: StockItem, nextHolding: boolean) {
    setMessage(null);
    try {
      const response = await fetch(`/api/watchlist/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isHolding: nextHolding })
      });
      const json = await readJsonResponse<{ item?: { positionOpenedAt?: string | null } }>(response);
      setWatchlist((prev) => prev.map((row) => row.id === item.id ? { ...row, isHolding: nextHolding, positionOpenedAt: json.item?.positionOpenedAt ?? item.positionOpenedAt } : row));
      setDecision(null);
      setDecisionError(null);
      setDecisionNotice(null);
      setMessage(nextHolding ? "已标记为已购买，下一次策略观察会按持仓处理。" : "已标记为未购买，下一次策略观察会按未持仓处理。");
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存购买状态失败");
    }
  }

  async function doSave(data: FocusData) {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/focus", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      await readJsonResponse(res);
      setMessage("已保存");
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  function addAnalysisTime() {
    const t = normalizeTimeInput(newTime);
    if (!t) return;
    setFocus((prev) => {
      const next = { ...prev, analysisTimes: [...new Set([...prev.analysisTimes, t])].sort() };
      doSave(next);
      return next;
    });
    setNewTime("");
  }

  function removeAnalysisTime(t: string) {
    setFocus((prev) => {
      const next = { ...prev, analysisTimes: prev.analysisTimes.filter((x) => x !== t) };
      doSave(next);
      return next;
    });
  }

  async function save() {
    doSave(focus);
  }

  const refreshTrackingData = useCallback(async () => {
    const [runsResponse, historyResponse] = await Promise.allSettled([
      fetch("/api/analysis-runs?limit=6", { cache: "no-store" }).then((response) => readJsonResponse<AnalysisRunResponse>(response)),
      fetch("/api/decision-history?limit=5", { cache: "no-store" }).then((response) => readJsonResponse<{ records?: DecisionHistoryRecord[] }>(response))
    ]);
    if (runsResponse.status === "fulfilled") setRuns(runsResponse.value);
    if (historyResponse.status === "fulfilled" && historyResponse.value.records) setHistory(historyResponse.value.records);
  }, []);

  const refreshWatchlist = useCallback(async () => {
    const wlData = await fetch("/api/watchlist", { cache: "no-store" }).then((response) => readJsonResponse<WatchlistResponse>(response));
    const items = normalizeWatchlistItems(wlData);
    setWatchlist(items);
    setNames(buildStockNameMap(items));
  }, []);

  const loadDecision = useCallback(async (method: "GET" | "POST") => {
    setDecisionLoading(true);
    setDecisionError(null);
    setDecisionNotice(null);
    try {
      const response = await fetch("/api/focus/decision", { method });
      const json = await readJsonResponse<FocusDecision & { decisionUnavailable?: boolean; message?: string }>(response);
      if (json.decisionUnavailable) {
        setDecision(null);
        setDecisionNotice(json.message ?? "等待下一个自动分析时间生成策略观察。");
        return;
      }
      setDecision(json);
      void refreshTrackingData();
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : "生成决策失败");
    } finally {
      setDecisionLoading(false);
    }
  }, [refreshTrackingData]);

  useEffect(() => {
    if (loading || decision || decisionLoading || decisionError || decisionNotice) return;
    if (!focus.symbols.length || !focus.capital) return;
    void loadDecision("GET");
  }, [decision, decisionError, decisionLoading, decisionNotice, focus.capital, focus.symbols.length, loadDecision, loading]);

  useEffect(() => {
    if (loading) return;
    void refreshTrackingData();
  }, [loading, refreshTrackingData]);

  useEffect(() => {
    const hasRunningTask = decisionLoading || runs?.summary.latestStatus === "running" || (runs?.summary.runningCount ?? 0) > 0;
    if (!hasRunningTask) return;
    const timer = window.setInterval(() => {
      void refreshTrackingData();
    }, 8000);
    return () => window.clearInterval(timer);
  }, [decisionLoading, refreshTrackingData, runs?.summary.latestStatus, runs?.summary.runningCount]);

  async function generateDecision() {
    await loadDecision("POST");
  }

  if (loading) {
    return (
      <div className="mx-auto flex max-w-3xl items-center justify-center px-4 py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <PageContainer>
      <SectionHeader
        title="今日工作台"
      />

      <FocusStatusStrip
        focus={focus}
        watchlistCount={watchlist.length}
        decision={decision}
        runs={runs}
        decisionLoading={decisionLoading}
      />

      <Card id="decision" className="performance-card overflow-hidden">
        <CardHeader className="flex-row items-center justify-between gap-3 border-b border-border/70 bg-muted/10 p-4">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              今日 AI 策略观察
            </CardTitle>
          </div>
          <Button onClick={generateDecision} disabled={decisionLoading || !focus.symbols.length || !focus.capital}>
            {decisionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <WalletCards className="h-4 w-4" />}
            {decisionLoading ? "分析中" : "重新分析"}
          </Button>
        </CardHeader>
        <CardContent className="p-4">
          {decisionError ? <div className="glow-card mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{decisionError}</div> : null}
          {decisionNotice ? <div className="glow-card mb-3 rounded-xl border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">{decisionNotice}</div> : null}
          {!focus.capital ? (
            <EmptyDecision message="先填写总本金，AI 才能计算计划买入金额、保留现金和手续费。" />
          ) : !focus.symbols.length ? (
            <EmptyDecision message="先在下方选择今日关注标的，系统会在自动分析时间生成策略观察。" />
          ) : decision ? (
            <FocusDecisionPanel
              decision={decision}
              nextObserveAt={resolveNextObserveAt(runs?.summary.nextRunAt, focus.analysisTimes)}
              names={names}
              watchlist={watchlist}
              onFeedbackSaved={() => {
                void refreshWatchlist();
                void loadDecision("GET");
                void refreshTrackingData();
              }}
            />
          ) : decisionLoading ? (
            <LoadingInsight />
          ) : (
            <EmptyDecision message="到达自动分析时间后，这里会显示系统后台生成的今日策略观察。" />
          )}
        </CardContent>
      </Card>

      <CandidateRanking decision={decision} names={names} watchlist={watchlist} history={history} />

      <CollapsiblePanel title="今日关注配置">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        {/* 选股区 */}
        <Card className="performance-card overflow-hidden">
          <CardHeader className="border-b border-border/70 bg-muted/10 p-4">
            <CardTitle className="flex items-center justify-between gap-3">
              <span>今日关注配置</span>
              <span className="text-xs font-normal text-muted-foreground">来自自选股</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            {watchlist.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无自选股，请先在 /watchlist 添加。</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                  <Metric label="自选股" value={watchlist.length} />
                  <Metric label="已关注" value={focus.symbols.length} />
                  <Metric label="剩余" value={Math.max(0, watchlist.length - focus.symbols.length)} />
                </div>
                <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                  {watchlist.map((item) => (
                    <div
                      key={item.symbol}
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleSymbol(item.symbol)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          toggleSymbol(item.symbol);
                        }
                      }}
                      className={cn(
                        "group glow-card glow-click-card flex items-start gap-3 rounded-xl border px-3 py-3 text-left text-sm outline-none transition-all duration-150 hover:-translate-y-px",
                        focus.symbols.includes(item.symbol)
                          ? "glow-click-card-active border-primary/35 bg-primary/10 shadow-sm"
                          : "border-border/70 bg-background/30 hover:border-primary/30 hover:bg-muted/40"
                      )}
                    >
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleSymbol(item.symbol);
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                        className={cn(
                          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-all",
                          focus.symbols.includes(item.symbol) ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background"
                        )}
                        aria-label={`${focus.symbols.includes(item.symbol) ? "取消关注" : "关注"} ${item.symbol}`}
                      >
                        {focus.symbols.includes(item.symbol) ? <Check className="h-3.5 w-3.5" /> : null}
                      </button>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-medium leading-5">{names[item.symbol] || item.symbol}</span>
                          <span className="text-xs tabular-nums text-muted-foreground">{item.symbol}</span>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void toggleHolding(item, !item.isHolding);
                            }}
                            onKeyDown={(event) => event.stopPropagation()}
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                              item.isHolding
                                ? "border-primary/30 bg-primary/10 text-primary"
                                : "border-border bg-muted/40 text-muted-foreground hover:border-primary/25 hover:text-foreground"
                            )}
                          >
                            {item.isHolding ? "已购买" : "未购买"}
                          </button>
                        </span>
                        {item.note ? <span className="mt-1 block truncate text-xs text-muted-foreground">{item.note}</span> : null}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* 时间设置区 */}
        <Card className="performance-card overflow-hidden">
          <CardHeader className="border-b border-border/70 bg-muted/10 p-4">
            <CardTitle>资金与自动分析时间</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 p-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">总本金</label>
              <Input
                type="number"
                step="100"
                min="0"
                value={focus.capital ?? ""}
                onChange={(e) => {
                  setDecision(null);
                  setDecisionError(null);
                  setDecisionNotice(null);
                  setFocus((prev) => ({ ...prev, capital: e.target.value ? Number(e.target.value) : null }));
                }}
                placeholder="例如 100000"
              />
              <p className="text-xs text-muted-foreground">用于 AI 计算首次建仓股数和仓位比例。</p>
            </div>

            <TimeField
              label="每日新闻抓取时间"
              icon={<CalendarClock className="h-4 w-4" />}
              value={focus.newsFetchTime}
              onChange={(value) => setFocus((prev) => ({ ...prev, newsFetchTime: value }))}
            />

            <div className="space-y-2">
              <label className="text-sm font-medium">自动 AI 分析时间</label>
              <div className="flex gap-2">
                <TimeInput value={newTime} onChange={setNewTime} className="flex-1" />
                <Button variant="outline" size="icon" onClick={addAnalysisTime}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {focus.analysisTimes.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {focus.analysisTimes.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs">
                      {t}
                      <button onClick={() => removeAnalysisTime(t)} className="rounded text-muted-foreground hover:text-red-400" aria-label={`删除 ${t}`}>
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">未设置，添加后在这些时间点自动触发 AI 分析。</p>
              )}
            </div>

            <div className="grid gap-2 rounded-md border border-border bg-muted/20 p-3 text-sm">
              <StatusLine label="新闻抓取" value={formatDateTime(focus.lastNewsFetch)} />
              <StatusLine label="AI 分析" value={formatDateTime(focus.lastAnalysis)} />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              {message ? <span className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">{message}</span> : <span className="text-xs text-muted-foreground">修改配置后保存，下一次自动分析会按新设置执行。</span>}
              <Button onClick={save} disabled={saving || !focus.symbols.length} className="min-w-32">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? "保存中" : "保存设置"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
      </CollapsiblePanel>

      {/* 分析结果 */}
      {focus.symbols.length > 0 ? (
        <CollapsiblePanel title="最近分析 / 历史记录">
          <DecisionHistoryTimeline records={history} />
          <div className="mt-4 grid gap-3 xl:grid-cols-3">
            {focus.symbols.map((symbol) => (
              <FocusAnalysisCard key={symbol} symbol={symbol} />
            ))}
          </div>
        </CollapsiblePanel>
      ) : null}

      <CollapsiblePanel title="自动分析任务状态">
        <TaskStatusPanel focus={focus} runs={runs} decisionLoading={decisionLoading} decisionError={decisionError} />
      </CollapsiblePanel>
    </PageContainer>
  );
}

function FocusStatusStrip({
  focus,
  watchlistCount,
  decision,
  runs,
  decisionLoading
}: {
  focus: FocusData;
  watchlistCount: number;
  decision: FocusDecision | null;
  runs: AnalysisRunResponse | null;
  decisionLoading: boolean;
}) {
  const nextObserveAt = resolveNextObserveAt(runs?.summary.nextRunAt, focus.analysisTimes);
  const latestStatus = decisionLoading ? "分析中" : runs?.summary.latestStatus ? taskStatusLabel(runs.summary.latestStatus) : decision ? "已生成" : "待生成";
  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
      <FocusStatusMetric label="今日关注" value={`${focus.symbols.length} / ${watchlistCount}`} hint="已选择 / 自选股" />
      <FocusStatusMetric label="总本金" value={focus.capital ? `¥${Number(focus.capital).toLocaleString("zh-CN")}` : "未填写"} hint="用于仓位和手续费测算" />
      <FocusStatusMetric label="新闻截取" value={formatDateTime(focus.lastNewsFetch)} hint={focus.newsFetchTime ? `每日 ${focus.newsFetchTime}` : "未设置"} />
      <FocusStatusMetric label="下次分析" value={nextObserveAt} hint={focus.analysisTimes.length ? focus.analysisTimes.join("、") : "未设置"} />
      <FocusStatusMetric label="任务状态" value={latestStatus} hint={runs?.summary.runningCount ? `${runs.summary.runningCount} 个运行中` : "后台任务"} />
    </div>
  );
}

function FocusStatusMetric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="glow-card rounded-xl border border-border/70 bg-card/80 px-3 py-2.5 shadow-sm">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{label}</span>
      </div>
      <div className="mt-1 truncate text-sm font-semibold tabular-nums text-foreground">{value}</div>
      <div className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

function DecisionHistoryTimeline({ records }: { records: DecisionHistoryRecord[] }) {
  if (!records.length) {
    return <EmptyDecision message="暂无 AI 决策历史。自动分析或手动重新分析后，这里会按时间线保留记录。" />;
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium">AI 决策历史</div>
        <span className="rounded-full border border-border bg-background/55 px-2.5 py-1 text-xs text-muted-foreground">{records.length} 条</span>
      </div>
      <div className="grid gap-2 xl:grid-cols-2">
        {records.map((record, index) => {
          const reasons = Array.isArray(record.keyReasons) ? record.keyReasons.map(String).slice(0, 3) : [];
          return (
            <div
              key={record.id}
              className={cn(motionClassNames.fadeUp, "glow-card glow-click-card relative rounded-xl border border-border bg-background/35 p-3")}
              style={{ animationDelay: `${staggerDelay(index)}ms` }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-muted-foreground">{formatDateTime(record.decisionTime)} · {runTypeLabel(record.source)}</div>
                  <div className="mt-1 font-semibold">{record.stockName || record.symbol} <span className="text-sm font-normal tabular-nums text-muted-foreground">{record.symbol}</span></div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StrategyBadge tone={historyActionTone(record.action)}>{actionLabel(record.action)}</StrategyBadge>
                  <Badge variant={riskVariant(record.riskLevel)}>{riskLabel(record.riskLevel)}</Badge>
                  {record.confidence !== null ? <Badge variant="secondary">置信度 {Math.round(record.confidence * 100)}%</Badge> : null}
                  {record.fallbackUsed ? <Badge variant="warning">兜底</Badge> : null}
                </div>
              </div>
              <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">{record.summary}</p>
              {record.change ? (
                <div className={cn("mt-2 rounded-md border px-2.5 py-2 text-xs", decisionChangeTone(record.change.status))}>
                  <div className="font-medium">{record.change.summary}</div>
                  {record.change.reasons.length ? (
                    <div className="mt-1 text-muted-foreground">{record.change.reasons.slice(0, 2).join("；")}</div>
                  ) : null}
                </div>
              ) : record.changeSummary ? (
                <div className="mt-2 rounded-md border border-primary/20 bg-primary/10 px-2.5 py-2 text-xs text-primary">{record.changeSummary}</div>
              ) : null}
              {reasons.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {reasons.map((reason) => <span key={reason} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{reason}</span>)}
                </div>
              ) : null}
              <Button asChild variant="outline" size="sm" className="mt-2">
                <Link href={`/stocks/${record.symbol}`}>查看详情</Link>
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyDecision({ message }: { message: string }) {
  return <div className="glow-card rounded-xl border border-dashed border-border bg-background/20 p-4 text-sm text-muted-foreground">{message}</div>;
}

function resolveNextObserveAt(nextRunAt: string | null | undefined, times: string[]) {
  const fromServer = parseFutureDate(nextRunAt);
  if (fromServer) return formatDateTime(fromServer);
  const computed = nextMarketScheduledTime(times);
  return computed ? formatDateTime(computed) : "未设置自动分析时间";
}

function parseFutureDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date <= new Date() ? null : date;
}

function runTypeLabel(value?: string | null) {
  if (value === "scheduled") return "自动";
  if (value === "manual") return "手动";
  return value || "--";
}

function taskStatusLabel(value?: string | null) {
  if (value === "success") return "完成";
  if (value === "failed") return "失败";
  if (value === "running") return "运行中";
  if (value === "queued") return "排队中";
  if (value === "partial") return "部分完成";
  return value || "--";
}

function historyActionTone(action: string): "watch" | "wait" | "avoid" | "bullish" | "neutral" {
  if (action === "avoid" || action === "reduce") return "avoid";
  if (action === "wait_pullback") return "wait";
  if (action === "hold") return "watch";
  return "neutral";
}

function actionLabel(action: string) {
  const map: Record<string, string> = {
    watch: "观察",
    wait_pullback: "等待回调",
    hold: "持有",
    reduce: "减仓",
    avoid: "回避"
  };
  return map[action] ?? action;
}

function riskLabel(risk?: string | null) {
  if (risk === "low") return "低风险";
  if (risk === "high") return "高风险";
  if (risk === "medium") return "中风险";
  return "风险待确认";
}

function riskVariant(risk?: string | null): "success" | "warning" | "danger" | "secondary" {
  if (risk === "low") return "success";
  if (risk === "high") return "danger";
  if (risk === "medium") return "warning";
  return "secondary";
}

function decisionChangeTone(status: "first" | "continued" | "changed") {
  if (status === "changed") return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (status === "continued") return "border-primary/20 bg-primary/10 text-primary";
  return "border-border bg-muted/20 text-muted-foreground";
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="glow-card rounded-lg border border-border bg-muted/20 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function TimeField({ label, icon, value, onChange }: { label: string; icon: ReactNode; value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      <TimeInput value={value} onChange={onChange} icon={icon} />
    </div>
  );
}

function TimeInput({ value, onChange, icon, className }: { value: string; onChange: (value: string) => void; icon?: ReactNode; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
        {icon ?? <Clock3 className="h-4 w-4" />}
      </span>
      <Input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-9 [&::-webkit-calendar-picker-indicator]:opacity-0"
      />
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

function normalizeTimeInput(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
