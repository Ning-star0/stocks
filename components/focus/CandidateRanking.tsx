"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import Link from "next/link";

import { StockIdentity } from "@/components/StockIdentity";
import { StrategyBadge } from "@/components/StrategyBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DecisionHistoryRecord, FocusDecision, StockItem } from "@/components/focus/types";
import { motionClassNames, staggerDelay } from "@/lib/motion";
import { displaySymbolBase, formatMoney } from "@/lib/trading/display";
import { calculateTradingFee } from "@/lib/trading/rules";
import { cn } from "@/lib/utils";

type CandidateSortKey = "rank" | "confidence" | "profit";

export function CandidateRanking({
  decision,
  names,
  watchlist,
  history
}: {
  decision: FocusDecision | null;
  names: Record<string, string>;
  watchlist: StockItem[];
  history: DecisionHistoryRecord[];
}) {
  const [sortKey, setSortKey] = useState<CandidateSortKey>("rank");
  const items = useMemo(() => decision?.ranking ?? [], [decision?.ranking]);
  const rows = useMemo(() => {
    const watchMap = new Map(watchlist.flatMap((item) => symbolVariantsForUi(item.symbol).map((symbol) => [symbol, item] as const)));
    const historyMap = new Map(history.flatMap((item) => symbolVariantsForUi(item.symbol).map((symbol) => [symbol, item] as const)));
    const buyOrderMap = new Map((decision?.orders ?? []).flatMap((order) => symbolVariantsForUi(order.symbol).map((symbol) => [symbol, order] as const)));
    const sellOrderMap = new Map((decision?.sellOrders ?? []).flatMap((order) => symbolVariantsForUi(order.symbol).map((symbol) => [symbol, order] as const)));
    const normalized = items.map((item) => {
      const watch = watchMap.get(item.symbol.toUpperCase());
      const latestHistory = historyMap.get(item.symbol.toUpperCase());
      const buyOrder = buyOrderMap.get(item.symbol.toUpperCase());
      const sellOrder = sellOrderMap.get(item.symbol.toUpperCase());
      const latestAnalysis = watch?.latestAnalysis?.outputJson;
      const price = watch?.quote?.price ?? null;
      const holdingPrice = watch?.holdingPrice ?? null;
      const holdingShares = watch?.holdingShares ?? null;
      const pnl = calculateHoldingPnl({
        isHolding: Boolean(watch?.isHolding),
        price,
        holdingPrice,
        holdingShares
      });
      return {
        ...item,
        name: names[item.symbol] || watch?.name || item.symbol,
        status: sellOrder ? (sellOrder.action === "sell" ? "卖出" : "减仓") : buyOrder ? (buyOrder.action === "add" ? "增持" : "买入") : normalizeRankingView(item.view),
        trend: trendLabel(latestHistory?.strategyDirection || latestAnalysis?.trend || ""),
        confidence: latestHistory?.confidence ?? latestAnalysis?.confidence ?? null,
        pnl,
        risk: extractRiskText(item.reason),
        actionTone: sellOrder ? "avoid" as const : buyOrder ? "bullish" as const : rankingTone(item.view)
      };
    });
    return normalized.sort((a, b) => {
      if (sortKey === "confidence") return (b.confidence ?? -1) - (a.confidence ?? -1) || a.rank - b.rank;
      if (sortKey === "profit") return (pnlSortValue(b.pnl) - pnlSortValue(a.pnl)) || a.rank - b.rank;
      return a.rank - b.rank;
    });
  }, [decision?.orders, decision?.sellOrders, history, items, names, sortKey, watchlist]);

  return (
    <Card className="performance-card overflow-hidden">
      <CardHeader className="flex-row items-center justify-between gap-3 border-b border-border/70 bg-muted/10 p-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <CardTitle>候选标的排序</CardTitle>
          <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">
            {rows.length} 只
          </span>
          <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">
            盈亏含估算买卖手续费
          </span>
        </div>
        {items.length ? (
          <div className="glow-card flex rounded-xl border border-border bg-muted/20 p-1 text-xs">
            <SortButton active={sortKey === "rank"} onClick={() => setSortKey("rank")}>默认</SortButton>
            <SortButton active={sortKey === "confidence"} onClick={() => setSortKey("confidence")}>置信度</SortButton>
            <SortButton active={sortKey === "profit"} onClick={() => setSortKey("profit")}>持仓盈亏</SortButton>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="p-4">
        {rows.length ? (
          <div className="glow-card overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-muted/25 text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left font-medium">标的名称</th>
                  <th className="px-3 py-3 text-left font-medium">状态</th>
                  <th className="px-3 py-3 text-left font-medium">趋势</th>
                  <th className="px-3 py-3 text-right font-medium">置信度</th>
                  <th className="px-3 py-3 text-right font-medium">持仓盈亏</th>
                  <th className="px-3 py-3 text-left font-medium">关键风险</th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item, index) => (
                  <tr key={`${item.symbol}-${item.rank}`} className={cn(motionClassNames.fadeUp, "border-b border-border/70 last:border-0 hover:bg-primary/5")} style={{ animationDelay: `${staggerDelay(index)}ms` }}>
                    <td className="px-4 py-3">
                      <StockIdentity symbol={item.symbol} name={item.name} prefix={`#${item.rank}`} compact />
                    </td>
                    <td className="px-3 py-3">
                      <StrategyBadge tone={item.actionTone}>{item.status}</StrategyBadge>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{item.trend}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatConfidenceValue(item.confidence)}</td>
                    <td className={cn("px-3 py-3 text-right tabular-nums", profitClass(item.pnl?.amount ?? item.pnl?.rate))}>
                      <div>{formatPnlAmount(item.pnl?.amount)}</div>
                      <div className="mt-0.5 text-xs opacity-75">{formatProfit(item.pnl?.rate)}</div>
                    </td>
                    <td className="max-w-[280px] px-3 py-3">
                      <div className="line-clamp-2 text-xs leading-5 text-muted-foreground">{item.risk}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/stocks/${item.symbol}`}>查看详情</Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyDecision message="暂无候选排序。到达自动分析时间或点击重新分析后，这里会展示关注标的的排序和动作。" />
        )}
      </CardContent>
    </Card>
  );
}

function SortButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("glow-card glow-click-card rounded-lg px-2.5 py-1.5 transition-colors", active ? "glow-click-card-active bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
    >
      {children}
    </button>
  );
}

function EmptyDecision({ message }: { message: string }) {
  return <div className="glow-card rounded-xl border border-dashed border-border bg-background/20 p-4 text-sm text-muted-foreground">{message}</div>;
}

function symbolVariantsForUi(symbol: string) {
  const normalized = symbol.toUpperCase();
  const base = displaySymbolBase(normalized);
  if (!/^\d{6}$/.test(base)) return [normalized];
  return [normalized, base, `${base}.SH`, `${base}.SZ`, `${base}.BJ`];
}

function trendLabel(value: string) {
  if (value === "bullish") return "偏多";
  if (value === "bearish") return "偏空";
  if (value === "neutral") return "中性";
  if (value === "watch") return "观察";
  return "--";
}

function formatConfidenceValue(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return `${Math.round(value * 100)}%`;
}

function formatProfit(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatPnlAmount(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${formatMoney(value)}`;
}

function profitClass(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "text-muted-foreground";
  return value >= 0 ? "text-red-500" : "text-emerald-500";
}

function pnlSortValue(value?: { amount: number | null; rate: number | null } | null) {
  if (!value) return Number.NEGATIVE_INFINITY;
  if (value.amount !== null && Number.isFinite(value.amount)) return value.amount;
  if (value.rate !== null && Number.isFinite(value.rate)) return value.rate;
  return Number.NEGATIVE_INFINITY;
}

function calculateHoldingPnl(input: {
  isHolding: boolean;
  price?: number | null;
  holdingPrice?: number | null;
  holdingShares?: number | null;
}) {
  const { isHolding, price, holdingPrice, holdingShares } = input;
  if (!isHolding || !price || !holdingPrice || price <= 0 || holdingPrice <= 0) return null;
  if (!holdingShares || holdingShares <= 0) {
    return {
      amount: null,
      rate: Number((((price - holdingPrice) / holdingPrice) * 100).toFixed(2)),
      buyFee: null,
      estimatedSellFee: null
    };
  }
  const buyAmount = holdingPrice * holdingShares;
  const currentAmount = price * holdingShares;
  const buyFee = calculateTradingFee(buyAmount);
  const estimatedSellFee = calculateTradingFee(currentAmount);
  const totalCost = buyAmount + buyFee;
  const netValue = currentAmount - estimatedSellFee;
  const amount = Number((netValue - totalCost).toFixed(2));
  const rate = totalCost > 0 ? Number(((amount / totalCost) * 100).toFixed(2)) : null;
  return { amount, rate, buyFee, estimatedSellFee };
}

function normalizeRankingView(view: string) {
  if (/卖出|减仓|止损|止盈|离场/.test(view)) return "减仓/卖出";
  if (/回避|风险/.test(view)) return "回避";
  if (/等待|回调/.test(view)) return "等待回调";
  if (/观察|观望/.test(view)) return "观察";
  if (/买|优先|偏多/.test(view)) return "观察";
  return view || "观察";
}

function extractRiskText(text: string) {
  const segments = text.split(/[。；;，,]/).map((item) => item.trim()).filter(Boolean);
  return segments.find((item) => /风险|回调|高|弱|不足|失败|波动|追高|止损/.test(item)) ?? "需结合价格、量能和新闻变化复核。";
}

function rankingTone(view: string): "watch" | "wait" | "avoid" | "bullish" | "neutral" {
  if (/回避|风险|卖出|减仓|止损|止盈|离场/.test(view)) return "avoid";
  if (/等待|观察/.test(view)) return "wait";
  if (/优先|偏多/.test(view)) return "bullish";
  return "watch";
}
