"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, WalletCards } from "lucide-react";

import { StockIdentity } from "@/components/StockIdentity";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageContainer, SectionHeader } from "@/components/ui/layout";
import { readJsonResponse } from "@/lib/clientApi";
import {
  displaySymbolBase,
  formatFullDateTime,
  formatMoney,
  formatPrice,
  formatShares,
  formatSignedMoney,
  resolveStockDisplayName,
  TRADE_CASH_CHANGE_DESCRIPTION,
  tradeSideLabel
} from "@/lib/trading/display";
import { cn } from "@/lib/utils";

type TradeExecutionRecord = {
  id: string;
  symbol: string;
  name?: string | null;
  side: "buy" | "sell" | string;
  price: number;
  shares: number;
  amount: number;
  fee: number;
  netCashChange: number;
  realizedPnl: number | null;
  executedAt: string;
  note?: string | null;
};

export default function TradesPage() {
  const [executions, setExecutions] = useState<TradeExecutionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/trades?limit=all", { cache: "no-store" });
      const json = await readJsonResponse<{ executions?: TradeExecutionRecord[] }>(response);
      setExecutions(Array.isArray(json.executions) ? json.executions : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "资金流水读取失败。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => summarizeExecutions(executions), [executions]);
  const nameByBase = useMemo(() => {
    const output = new Map<string, string>();
    for (const execution of executions) {
      if (execution.name) output.set(displaySymbolBase(execution.symbol), execution.name);
    }
    return output;
  }, [executions]);

  return (
    <PageContainer>
      <SectionHeader
        title="资金流水"
        action={
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading ? "animate-spin" : "")} />
            刷新
          </Button>
        }
      />

      {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <LedgerStat label="总流水" value={`${executions.length} 笔`} />
        <LedgerStat label="现金净变化" value={formatSignedMoney(summary.netCashChange)} tone={summary.netCashChange >= 0 ? "in" : "out"} />
        <LedgerStat label="现金流入" value={formatMoney(summary.cashIn)} tone="in" />
        <LedgerStat label="现金流出" value={formatMoney(summary.cashOut)} tone="out" />
        <LedgerStat label="手续费合计" value={formatMoney(summary.totalFee)} />
        <LedgerStat label="已实现盈亏" value={formatSignedMoney(summary.realizedPnl)} tone={summary.realizedPnl >= 0 ? "in" : "out"} />
      </div>

      <Card className="performance-card overflow-hidden">
        <CardHeader className="border-b border-border/70 bg-background/25 p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <CardTitle className="flex items-center gap-2">
              <WalletCards className="h-4 w-4 text-primary" />
              全部交易明细
            </CardTitle>
            <div className="grid gap-2 text-xs leading-5 text-muted-foreground md:grid-cols-[1.05fr_1.2fr] xl:max-w-3xl">
              <span className="rounded-lg border border-border bg-background/55 px-3 py-2">{TRADE_CASH_CHANGE_DESCRIPTION}。</span>
              <span className="rounded-lg border border-border bg-background/55 px-3 py-2">已实现盈亏 = 卖出成交额 - 卖出手续费 - 本次卖出对应的持仓成本；持仓成本已包含买入手续费。</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="hidden grid-cols-[150px_minmax(180px,1fr)_70px_100px_100px_92px_120px_116px] gap-3 border-b border-border bg-muted/25 px-4 py-3 text-xs font-medium text-muted-foreground xl:grid">
            <span>成交时间</span>
            <span>标的</span>
            <span>方向</span>
            <span className="text-right">价格 / 数量</span>
            <span className="text-right">成交额</span>
            <span className="text-right">手续费</span>
            <span className="text-right">现金变化</span>
            <span className="text-right">已实现盈亏</span>
          </div>
          {loading && !executions.length ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">正在读取资金流水...</div>
          ) : executions.length ? (
            <div className="divide-y divide-border/70">
              {executions.map((execution) => {
                const stockName = resolveStockDisplayName({
                  symbol: execution.symbol,
                  name: execution.name || nameByBase.get(displaySymbolBase(execution.symbol))
                });
                return (
                  <div key={execution.id} className="grid gap-2 px-4 py-3 text-sm xl:grid-cols-[150px_minmax(180px,1fr)_70px_100px_100px_92px_120px_116px] xl:items-center">
                    <div className="text-xs text-muted-foreground xl:text-sm">{formatFullDateTime(execution.executedAt)}</div>
                    <div className="min-w-0">
                      <StockIdentity symbol={execution.symbol} name={stockName} compact />
                      {execution.note ? <div className="mt-1 truncate text-xs text-muted-foreground">{execution.note}</div> : null}
                    </div>
                    <div className={cn("w-fit rounded-full px-2 py-1 text-xs", execution.side === "buy" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" : "bg-red-500/10 text-red-600 dark:text-red-300")}>
                      {tradeSideLabel(execution.side)}
                    </div>
                    <LedgerValue label="价格 / 数量" value={`${formatPrice(execution.price)} x ${formatShares(execution.shares)}`} />
                    <LedgerValue label="成交额" value={formatMoney(execution.amount)} />
                    <LedgerValue label="手续费" value={formatMoney(execution.fee)} />
                    <LedgerValue label="现金变化" value={formatSignedMoney(execution.netCashChange)} className={execution.netCashChange >= 0 ? "text-red-500" : "text-emerald-500"} />
                    <LedgerValue
                      label="已实现盈亏"
                      value={execution.realizedPnl === null ? "--" : formatSignedMoney(execution.realizedPnl)}
                      className={execution.realizedPnl === null ? "text-muted-foreground" : execution.realizedPnl >= 0 ? "text-red-500" : "text-emerald-500"}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">暂无资金流水，成交反馈或补录买卖后会自动生成。</div>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}

function summarizeExecutions(executions: TradeExecutionRecord[]) {
  return executions.reduce(
    (summary, execution) => {
      const netCashChange = Number.isFinite(execution.netCashChange) ? execution.netCashChange : 0;
      summary.netCashChange += netCashChange;
      summary.totalFee += Number.isFinite(execution.fee) ? execution.fee : 0;
      summary.realizedPnl += Number.isFinite(execution.realizedPnl) ? execution.realizedPnl ?? 0 : 0;
      if (netCashChange > 0) summary.cashIn += netCashChange;
      if (netCashChange < 0) summary.cashOut += Math.abs(netCashChange);
      return summary;
    },
    { cashIn: 0, cashOut: 0, netCashChange: 0, totalFee: 0, realizedPnl: 0 }
  );
}

function LedgerStat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "in" | "out" | "neutral" }) {
  return (
    <div className="glow-card rounded-xl border border-border/70 bg-card/80 px-4 py-3 shadow-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-lg font-semibold tabular-nums", tone === "in" ? "text-red-500" : tone === "out" ? "text-emerald-500" : "text-foreground")}>{value}</div>
    </div>
  );
}

function LedgerValue({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 xl:block xl:text-right">
      <span className="text-xs text-muted-foreground xl:hidden">{label}</span>
      <span className={cn("font-medium tabular-nums text-foreground", className)}>{value}</span>
    </div>
  );
}
