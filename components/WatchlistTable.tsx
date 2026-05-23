"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, BarChart3, Brain, RefreshCw, Trash2 } from "lucide-react";

import { AddStockDialog } from "@/components/AddStockDialog";
import { RiskBadge } from "@/components/RiskBadge";
import { StrategyBadge, trendToStrategy } from "@/components/StrategyBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageContainer, SectionHeader, StatCard } from "@/components/ui/layout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getPrimaryAdvice, hasUserPosition } from "@/lib/positionAdvice";
import type { AiAnalysisResult } from "@/lib/types";
import { formatNumber, formatPercent, formatPriceValue } from "@/lib/utils";

type QuoteWithStatus = {
  symbol: string;
  name?: string | null;
  price: number | null;
  changePct: number | null;
  volume: number | null;
  currency: "USD" | "CNY" | "HKD";
  updatedAt: string | null;
  source: string;
  status: "normal" | "cached" | "stale" | "unavailable" | "error";
  error?: string;
  isMock: boolean;
};

type LatestAnalysisSummary = {
  id: string;
  createdAt: string;
  outputJson: AiAnalysisResult;
} | null;

type WatchlistItem = {
  id: string;
  symbol: string;
  market: string;
  note?: string | null;
  holdingPrice?: number | null;
  positionOpenedAt?: string | null;
  timeHorizon: string;
  riskLevel: string;
};

type MarketIndexItem = {
  symbol: string;
  name: string;
  quote: QuoteWithStatus | null;
};

type DashboardResponse = {
  dataSource?: { quoteProvider: string; isMock: boolean };
  quotes: Record<string, QuoteWithStatus>;
  marketIndices?: MarketIndexItem[];
  latestAnalyses: Record<string, LatestAnalysisSummary>;
  watchlists: Array<{
    id: string;
    name: string;
    items: WatchlistItem[];
  }>;
};

export function WatchlistTable() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message ?? "加载自选股失败。");
      setData(json);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载自选股失败。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const items = useMemo(() => {
    const watchlists = Array.isArray(data?.watchlists) ? data.watchlists : [];
    return watchlists.flatMap((watchlist) => (Array.isArray(watchlist.items) ? watchlist.items : []));
  }, [data]);

  const summary = useMemo(() => buildWatchlistSummary(items, data), [items, data]);

  async function analyze(symbol: string) {
    setAnalyzing(symbol);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/stocks/${symbol}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceRefresh: false })
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message ?? "创建分析任务失败。");
      if (json.fromCache) setNotice(`${symbol} 的缓存分析仍然有效。`);
      else if (json.jobId) setNotice(`${symbol} 的分析任务已加入后台队列。`);
      await load();
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : "创建分析任务失败。");
    } finally {
      setAnalyzing(null);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      const response = await fetch(`/api/watchlist/items/${id}`, { method: "DELETE" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message ?? "删除自选股失败。");
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除自选股失败。");
    }
  }

  return (
    <PageContainer>
      <SectionHeader
        title="自选股"
        description="快速扫读价格、风险和 AI 策略观察；详细理由保留在股票详情页。"
        action={
          <>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
          <AddStockDialog onAdded={load} />
          </>
        }
      />

      {data?.dataSource?.isMock ? <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">当前为模拟数据，不代表真实行情。</div> : null}
      {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div> : null}
      {notice ? <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{notice}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="今日需关注" value={summary.focusCount} hint="偏空、高风险或等待回调" tone="warning" delayIndex={0} />
        <StatCard label="高风险" value={summary.highRiskCount} hint="风险等级或 AI 风险提示" tone="danger" delayIndex={1} />
        <StatCard label="建议等待" value={summary.waitCount} hint="等待回调或继续观察" tone="warning" delayIndex={2} />
        <StatCard label="可继续观察" value={summary.watchCount} hint="中性/偏多但未触发" tone="success" delayIndex={3} />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {(data?.marketIndices ?? defaultMarketIndices()).map((item) => (
          <MarketIndexCard key={item.symbol} item={item} loading={loading && !data} />
        ))}
      </div>

      <Card className="soft-card overflow-hidden">
        <CardHeader>
          <CardTitle>策略观察列表</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-sm text-muted-foreground">正在加载自选股数据...</div>
          ) : items.length === 0 ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-md border border-dashed text-center">
              <div className="text-sm font-medium">自选股列表为空。</div>
              <p className="max-w-sm text-sm text-muted-foreground">添加股票代码后即可查看行情、指标、提醒和 AI 分析。</p>
              <AddStockDialog onAdded={load} />
            </div>
          ) : (
            <>
            <div className="hidden lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称 / 代码</TableHead>
                  <TableHead>价格</TableHead>
                  <TableHead>涨跌幅</TableHead>
                  <TableHead>策略方向</TableHead>
                  <TableHead>风险</TableHead>
                  <TableHead>当前动作</TableHead>
                  <TableHead>关键理由</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const quote = data?.quotes[item.symbol];
                  const latest = data?.latestAnalyses[item.symbol];
                  const primaryAdvice = getPrimaryAdvice(latest?.outputJson, item);
                  const isHolding = hasUserPosition(item);
                  const strategy = trendToStrategy(latest?.outputJson.trend);
                  const action = normalizeAction(primaryAdvice.action, primaryAdvice.isHolding);
                  const tags = reasonTags(latest?.outputJson, primaryAdvice.reason);
                  return (
                    <TableRow key={item.id} className="table-row-focus">
                      <TableCell className="py-3">
                        <Link href={`/stocks/${item.symbol}`} className="font-semibold text-primary">
                          {quote?.name ?? item.symbol}
                        </Link>
                        <div className="text-xs text-muted-foreground">{item.symbol}</div>
                      </TableCell>
                      <TableCell className="py-3 font-medium tabular-nums">
                        {quote?.price === null || !quote ? (
                          <span className="text-xs text-red-400">{formatQuoteStatus(quote?.status)}</span>
                        ) : (
                          formatPriceValue(quote.price, { currency: quote.currency, symbol: quote.symbol })
                        )}
                      </TableCell>
                      <TableCell className={quote?.changePct === null || !quote ? "py-3 tabular-nums text-muted-foreground" : quote.changePct >= 0 ? "py-3 tabular-nums text-red-500" : "py-3 tabular-nums text-emerald-500"}>
                        {quote?.changePct === null || !quote ? "--" : formatPercent(quote.changePct)}
                      </TableCell>
                      <TableCell>
                        <StrategyBadge tone={strategy.tone}>{strategy.label}</StrategyBadge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <RiskBadge risk={item.riskLevel} />
                          <Badge variant={isHolding ? "success" : "secondary"}>{isHolding ? "持仓跟踪" : "未持仓观察"}</Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <StrategyBadge tone={action.tone}>{action.label}</StrategyBadge>
                      </TableCell>
                      <TableCell className="max-w-[260px]">
                        <div className="flex flex-wrap gap-1.5">
                          {tags.length ? tags.map((tag) => <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{tag}</span>) : <span className="text-sm text-muted-foreground">{item.note ?? "暂无分析"}</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="row-actions flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => analyze(item.symbol)} disabled={analyzing === item.symbol}>
                            <Brain className="h-4 w-4" />
                            {analyzing === item.symbol ? "排队中" : "分析"}
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => remove(item.id)} aria-label={`删除 ${item.symbol}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </div>
            <div className="space-y-3 lg:hidden">
              {items.map((item) => {
                const quote = data?.quotes[item.symbol];
                const latest = data?.latestAnalyses[item.symbol];
                const primaryAdvice = getPrimaryAdvice(latest?.outputJson, item);
                const strategy = trendToStrategy(latest?.outputJson.trend);
                const action = normalizeAction(primaryAdvice.action, primaryAdvice.isHolding);
                return (
                  <div key={item.id} className="motion-card-enter rounded-lg border border-border bg-background/50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link href={`/stocks/${item.symbol}`} className="font-semibold text-primary">{quote?.name ?? item.symbol}</Link>
                        <div className="text-xs text-muted-foreground">{item.symbol}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-medium tabular-nums">{formatPriceValue(quote?.price, { currency: quote?.currency, symbol: quote?.symbol ?? item.symbol })}</div>
                        <div className={quote?.changePct && quote.changePct >= 0 ? "text-xs text-red-500" : "text-xs text-emerald-500"}>{formatPercent(quote?.changePct)}</div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <StrategyBadge tone={strategy.tone}>{strategy.label}</StrategyBadge>
                      <StrategyBadge tone={action.tone}>{action.label}</StrategyBadge>
                      <RiskBadge risk={item.riskLevel} />
                    </div>
                  </div>
                );
              })}
            </div>
            </>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}

function MarketIndexCard({ item, loading }: { item: MarketIndexItem; loading: boolean }) {
  const quote = item.quote;
  const changeClass = quote?.changePct === null || !quote ? "text-muted-foreground" : quote.changePct >= 0 ? "text-red-500" : "text-emerald-500";
  const href = `/stocks/${quote?.symbol ?? item.symbol}`;

  return (
    <Link href={href}>
      <Card className="soft-card motion-hover-lift h-full transition-all hover:border-primary/40">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <div className="flex items-start gap-2">
            <BarChart3 className="mt-0.5 h-4 w-4 text-primary" />
            <div>
              <CardTitle>{item.name}</CardTitle>
              <div className="mt-1 text-xs text-muted-foreground">{item.symbol}</div>
            </div>
          </div>
          <span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">{formatQuoteStatus(quote?.status)}</span>
        </CardHeader>
        <CardContent className="space-y-2">
          <div>
            <div className="text-xl font-semibold tabular-nums">{loading ? "--" : formatPriceValue(quote?.price, { symbol: quote?.symbol ?? item.symbol, unit: "point" })}</div>
            <div className={`text-sm tabular-nums ${changeClass}`}>{loading ? "--" : formatPercent(quote?.changePct)}</div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Activity className="h-3.5 w-3.5" />
            成交量 {loading ? "--" : formatNumber(quote?.volume)}
          </div>
          <p className="text-xs text-muted-foreground">{quote?.updatedAt ? `更新时间 ${new Date(quote.updatedAt).toLocaleString("zh-CN")}` : "大盘指数"}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

function buildWatchlistSummary(items: WatchlistItem[], data: DashboardResponse | null) {
  let highRiskCount = 0;
  let waitCount = 0;
  let watchCount = 0;
  for (const item of items) {
    const analysis = data?.latestAnalyses[item.symbol]?.outputJson;
    const advice = getPrimaryAdvice(analysis, item);
    const action = normalizeAction(advice.action, advice.isHolding);
    const riskText = `${item.riskLevel} ${analysis?.riskFactors?.join(" ") ?? ""}`.toLowerCase();
    if (/high|高|风险/.test(riskText) || analysis?.trend === "bearish") highRiskCount += 1;
    if (action.tone === "wait" || action.tone === "avoid") waitCount += 1;
    if (action.tone === "watch" || analysis?.trend === "neutral" || analysis?.trend === "bullish") watchCount += 1;
  }
  return {
    highRiskCount,
    waitCount,
    watchCount,
    focusCount: Math.min(items.length, highRiskCount + waitCount + Math.max(0, watchCount - waitCount))
  };
}

function normalizeAction(action?: string, isHolding?: boolean): { label: string; tone: "watch" | "wait" | "avoid" | "bullish" | "neutral" } {
  const text = action || "";
  if (/回避|止损|减仓|离场|不建议/.test(text)) return { label: "风险规避", tone: "avoid" };
  if (/等待|回调|观察|观望/.test(text)) return { label: "等待回调", tone: "wait" };
  if (/加仓|增持|持有/.test(text)) return { label: isHolding ? "持仓跟踪" : "谨慎追踪", tone: "watch" };
  if (/入场|建仓|买入|试探/.test(text)) return { label: "谨慎追踪", tone: "bullish" };
  return { label: isHolding ? "持仓跟踪" : "继续观察", tone: "neutral" };
}

function reasonTags(analysis?: AiAnalysisResult | null, fallback?: string) {
  const text = `${analysis?.summary ?? ""} ${(analysis?.riskFactors ?? []).join(" ")} ${fallback ?? ""}`;
  const rules: Array<[RegExp, string]> = [
    [/RSI|超买|超卖/i, "RSI 信号"],
    [/MACD|金叉|死叉/i, "MACD 变化"],
    [/成交量|放量|缩量|量能/i, "量能变化"],
    [/回调|支撑|压力/i, "等待价位"],
    [/政策|海外|宏观/i, "宏观风险"],
    [/趋势|均线|布林/i, "趋势观察"]
  ];
  const tags = rules.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
  return [...new Set(tags)].slice(0, 3);
}

function defaultMarketIndices(): MarketIndexItem[] {
  return [
    { symbol: "000001.SH", name: "上证指数", quote: null },
    { symbol: "399001.SZ", name: "深证成指", quote: null },
    { symbol: "000688.SH", name: "科创50", quote: null }
  ];
}

function formatQuoteStatus(status?: string) {
  const map: Record<string, string> = {
    normal: "实时",
    cached: "缓存",
    stale: "旧行情",
    unavailable: "不可用",
    error: "行情错误"
  };
  return status ? map[status] ?? status : "不可用";
}
