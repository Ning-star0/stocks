"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Search, X } from "lucide-react";

import { AddStockDialog } from "@/components/AddStockDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageContainer, SectionHeader } from "@/components/ui/layout";
import { Select } from "@/components/ui/select";
import { MarketIndexCard } from "@/components/watchlist/MarketIndexCard";
import {
  buildWatchlistRows,
  defaultMarketIndices,
  filterAndSortRows,
  WATCHLIST_PAGE_SIZE
} from "@/components/watchlist/model";
import { PaginationControls } from "@/components/watchlist/PaginationControls";
import { WatchlistRows } from "@/components/watchlist/WatchlistRows";
import { WatchlistSkeleton } from "@/components/watchlist/WatchlistSkeleton";
import type { ActionCategory, DashboardResponse, RiskBucket, SortKey } from "@/components/watchlist/types";
import { readJsonResponse } from "@/lib/clientApi";

const DASHBOARD_CLIENT_CACHE_KEY = "stock-ai:dashboard:v2";
const DASHBOARD_CLIENT_CACHE_TTL_MS = 60_000;

export function WatchlistTable() {
  const hasLoadedRef = useRef(false);
  const openQuoteRefreshRef = useRef(false);
  const refreshTimerRef = useRef<number | null>(null);
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
  const deferredSearch = useDeferredValue(search);

  const load = useCallback(async (options: { force?: boolean; silent?: boolean } = {}) => {
    if (hasLoadedRef.current && !options.silent) setRefreshing(true);
    else if (!options.silent) setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/dashboard", {
        cache: options.force ? "no-store" : "default",
        headers: options.force ? { "x-force-refresh": "1" } : undefined
      });
      const json = await readJsonResponse<DashboardResponse>(response);
      setData(json);
      writeClientDashboardCache(json);
      hasLoadedRef.current = true;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载自选股失败。");
    } finally {
      setLoading(false);
      if (!options.silent) setRefreshing(false);
    }
  }, []);

  const refreshQuotes = useCallback(async (options: { once?: boolean; background?: boolean } = {}) => {
    if (options.once && openQuoteRefreshRef.current) return;
    if (options.once) openQuoteRefreshRef.current = true;
    if (!options.background) setRefreshing(true);
    try {
      const response = await fetch("/api/quotes/refresh", {
        method: "POST",
        cache: "no-store"
      });
      if (!response.ok) throw new Error("刷新行情失败。");
      await load({ force: true, silent: true });
    } catch {
      await load({ force: true, silent: true });
    } finally {
      if (!options.background) setRefreshing(false);
    }
  }, [load]);

  useEffect(() => {
    function scheduleOpeningQuoteRefresh() {
      refreshTimerRef.current = window.setTimeout(() => {
        void refreshQuotes({ once: true, background: true });
      }, 700);
    }

    const cached = readClientDashboardCache();
    if (cached) {
      setData(cached);
      setLoading(false);
      hasLoadedRef.current = true;
      scheduleOpeningQuoteRefresh();
      return () => {
        if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      };
    }
    void load().then(scheduleOpeningQuoteRefresh);
    return () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
    };
  }, [load, refreshQuotes]);

  const items = useMemo(() => {
    const watchlists = Array.isArray(data?.watchlists) ? data.watchlists : [];
    return watchlists.flatMap((watchlist) => (Array.isArray(watchlist.items) ? watchlist.items : []));
  }, [data]);

  const rows = useMemo(() => buildWatchlistRows(items, data), [items, data]);
  const filteredRows = useMemo(
    () => filterAndSortRows(rows, { search: deferredSearch, riskFilter, actionFilter, holdingFilter, sortKey }),
    [rows, deferredSearch, riskFilter, actionFilter, holdingFilter, sortKey]
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
      const json = await readJsonResponse<{ fromCache?: boolean; jobId?: string }>(response);
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
      await readJsonResponse(response);
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
            <Button size="sm" variant="outline" onClick={() => refreshQuotes()} disabled={loading || refreshing}>
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

      <div className="watchlist-scroll-surface grid gap-3 md:grid-cols-3">
        {(data?.marketIndices ?? defaultMarketIndices()).map((item) => (
          <MarketIndexCard key={item.symbol} item={item} loading={loading && !data} />
        ))}
      </div>

      <Card className="performance-card watchlist-scroll-surface overflow-hidden">
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
            <WatchlistSkeleton />
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
              <WatchlistRows rows={pagedRows} analyzing={analyzing} onAnalyze={analyze} onRemove={remove} />
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
