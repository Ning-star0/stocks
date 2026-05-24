"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Activity, BarChart3, Brain, ChevronLeft, ChevronRight, Eye, RefreshCw, Search, Trash2, X } from "lucide-react";

import { AddStockDialog } from "@/components/AddStockDialog";
import { RiskBadge } from "@/components/RiskBadge";
import { StrategyBadge, trendToStrategy } from "@/components/StrategyBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageContainer, SectionHeader } from "@/components/ui/layout";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getPrimaryAdvice, hasUserPosition } from "@/lib/positionAdvice";
import type { AiAnalysisResult } from "@/lib/types";
import { cn, formatNumber, formatPercent, formatPriceValue } from "@/lib/utils";

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
  isHolding?: boolean | null;
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

type RiskBucket = "high" | "medium" | "low";
type ActionCategory = "wait" | "watch" | "avoid" | "none";
type SortKey = "default" | "changeDesc" | "changeAsc" | "riskFirst" | "focusFirst";

type WatchlistRowModel = {
  item: WatchlistItem;
  quote?: QuoteWithStatus;
  latest: LatestAnalysisSummary;
  name: string;
  symbol: string;
  strategy: ReturnType<typeof trendToStrategy>;
  action: ReturnType<typeof normalizeAction>;
  actionCategory: ActionCategory;
  riskBucket: RiskBucket;
  isHolding: boolean;
  hasAnalysis: boolean;
  tags: string[];
  isFocus: boolean;
  isWatch: boolean;
  searchText: string;
  index: number;
};

const DASHBOARD_CLIENT_CACHE_KEY = "stock-ai:dashboard:v2";
const DASHBOARD_CLIENT_CACHE_TTL_MS = 60_000;
const WATCHLIST_PAGE_SIZE = 6;

export function WatchlistTable() {
  const hasLoadedRef = useRef(false);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState<"all" | RiskBucket>("all");
  const [actionFilter, setActionFilter] = useState<"all" | ActionCategory>("all");
  const [holdingFilter, setHoldingFilter] = useState<"all" | "holding" | "watching">("all");
  const [sortKey, setSortKey] = useState<SortKey>("default");
  const [currentPage, setCurrentPage] = useState(1);

  const load = useCallback(async (options: { force?: boolean; silent?: boolean } = {}) => {
    if (hasLoadedRef.current) setRefreshing(true);
    else if (!options.silent) setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/dashboard", {
        cache: options.force ? "no-store" : "default",
        headers: options.force ? { "x-force-refresh": "1" } : undefined
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message ?? "加载自选股失败。");
      setData(json);
      writeClientDashboardCache(json);
      hasLoadedRef.current = true;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载自选股失败。");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const cached = readClientDashboardCache();
    if (cached) {
      setData(cached);
      setLoading(false);
      hasLoadedRef.current = true;
      void load({ silent: true });
      return;
    }
    void load();
  }, [load]);

  const items = useMemo(() => {
    const watchlists = Array.isArray(data?.watchlists) ? data.watchlists : [];
    return watchlists.flatMap((watchlist) => (Array.isArray(watchlist.items) ? watchlist.items : []));
  }, [data]);

  const rows = useMemo(() => buildWatchlistRows(items, data), [items, data]);
  const filteredRows = useMemo(
    () => filterAndSortRows(rows, { search, riskFilter, actionFilter, holdingFilter, sortKey }),
    [rows, search, riskFilter, actionFilter, holdingFilter, sortKey]
  );
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / WATCHLIST_PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pagedRows = useMemo(() => {
    const start = (safeCurrentPage - 1) * WATCHLIST_PAGE_SIZE;
    return filteredRows.slice(start, start + WATCHLIST_PAGE_SIZE);
  }, [filteredRows, safeCurrentPage]);
  const pageStart = filteredRows.length ? (safeCurrentPage - 1) * WATCHLIST_PAGE_SIZE + 1 : 0;
  const pageEnd = Math.min(safeCurrentPage * WATCHLIST_PAGE_SIZE, filteredRows.length);
  const hasAnyFilter = Boolean(search.trim()) || riskFilter !== "all" || actionFilter !== "all" || holdingFilter !== "all" || sortKey !== "default";

  useEffect(() => {
    setCurrentPage(1);
  }, [search, riskFilter, actionFilter, holdingFilter, sortKey]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

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
      await load({ force: true });
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : "创建分析任务失败。");
    } finally {
      setAnalyzing(null);
    }
  }

  async function remove(id: string) {
    const target = rows.find((row) => row.item.id === id);
    if (!window.confirm(`确认从自选股移除 ${target?.name ?? target?.symbol ?? "该标的"} 吗？`)) return;
    setError(null);
    try {
      const response = await fetch(`/api/watchlist/items/${id}`, { method: "DELETE" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message ?? "删除自选股失败。");
      await load({ force: true });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除自选股失败。");
    }
  }

  function clearFilters() {
    setSearch("");
    setRiskFilter("all");
    setActionFilter("all");
    setHoldingFilter("all");
    setSortKey("default");
  }

  return (
    <PageContainer>
      <SectionHeader
        title="自选股"
        description="快速扫读价格、风险和 AI 策略观察；详细理由保留在股票详情页。"
        action={
          <>
            <Button size="sm" variant="outline" onClick={() => load({ force: true })} disabled={loading || refreshing}>
              <RefreshCw className="h-4 w-4" />
              {refreshing ? "刷新中" : "刷新"}
            </Button>
            <AddStockDialog onAdded={() => load({ force: true })} />
          </>
        }
      />

      {data?.dataSource?.isMock ? <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-200">当前为模拟数据，不代表真实行情。</div> : null}
      {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300">{error}</div> : null}
      {notice ? <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-200">{notice}</div> : null}

      <div className="grid gap-3 md:grid-cols-3">
        {(data?.marketIndices ?? defaultMarketIndices()).map((item) => (
          <MarketIndexCard key={item.symbol} item={item} loading={loading && !data} />
        ))}
      </div>

      <Card className="soft-card overflow-hidden">
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <CardTitle>
                策略观察列表
              </CardTitle>
              <p className="mt-2 text-sm text-muted-foreground">
                当前显示 {filteredRows.length} / {rows.length} 只标的，本页 {pageStart}-{pageEnd} 条。
              </p>
            </div>
            {hasAnyFilter ? (
              <Button size="sm" variant="outline" onClick={clearFilters}>
                <X className="h-4 w-4" />
                清除筛选
              </Button>
            ) : null}
          </div>

          <div className="grid gap-2 md:grid-cols-[minmax(220px,1.4fr)_repeat(4,minmax(132px,1fr))]">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索名称或代码" className="pl-9" />
            </label>
            <Select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value as "all" | RiskBucket)}>
              <option value="all">全部风险</option>
              <option value="high">高风险</option>
              <option value="medium">中风险</option>
              <option value="low">低风险</option>
            </Select>
            <Select value={actionFilter} onChange={(event) => setActionFilter(event.target.value as "all" | ActionCategory)}>
              <option value="all">全部动作</option>
              <option value="wait">等待回调</option>
              <option value="watch">继续观察</option>
              <option value="avoid">风险规避</option>
              <option value="none">暂无分析</option>
            </Select>
            <Select value={holdingFilter} onChange={(event) => setHoldingFilter(event.target.value as "all" | "holding" | "watching")}>
              <option value="all">全部持仓</option>
              <option value="holding">已持仓</option>
              <option value="watching">未持仓观察</option>
            </Select>
            <Select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
              <option value="default">默认排序</option>
              <option value="changeDesc">涨跌幅从高到低</option>
              <option value="changeAsc">涨跌幅从低到高</option>
              <option value="riskFirst">风险优先</option>
              <option value="focusFirst">今日需关注优先</option>
            </Select>
          </div>
          <PaginationControls
            currentPage={safeCurrentPage}
            totalPages={totalPages}
            totalItems={filteredRows.length}
            pageStart={pageStart}
            pageEnd={pageEnd}
            onPageChange={setCurrentPage}
          />
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-sm text-muted-foreground">正在加载自选股数据...</div>
          ) : rows.length === 0 ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-md border border-dashed text-center">
              <div className="text-sm font-medium">自选股列表为空。</div>
              <p className="max-w-sm text-sm text-muted-foreground">添加股票代码后即可查看行情、指标、提醒和 AI 分析。</p>
              <AddStockDialog onAdded={load} />
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              没有符合当前筛选条件的标的。
            </div>
          ) : (
            <>
              <div className="hidden lg:block">
                <Table className="table-fixed">
                  <colgroup>
                    <col className="w-[18%]" />
                    <col className="w-[10%]" />
                    <col className="w-[8%]" />
                    <col className="w-[9%]" />
                    <col className="w-[18%]" />
                    <col className="w-[22%]" />
                    <col className="w-[15%]" />
                  </colgroup>
                  <TableHeader>
                    <TableRow>
                      <TableHead>名称 / 代码</TableHead>
                      <TableHead className="text-right">价格</TableHead>
                      <TableHead className="text-right">涨跌幅</TableHead>
                      <TableHead>策略方向</TableHead>
                      <TableHead>状态 / 动作</TableHead>
                      <TableHead>关键理由</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedRows.map((row) => (
                      <TableRow key={row.item.id} className="table-row-focus h-16">
                        <TableCell className="py-2.5">
                          <Link href={`/stocks/${row.symbol}`} className="font-semibold text-primary">
                            {row.name}
                          </Link>
                          <div className="text-xs text-muted-foreground">{row.symbol}</div>
                        </TableCell>
                        <TableCell className="py-2.5 text-right font-medium tabular-nums">
                          {row.quote?.price === null || !row.quote ? (
                            <span className="text-xs text-red-500">{formatQuoteStatus(row.quote?.status)}</span>
                          ) : (
                            formatPriceValue(row.quote.price, { currency: row.quote.currency, symbol: row.quote.symbol })
                          )}
                        </TableCell>
                        <TableCell className={cn("py-2.5 text-right tabular-nums", changeClass(row.quote?.changePct))}>
                          {row.quote?.changePct === null || !row.quote ? "--" : formatPercent(row.quote.changePct)}
                        </TableCell>
                        <TableCell className="py-2.5">
                          <StrategyBadge tone={row.strategy.tone}>{row.strategy.label}</StrategyBadge>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <div className="flex flex-wrap gap-1.5">
                            <RiskBadge risk={riskLabel(row.riskBucket)} />
                            <StrategyBadge tone={row.action.tone}>{row.action.label}</StrategyBadge>
                            <Badge variant={row.isHolding ? "success" : "secondary"}>{row.isHolding ? "已持仓" : "未持仓观察"}</Badge>
                          </div>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <ReasonTags tags={row.tags} fallback={row.item.note ?? "暂无理由"} />
                        </TableCell>
                        <TableCell className="py-2.5">
                          <div className="row-actions flex justify-end gap-1.5">
                            <Button size="sm" variant="ghost" className="px-2" asChild>
                              <Link href={`/stocks/${row.symbol}`}>
                                <Eye className="h-4 w-4" />
                                详情
                              </Link>
                            </Button>
                            <Button size="sm" variant="outline" className="px-2" onClick={() => analyze(row.symbol)} disabled={analyzing === row.symbol}>
                              <Brain className="h-4 w-4" />
                              {analyzing === row.symbol ? "排队中" : "分析"}
                            </Button>
                            <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => remove(row.item.id)} aria-label={`删除 ${row.symbol}`}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="space-y-3 lg:hidden">
                {pagedRows.map((row) => (
                  <div key={row.item.id} className="motion-card-enter rounded-lg border border-border bg-background/50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link href={`/stocks/${row.symbol}`} className="font-semibold text-primary">
                          {row.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">{row.symbol}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-medium tabular-nums">{formatPriceValue(row.quote?.price, { currency: row.quote?.currency, symbol: row.quote?.symbol ?? row.symbol })}</div>
                        <div className={cn("text-xs tabular-nums", changeClass(row.quote?.changePct))}>{formatPercent(row.quote?.changePct)}</div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <StrategyBadge tone={row.strategy.tone}>{row.strategy.label}</StrategyBadge>
                      <RiskBadge risk={riskLabel(row.riskBucket)} />
                      <StrategyBadge tone={row.action.tone}>{row.action.label}</StrategyBadge>
                      <Badge variant={row.isHolding ? "success" : "secondary"}>{row.isHolding ? "已持仓" : "未持仓观察"}</Badge>
                    </div>
                    <div className="mt-3">
                      <ReasonTags tags={row.tags} fallback={row.item.note ?? "暂无理由"} />
                    </div>
                    <div className="mt-3 flex justify-end gap-2">
                      <Button size="sm" variant="ghost" asChild>
                        <Link href={`/stocks/${row.symbol}`}>
                          <Eye className="h-4 w-4" />
                          详情
                        </Link>
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => analyze(row.symbol)} disabled={analyzing === row.symbol}>
                        <Brain className="h-4 w-4" />
                        {analyzing === row.symbol ? "排队中" : "分析"}
                      </Button>
                      <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => remove(row.item.id)} aria-label={`删除 ${row.symbol}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <PaginationControls
                className="mt-4 border-t border-border pt-4"
                currentPage={safeCurrentPage}
                totalPages={totalPages}
                totalItems={filteredRows.length}
                pageStart={pageStart}
                pageEnd={pageEnd}
                onPageChange={setCurrentPage}
              />
            </>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}

function ReasonTags({ tags, fallback }: { tags: string[]; fallback: string }) {
  if (!tags.length) return <span className="text-sm text-muted-foreground">{fallback}</span>;

  const visible = tags.slice(0, 2);
  const hidden = tags.slice(2);
  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map((tag) => (
        <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {tag}
        </span>
      ))}
      {hidden.length ? (
        <span title={hidden.join("、")} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          +{hidden.length}
        </span>
      ) : null}
    </div>
  );
}

function PaginationControls({
  currentPage,
  totalPages,
  totalItems,
  pageStart,
  pageEnd,
  onPageChange,
  className
}: {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageStart: number;
  pageEnd: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  if (totalItems <= WATCHLIST_PAGE_SIZE) return null;

  return (
    <div className={cn("flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between", className)}>
      <div className="tabular-nums">
        第 {pageStart}-{pageEnd} 条 / 共 {totalItems} 条
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
        >
          <ChevronLeft className="h-4 w-4" />
          上一页
        </Button>
        <span className="min-w-16 text-center tabular-nums">
          {currentPage} / {totalPages}
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage >= totalPages}
        >
          下一页
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function readClientDashboardCache(): DashboardResponse | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(DASHBOARD_CLIENT_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: number; data?: DashboardResponse };
    if (!parsed.savedAt || Date.now() - parsed.savedAt > DASHBOARD_CLIENT_CACHE_TTL_MS) return null;
    return parsed.data ?? null;
  } catch {
    return null;
  }
}

function writeClientDashboardCache(data: DashboardResponse) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      DASHBOARD_CLIENT_CACHE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        data
      })
    );
  } catch {
    // Browser storage is best effort; server cache remains the source of truth.
  }
}

function MarketIndexCard({ item, loading }: { item: MarketIndexItem; loading: boolean }) {
  const quote = item.quote;
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
            <div className={cn("text-sm tabular-nums", changeClass(quote?.changePct))}>{loading ? "--" : formatPercent(quote?.changePct)}</div>
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

function buildWatchlistRows(items: WatchlistItem[], data: DashboardResponse | null): WatchlistRowModel[] {
  return items.map((item, index) => {
    const quote = data?.quotes[item.symbol];
    const latest = data?.latestAnalyses[item.symbol] ?? null;
    const analysis = latest?.outputJson;
    const primaryAdvice = getPrimaryAdvice(analysis, item);
    const isHolding = hasUserPosition(item);
    const strategy = trendToStrategy(analysis?.trend);
    const action = normalizeAction(primaryAdvice.action, primaryAdvice.isHolding);
    const hasAnalysis = Boolean(analysis);
    const actionCategory = classifyAction(action, hasAnalysis);
    const riskBucket = classifyRisk(item, analysis, actionCategory);
    const tags = reasonTags(analysis, primaryAdvice.reason);
    const isFocus = riskBucket === "high" || actionCategory === "wait" || actionCategory === "avoid" || analysis?.trend === "bearish";
    const isWatch = actionCategory === "watch" && riskBucket !== "high";
    const name = quote?.name ?? item.symbol;
    return {
      item,
      quote,
      latest,
      name,
      symbol: item.symbol,
      strategy,
      action,
      actionCategory,
      riskBucket,
      isHolding,
      hasAnalysis,
      tags,
      isFocus,
      isWatch,
      searchText: `${name} ${item.symbol}`.toLowerCase(),
      index
    };
  });
}

function filterAndSortRows(
  rows: WatchlistRowModel[],
  filters: {
    search: string;
    riskFilter: "all" | RiskBucket;
    actionFilter: "all" | ActionCategory;
    holdingFilter: "all" | "holding" | "watching";
    sortKey: SortKey;
  }
) {
  const keyword = filters.search.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (keyword && !row.searchText.includes(keyword)) return false;
    if (filters.riskFilter !== "all" && row.riskBucket !== filters.riskFilter) return false;
    if (filters.actionFilter !== "all" && row.actionCategory !== filters.actionFilter) return false;
    if (filters.holdingFilter === "holding" && !row.isHolding) return false;
    if (filters.holdingFilter === "watching" && row.isHolding) return false;
    return true;
  });

  return [...filtered].sort((a, b) => {
    if (filters.sortKey === "changeDesc") return sortableChange(b) - sortableChange(a);
    if (filters.sortKey === "changeAsc") return sortableChange(a) - sortableChange(b);
    if (filters.sortKey === "riskFirst") return riskRank(a.riskBucket) - riskRank(b.riskBucket) || a.index - b.index;
    if (filters.sortKey === "focusFirst") return Number(b.isFocus) - Number(a.isFocus) || a.index - b.index;
    return a.index - b.index;
  });
}

function normalizeAction(action?: string, isHolding?: boolean): { label: string; tone: "watch" | "wait" | "avoid" | "bullish" | "neutral" } {
  const text = action || "";
  if (/回避|止损|减仓|离场|不建议/.test(text)) return { label: "风险规避", tone: "avoid" };
  if (/等待|回调|观察|观望/.test(text)) return { label: "等待回调", tone: "wait" };
  if (/加仓|增持|持有/.test(text)) return { label: isHolding ? "持仓跟踪" : "谨慎追踪", tone: "watch" };
  if (/入场|建仓|买入|试探/.test(text)) return { label: "谨慎追踪", tone: "bullish" };
  return { label: isHolding ? "持仓跟踪" : "继续观察", tone: "neutral" };
}

function classifyAction(action: ReturnType<typeof normalizeAction>, hasAnalysis: boolean): ActionCategory {
  if (!hasAnalysis) return "none";
  if (action.tone === "avoid") return "avoid";
  if (action.tone === "wait") return "wait";
  return "watch";
}

function classifyRisk(item: WatchlistItem, analysis: AiAnalysisResult | undefined, actionCategory: ActionCategory): RiskBucket {
  const text = `${item.riskLevel} ${(analysis?.riskFactors ?? []).join(" ")} ${analysis?.summary ?? ""}`.toLowerCase();
  if (analysis?.trend === "bearish" || actionCategory === "avoid" || /high|高风险|风险较高|偏高/.test(text)) return "high";
  if (/low|低风险|风险较低/.test(text)) return "low";
  return "medium";
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
  return [...new Set(tags)];
}

function riskRank(risk: RiskBucket) {
  return { high: 0, medium: 1, low: 2 }[risk];
}

function sortableChange(row: WatchlistRowModel) {
  return row.quote?.changePct ?? Number.NEGATIVE_INFINITY;
}

function riskLabel(risk: RiskBucket) {
  return { high: "高风险", medium: "中风险", low: "低风险" }[risk];
}

function changeClass(changePct?: number | null) {
  if (changePct === null || changePct === undefined) return "text-muted-foreground";
  return changePct >= 0 ? "text-red-500" : "text-emerald-500";
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
