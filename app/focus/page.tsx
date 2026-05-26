"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, Check, CheckCircle2, Clock3, Loader2, Plus, Save, Sparkles, Trash2, WalletCards } from "lucide-react";

import { CollapsiblePanel } from "@/components/CollapsiblePanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LoadingInsight, PageContainer, SectionHeader, StatCard } from "@/components/ui/layout";
import { StrategyBadge } from "@/components/StrategyBadge";
import { motionClassNames, staggerDelay } from "@/lib/motion";
import { cn } from "@/lib/utils";

type FocusData = {
  name: string;
  symbols: string[];
  capital: number | null;
  newsFetchTime: string;
  analysisTimes: string[];
  lastNewsFetch: string | null;
  lastAnalysis: string | null;
};

type StockItem = {
  id: string;
  symbol: string;
  name?: string;
  note?: string | null;
  isHolding?: boolean | null;
  holdingPrice?: number | null;
  positionOpenedAt?: string | null;
};

type FocusDecision = {
  summary: string;
  recommendedAction: "buy" | "wait";
  capital: number;
  totalBudgetToUse: number;
  totalEstimatedFee: number;
  totalEstimatedCost: number;
  cashReserve: number;
  fallbackReason?: string | null;
  fromCache?: boolean;
  stale?: boolean;
  generatedAt?: string;
  persistedAt?: string;
  scheduledFor?: string | null;
  source?: string;
  notification?: {
    skipped?: boolean;
    reason?: string;
    sentAt?: string;
    provider?: string;
    error?: string;
  } | null;
  orders: Array<{
    symbol: string;
    name?: string | null;
    action: "buy" | "watch" | "avoid";
    amount: number;
    shares: number;
    estimatedPrice: number | null;
    estimatedFee: number;
    totalCost: number;
    reason: string;
    riskControl: string;
    invalidIf: string;
  }>;
  ranking: Array<{ symbol: string; rank: number; view: string; reason: string }>;
  disclaimer: string;
};

type AnalysisRunResponse = {
  summary: {
    nextRunAt: string | null;
    todayRunCount: number;
    runningCount: number;
    latestRunId: string | null;
    latestRunType: string | null;
    latestStatus: string;
    latestStartedAt: string | null;
    latestFinishedAt: string | null;
    latestDurationMs: number | null;
    successCount: number;
    failedCount: number;
    totalSymbols: number;
    fallbackCount: number;
    latestFallbackUsed: boolean;
    latestErrorSummary: string | null;
    latestMetrics: RunMetrics;
    concurrency?: {
      jobWorkers: number;
      focusStockAnalysis: number;
      quoteRequests: number;
    };
  };
  runs: AnalysisRunItem[];
};

type RunMetrics = {
  totalItemDurationMs: number;
  aiDurationMs: number;
  quoteDurationMs: number;
  newsDurationMs: number;
  averageItemDurationMs: number | null;
  runningItems: number;
};

type AnalysisRunItem = {
  id: string;
  runType: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  totalSymbols: number;
  successCount: number;
  failedCount: number;
  fallbackUsed: boolean;
  errorSummary: string | null;
  metrics: RunMetrics;
  items: Array<{
    id: string;
    symbol: string;
    stockName: string | null;
    status: string;
    aiStatus: string | null;
    quoteStatus: string | null;
    newsStatus: string | null;
    errorMessage: string | null;
    durationMs: number | null;
    aiDurationMs: number | null;
    quoteDurationMs: number | null;
    newsDurationMs: number | null;
    fallbackUsed: boolean;
  }>;
};

type DecisionHistoryRecord = {
  id: string;
  symbol: string;
  stockName: string | null;
  decisionTime: string;
  source: string;
  strategyDirection: string;
  action: string;
  riskLevel: string | null;
  confidence: number | null;
  summary: string;
  keyReasons: unknown;
  fallbackUsed: boolean;
  changeSummary: string | null;
  change?: {
    status: "first" | "continued" | "changed";
    summary: string;
    actionChange: string | null;
    strategyChange: string | null;
    riskChange: string | null;
    confidenceChange: string | null;
    reasons: string[];
  };
};

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
      fetch("/api/watchlist").then((response) => readJsonResponse<{ watchlists?: Array<{ items?: Array<{ id: string; symbol: string; note?: string | null; isHolding?: boolean | null; holdingPrice?: number | null; positionOpenedAt?: string | null; quote?: { name?: string | null } | null }> }>; items?: Array<{ id: string; symbol: string; note?: string | null; isHolding?: boolean | null; holdingPrice?: number | null; positionOpenedAt?: string | null; quote?: { name?: string | null } | null }> }>(response))
    ])
      .then(async ([focusData, wlData]) => {
        setFocus((prev) => ({ ...prev, ...focusData }));
        const rawItems = Array.isArray(wlData.watchlists)
          ? wlData.watchlists.flatMap((watchlist: { items?: Array<{ id: string; symbol: string; note?: string | null; isHolding?: boolean | null; holdingPrice?: number | null; positionOpenedAt?: string | null; quote?: { name?: string | null } | null }> }) => watchlist.items ?? [])
          : wlData.items || [];
        const items = rawItems.map((item: { id: string; symbol: string; note?: string | null; isHolding?: boolean | null; holdingPrice?: number | null; positionOpenedAt?: string | null; quote?: { name?: string | null } | null }) => ({
          id: item.id,
          symbol: item.symbol,
          name: item.quote?.name ?? undefined,
          note: item.note,
          isHolding: item.isHolding ?? false,
          holdingPrice: item.holdingPrice ?? null,
          positionOpenedAt: item.positionOpenedAt ?? null
        }));
        setWatchlist(items);
        setNames(Object.fromEntries(items.filter((item: StockItem) => item.name).map((item: StockItem) => [item.symbol, item.name as string])));
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
        description="先看今天的 AI 策略观察，再管理关注标的和自动分析时间。今日关注用于从自选股中筛选少量重点标的，减少无效消耗。"
      />

      <Card id="decision" className="soft-card">
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              今日 AI 策略观察
            </CardTitle>
            <p className="mt-2 text-sm text-muted-foreground">读取最近一次自动分析保存的策略观察；按钮用于手动重新分析。</p>
          </div>
          <Button onClick={generateDecision} disabled={decisionLoading || !focus.symbols.length || !focus.capital}>
            {decisionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <WalletCards className="h-4 w-4" />}
            {decisionLoading ? "分析中" : "重新分析"}
          </Button>
        </CardHeader>
        <CardContent>
          {decisionError ? <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{decisionError}</div> : null}
          {decisionNotice ? <div className="mb-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">{decisionNotice}</div> : null}
          {!focus.capital ? (
            <EmptyDecision message="先填写总本金，AI 才能计算计划买入金额、保留现金和手续费。" />
          ) : !focus.symbols.length ? (
            <EmptyDecision message="先在下方选择今日关注标的，系统会在自动分析时间生成策略观察。" />
          ) : decision ? (
            <FocusDecisionPanel decision={decision} nextObserveAt={resolveNextObserveAt(runs?.summary.nextRunAt, focus.analysisTimes)} />
          ) : decisionLoading ? (
            <LoadingInsight />
          ) : (
            <EmptyDecision message="到达自动分析时间后，这里会显示系统后台生成的今日策略观察。" />
          )}
        </CardContent>
      </Card>

      <TaskStatusPanel focus={focus} runs={runs} decisionLoading={decisionLoading} decisionError={decisionError} />

      <CandidateRanking decision={decision} names={names} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        {/* 选股区 */}
        <Card className="soft-card">
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3">
              <span>今日关注配置</span>
              <span className="text-xs font-normal text-muted-foreground">来自自选股</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
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
                      className={cn(
                        "group flex items-start gap-3 rounded-md border px-3 py-3 text-sm transition-all duration-150 hover:-translate-y-px",
                        focus.symbols.includes(item.symbol)
                          ? "border-primary/35 bg-primary/10 shadow-sm"
                          : "border-border/70 bg-background/30 hover:border-primary/30 hover:bg-muted/40"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSymbol(item.symbol)}
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
                            onClick={() => toggleHolding(item, !item.isHolding)}
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
        <Card className="soft-card">
          <CardHeader>
            <CardTitle>资金与自动分析时间</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
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
    </PageContainer>
  );
}

function FocusDecisionPanel({ decision, nextObserveAt }: { decision: FocusDecision; nextObserveAt: string }) {
  const shouldBuy = decision.recommendedAction === "buy" && decision.orders.length > 0;
  const actionLabel = shouldBuy ? "形成观察买入计划" : "等待 / 暂不行动";
  return (
    <div className="space-y-4">
      {decision.fallbackReason ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-200">{decision.fallbackReason}</div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {decision.generatedAt ? <span>生成时间：{formatDateTime(decision.generatedAt)}</span> : null}
        {decision.scheduledFor ? <span>计划时间：{formatDateTime(decision.scheduledFor)}</span> : null}
        {decision.persistedAt ? <span>保存时间：{formatDateTime(decision.persistedAt)}</span> : null}
        {decision.source === "scheduled" ? <Badge variant="success">定时决策</Badge> : null}
        {decision.fromCache ? <Badge variant="secondary">已保存决策</Badge> : <Badge variant="success">最新决策</Badge>}
        {decision.stale ? <Badge variant="secondary">配置已变化</Badge> : null}
        <NotificationBadge notification={decision.notification} />
      </div>
      {decision.notification ? <NotificationStatus notification={decision.notification} /> : null}
      <div className={cn("rounded-xl border p-5", shouldBuy ? "border-primary/25 bg-primary/12" : "border-amber-500/35 bg-amber-50/70 text-foreground dark:bg-amber-500/10")}>
        <div className="flex flex-wrap items-center gap-2">
          <StrategyBadge tone={shouldBuy ? "bullish" : "wait"}>今日结论：{shouldBuy ? "形成观察买入计划" : "不建议买入"}</StrategyBadge>
          <StrategyBadge tone={shouldBuy ? "watch" : "wait"}>当前动作：{actionLabel}</StrategyBadge>
          <Badge variant="secondary">下一次观察：{nextObserveAt}</Badge>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 dark:text-muted-foreground">核心原因：{decision.summary}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <StatCard label="计划买入" value={formatMoney(decision.totalBudgetToUse)} tone={shouldBuy ? "success" : "neutral"} delayIndex={0} />
        <StatCard label="预计手续费" value={formatMoney(decision.totalEstimatedFee)} delayIndex={1} />
        <StatCard label="保留现金" value={formatMoney(decision.cashReserve)} delayIndex={2} />
        <StatCard label="总本金" value={formatMoney(decision.capital)} delayIndex={3} />
      </div>
      {decision.orders.length ? (
        <div className="grid gap-3 xl:grid-cols-2">
          {decision.orders.map((order) => (
            <div key={order.symbol} className="rounded-md border border-border bg-background/30 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{order.name || order.symbol}</div>
                  <div className="mt-1 text-xs tabular-nums text-muted-foreground">{order.symbol}</div>
                </div>
                <Badge variant="success">买入</Badge>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <DecisionNumber label="数量" value={`${order.shares} 股/份`} />
                <DecisionNumber label="参考价" value={formatMoney(order.estimatedPrice)} />
                <DecisionNumber label="成交金额" value={formatMoney(order.amount)} />
                <DecisionNumber label="手续费" value={formatMoney(order.estimatedFee)} />
                <DecisionNumber label="总成本" value={formatMoney(order.totalCost)} className="col-span-2" />
              </div>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">{order.reason}</p>
              {order.riskControl ? <p className="mt-2 text-xs leading-5 text-muted-foreground">风控：{order.riskControl}</p> : null}
              {order.invalidIf ? <p className="mt-1 text-xs leading-5 text-amber-700 dark:text-amber-300">失效：{order.invalidIf}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
      <p className="border-t border-border pt-3 text-xs text-muted-foreground">{decision.disclaimer}</p>
    </div>
  );
}

function NotificationBadge({ notification }: { notification?: FocusDecision["notification"] }) {
  if (!notification) return <Badge variant="secondary">推送状态待确认</Badge>;
  if (!notification.skipped) return <Badge variant="success">已推送手机</Badge>;
  return <Badge variant="secondary">未推送：{notificationReasonLabel(notification.reason)}</Badge>;
}

function NotificationStatus({ notification }: { notification: NonNullable<FocusDecision["notification"]> }) {
  if (!notification.skipped) {
    return (
      <div className="rounded-md border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary">
        手机推送已发送{notification.provider ? `（${notification.provider}）` : ""}：{formatDateTime(notification.sentAt)}
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
      本次未推送：{notificationReasonLabel(notification.reason)}
      {notification.error ? `。${notification.error}` : ""}
    </div>
  );
}

function EmptyDecision({ message }: { message: string }) {
  return <div className="rounded-md border border-dashed border-border bg-background/20 p-4 text-sm text-muted-foreground">{message}</div>;
}

function TaskStatusPanel({
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <StatusMetric label="自动任务" value={enabled ? "已启用" : "未启用"} tone={enabled ? "success" : "warning"} />
          <StatusMetric label="下一次 AI 分析" value={runs?.summary.nextRunAt ? formatDateTime(runs.summary.nextRunAt) : nextAnalysisLabel(focus.analysisTimes)} />
          <StatusMetric label="今日已执行" value={`${runs?.summary.todayRunCount ?? 0} 次`} />
          <StatusMetric label="最近状态" value={latestStatus} tone={latestTone} />
          <StatusMetric label="成功 / 失败" value={`${successCount} / ${failedCount}`} tone={failedCount > 0 ? "warning" : "success"} />
          <StatusMetric label="兜底触发" value={`${runs?.summary.fallbackCount ?? 0} 次`} tone={(runs?.summary.fallbackCount ?? 0) > 0 ? "warning" : "success"} />
          <StatusMetric label="队列 / 手动并发" value={concurrency ? `${concurrency.jobWorkers} / ${concurrency.focusStockAnalysis}` : "--"} />
        </div>

        {latest ? (
          <div className="rounded-xl border border-border bg-background/35 p-4">
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
                <div className="overflow-hidden rounded-md border border-border">
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

function CandidateRanking({ decision, names }: { decision: FocusDecision | null; names: Record<string, string> }) {
  const items = decision?.ranking ?? [];
  return (
    <Card className="soft-card">
      <CardHeader>
        <CardTitle>候选标的排序</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {items.slice(0, 6).map((item, index) => (
              <div
                key={`${item.symbol}-${item.rank}`}
                className={cn(motionClassNames.cardEnter, motionClassNames.hoverLift, "rounded-lg border border-border bg-muted/15 p-3 text-sm")}
                style={{ animationDelay: `${staggerDelay(index)}ms` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">#{item.rank}</div>
                    <div className="mt-1 truncate font-semibold">{names[item.symbol] || item.symbol}</div>
                    <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">{item.symbol}</div>
                  </div>
                  <StrategyBadge tone={rankingTone(item.view)}>{normalizeRankingView(item.view)}</StrategyBadge>
                </div>
                <p className="mt-3 line-clamp-3 text-xs leading-5 text-muted-foreground">排序原因：{item.reason}</p>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-amber-700 dark:text-amber-300">关键风险：{extractRiskText(item.reason)}</p>
                <Button asChild variant="outline" size="sm" className="mt-3 w-full">
                  <Link href={`/stocks/${item.symbol}`}>查看详情</Link>
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyDecision message="暂无候选排序。到达自动分析时间或点击重新分析后，这里会展示关注标的的排序和动作。" />
        )}
      </CardContent>
    </Card>
  );
}

function DecisionHistoryTimeline({ records }: { records: DecisionHistoryRecord[] }) {
  if (!records.length) {
    return <EmptyDecision message="暂无 AI 决策历史。自动分析或手动重新分析后，这里会按时间线保留记录。" />;
  }
  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">AI 决策历史</div>
      <div className="space-y-3">
        {records.map((record, index) => {
          const reasons = Array.isArray(record.keyReasons) ? record.keyReasons.map(String).slice(0, 3) : [];
          return (
            <div
              key={record.id}
              className={cn(motionClassNames.fadeUp, "relative rounded-lg border border-border bg-background/35 p-4")}
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
              <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted-foreground">{record.summary}</p>
              {record.change ? (
                <div className={cn("mt-2 rounded-md border px-3 py-2 text-xs", decisionChangeTone(record.change.status))}>
                  <div className="font-medium">{record.change.summary}</div>
                  {record.change.reasons.length ? (
                    <div className="mt-1 text-muted-foreground">{record.change.reasons.slice(0, 2).join("；")}</div>
                  ) : null}
                </div>
              ) : record.changeSummary ? (
                <div className="mt-2 rounded-md border border-primary/20 bg-primary/10 px-3 py-2 text-xs text-primary">{record.changeSummary}</div>
              ) : null}
              {reasons.length ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {reasons.map((reason) => <span key={reason} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{reason}</span>)}
                </div>
              ) : null}
              <Button asChild variant="outline" size="sm" className="mt-3">
                <Link href={`/stocks/${record.symbol}`}>查看详情</Link>
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
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
    <div className={cn("rounded-lg border px-3 py-3", toneClass)}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function nextAnalysisLabel(times: string[]) {
  const next = nextAnalysisDate(times);
  return next ? formatRelativeDateTime(next) : "未设置";
}

function resolveNextObserveAt(nextRunAt: string | null | undefined, times: string[]) {
  const fromServer = parseFutureDate(nextRunAt);
  if (fromServer) return formatDateTime(fromServer);
  const computed = nextAnalysisDate(times);
  return computed ? formatDateTime(computed) : "未设置自动分析时间";
}

function parseFutureDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date <= new Date() ? null : date;
}

function nextAnalysisDate(times: string[]) {
  if (!times.length) return null;
  const now = new Date();
  const sorted = [...new Set(times)].filter(Boolean).sort();
  for (let offset = 0; offset <= 14; offset += 1) {
    const date = new Date(now);
    date.setDate(now.getDate() + offset);
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    for (const time of sorted) {
      const [hour = "0", minute = "0"] = time.split(":");
      const candidate = new Date(date);
      candidate.setHours(Number(hour), Number(minute), 0, 0);
      if (candidate > now) return candidate;
    }
  }
  return null;
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

function normalizeRankingView(view: string) {
  if (/回避|风险/.test(view)) return "回避";
  if (/等待|回调/.test(view)) return "等待回调";
  if (/观察|观望/.test(view)) return "观察";
  if (/买|优先|偏多/.test(view)) return "观察";
  return view || "观察";
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

function notificationReasonLabel(value?: string | null) {
  const map: Record<string, string> = {
    manual_source: "手动分析不自动推送",
    fallback_decision: "兜底决策不推送",
    no_budget: "没有计划买入金额",
    no_orders: "没有形成交易计划",
    disabled: "推送未启用或配置不完整",
    deduped: "同一分析时间已推送过",
    send_failed: "发送失败"
  };
  return value ? map[value] ?? value : "未满足推送条件";
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

function decisionChangeTone(status: "first" | "continued" | "changed") {
  if (status === "changed") return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (status === "continued") return "border-primary/20 bg-primary/10 text-primary";
  return "border-border bg-muted/20 text-muted-foreground";
}

function formatDuration(value?: number | null) {
  if (!value) return "--";
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function extractRiskText(text: string) {
  const segments = text.split(/[。；;，,]/).map((item) => item.trim()).filter(Boolean);
  return segments.find((item) => /风险|回调|高|弱|不足|失败|波动|追高|止损/.test(item)) ?? "需结合价格、量能和新闻变化复核。";
}

function rankingTone(view: string): "watch" | "wait" | "avoid" | "bullish" | "neutral" {
  if (/回避|风险/.test(view)) return "avoid";
  if (/等待|观察/.test(view)) return "wait";
  if (/优先|偏多/.test(view)) return "bullish";
  return "watch";
}

function DecisionNumber({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("rounded-md border border-border bg-muted/20 px-3 py-2", className)}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium tabular-nums">{value}</div>
    </div>
  );
}

function formatMoney(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 }).format(value);
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
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

function FocusAnalysisCard({ symbol }: { symbol: string }) {
  const [analysis, setAnalysis] = useState<{ summary?: string; trend?: string; confidence?: number; holdAdvice?: { action?: string; reason?: string }; entryAdvice?: { action?: string; reason?: string } } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/stocks/${symbol}/analysis/latest`)
      .then((response) => readJsonResponse<{ outputJson?: typeof analysis; analysis?: { outputJson?: typeof analysis } }>(response))
      .then((data) => {
        setAnalysis(data.outputJson ?? data.analysis?.outputJson ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [symbol]);

  if (loading) {
    return (
      <div className="flex min-h-36 items-center gap-2 rounded-md border border-border bg-background/30 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {symbol} 加载中
      </div>
    );
  }
  if (!analysis) {
    return (
      <div className="min-h-36 rounded-md border border-dashed border-border bg-background/20 p-4 text-sm text-muted-foreground">
        <div className="font-medium text-foreground">{symbol}</div>
        <p className="mt-2 leading-6">暂无分析。保存配置后，等待下一个自动分析时间触发。</p>
      </div>
    );
  }

  const trend = getTrendMeta(analysis.trend);
  const confidence = Math.round((analysis.confidence ?? 0) * 100);
  const summary = makeFriendlySummary(analysis.summary);

  return (
    <div className="flex min-h-48 flex-col rounded-md border border-border bg-background/30 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold tabular-nums">{symbol}</div>
          <div className="mt-1 text-xs text-muted-foreground">置信度 {confidence}%</div>
        </div>
        <Badge variant={trend.variant}>{trend.label}</Badge>
      </div>
      <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">{summary}</p>
      <div className="mt-4 space-y-2 border-t border-border pt-3 text-sm">
        {analysis.holdAdvice?.action ? <AdviceLine label="持仓" value={analysis.holdAdvice.action} /> : null}
        {analysis.entryAdvice?.action ? <AdviceLine label="入场" value={analysis.entryAdvice.action} /> : null}
      </div>
    </div>
  );
}

function AdviceLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function getTrendMeta(trend?: string): { label: string; variant: "success" | "warning" | "danger" | "secondary" } {
  if (trend === "bullish") return { label: "偏强", variant: "success" };
  if (trend === "bearish") return { label: "偏弱", variant: "danger" };
  if (trend === "neutral") return { label: "中性", variant: "warning" };
  return { label: "待确认", variant: "secondary" };
}

function makeFriendlySummary(summary?: string) {
  if (!summary) return "暂无摘要。";
  if (summary.includes("AI 服务请求失败") || summary.includes("API 连接失败") || summary.includes("This operation was aborted")) {
    return "AI 服务暂时不可用，当前结果为本地规则生成的临时分析。服务恢复后建议重新分析。";
  }
  return summary.replace(/\s*本分析截至\s*\d{4}-\d{2}-\d{2}T\S+/g, "").trim();
}

async function readJsonResponse<T = unknown>(response: Response): Promise<T> {
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(`接口返回了非 JSON 响应（HTTP ${response.status}）：${summarizeNonJson(text)}`);
  }

  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`接口 JSON 解析失败（HTTP ${response.status}）：${summarizeNonJson(text)}`);
  }

  if (!response.ok) {
    throw new Error(apiErrorMessage(payload) ?? `请求失败（HTTP ${response.status}）`);
  }
  return payload as T;
}

function apiErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const error = (payload as { error?: unknown }).error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : null;
  }
  return null;
}

function summarizeNonJson(text: string) {
  const summary = text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return summary ? summary.slice(0, 180) : "空响应";
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
