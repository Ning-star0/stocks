"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Brain, RefreshCw, Trash2 } from "lucide-react";

import { AddStockDialog } from "@/components/AddStockDialog";
import { RiskBadge } from "@/components/RiskBadge";
import { StockCard } from "@/components/StockCard";
import { TrendBadge } from "@/components/TrendBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AiAnalysisResult } from "@/lib/types";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";

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
  timeHorizon: string;
  riskLevel: string;
};

type DashboardResponse = {
  dataSource?: { quoteProvider: string; isMock: boolean };
  quotes: Record<string, QuoteWithStatus>;
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

  const items = useMemo(() => data?.watchlists.flatMap((watchlist) => watchlist.items) ?? [], [data]);

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
      if (json.fromCache) setNotice(`${symbol} 的缓存分析仍有效。`);
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
      if (!response.ok) throw new Error(json.error?.message ?? "删除股票失败。");
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除股票失败。");
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">看板</h1>
          <p className="mt-1 text-sm text-muted-foreground">本系统仅用于研究和辅助分析，不构成投资建议。</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
          <AddStockDialog onAdded={load} />
        </div>
      </div>

      {data?.dataSource?.isMock ? <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">当前为模拟数据，不代表真实行情。</div> : null}
      {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div> : null}
      {notice ? <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{notice}</div> : null}

      <div className="grid gap-3 md:grid-cols-3">
        {items.slice(0, 3).map((item) => {
          const quote = data?.quotes[item.symbol];
          const latest = data?.latestAnalyses[item.symbol];
          return (
            <StockCard
              key={item.id}
              symbol={item.symbol}
              name={quote?.name}
              price={quote?.price ?? null}
              currency={quote?.currency}
              changePercent={quote?.changePct ?? null}
              volume={quote?.volume ?? null}
              trend={latest?.outputJson.trend}
              summary={latest?.outputJson.summary}
            />
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>自选股</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-sm text-muted-foreground">正在加载市场数据...</div>
          ) : items.length === 0 ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-md border border-dashed text-center">
              <div className="text-sm font-medium">自选股列表为空。</div>
              <p className="max-w-sm text-sm text-muted-foreground">添加股票代码后即可查看行情、指标、提醒和 AI 分析。</p>
              <AddStockDialog onAdded={load} />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称 / 代码</TableHead>
                  <TableHead>价格</TableHead>
                  <TableHead>涨跌幅</TableHead>
                  <TableHead>成交量</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>趋势</TableHead>
                  <TableHead>风险</TableHead>
                  <TableHead>备注 / AI 摘要</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const quote = data?.quotes[item.symbol];
                  const latest = data?.latestAnalyses[item.symbol];
                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Link href={`/stocks/${item.symbol}`} className="font-semibold text-primary">
                          {quote?.name ?? item.symbol}
                        </Link>
                        <div className="text-xs text-muted-foreground">{item.symbol}</div>
                      </TableCell>
                      <TableCell className="font-medium tabular-nums">
                        {quote?.price === null || !quote ? <span className="text-xs text-red-400">{formatQuoteStatus(quote?.status)}</span> : formatCurrency(quote.price, quote.currency)}
                      </TableCell>
                      <TableCell className={quote?.changePct === null || !quote ? "tabular-nums text-muted-foreground" : quote.changePct >= 0 ? "tabular-nums text-emerald-500" : "tabular-nums text-red-500"}>
                        {quote?.changePct === null || !quote ? "--" : formatPercent(quote.changePct)}
                      </TableCell>
                      <TableCell className="tabular-nums">{quote?.volume === null || !quote ? "--" : formatNumber(quote.volume)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatQuoteStatus(quote?.status)}</TableCell>
                      <TableCell>
                        <TrendBadge trend={latest?.outputJson.trend} />
                      </TableCell>
                      <TableCell>
                        <RiskBadge risk={item.riskLevel} />
                      </TableCell>
                      <TableCell className="max-w-[360px] truncate text-muted-foreground">{latest?.outputJson.summary ?? item.note ?? "暂无 AI 分析"}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatQuoteStatus(status?: string) {
  const map: Record<string, string> = {
    normal: "正常",
    cached: "缓存",
    stale: "旧行情",
    unavailable: "不可用",
    error: "行情错误"
  };
  return status ? map[status] ?? status : "不可用";
}
