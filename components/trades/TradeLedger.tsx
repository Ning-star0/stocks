"use client";

import { useMemo, useState } from "react";
import { Filter, Search, Trash2, WalletCards } from "lucide-react";

import { StockIdentity } from "@/components/StockIdentity";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { TradeExecutionRecord } from "@/components/trades/types";
import {
  displaySymbolBase,
  formatFullDateTime,
  formatMoney,
  formatPrice,
  formatShares,
  formatSignedMoney,
  resolveStockDisplayName,
  tradeSideLabel
} from "@/lib/trading/display";
import { cn } from "@/lib/utils";

type TradeSideFilter = "all" | "buy" | "sell";

export function TradeLedger({ executions, deletingId, onDelete }: {
  executions: TradeExecutionRecord[];
  deletingId: string | null;
  onDelete: (execution: TradeExecutionRecord) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [sideFilter, setSideFilter] = useState<TradeSideFilter>("all");
  const filteredExecutions = useMemo(() => filterExecutions(executions, { search, sideFilter }), [executions, search, sideFilter]);
  const nameByBase = useMemo(() => {
    const output = new Map<string, string>();
    for (const execution of executions) if (execution.name) output.set(displaySymbolBase(execution.symbol), execution.name);
    return output;
  }, [executions]);

  return (
    <Card className="performance-card overflow-hidden">
      <CardHeader className="gap-3 border-b border-border/70 bg-background/25 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <WalletCards className="h-4 w-4 text-primary" />
            成交流水
          </CardTitle>
          <span className="text-xs tabular-nums text-muted-foreground">{filteredExecutions.length} / {executions.length} 笔</span>
        </div>
        <div className="grid gap-2 md:grid-cols-[minmax(220px,1fr)_180px]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索名称、代码或备注" className="pl-9" />
          </label>
          <label className="relative">
            <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Select value={sideFilter} onChange={(event) => setSideFilter(event.target.value as TradeSideFilter)} className="pl-9">
              <option value="all">全部方向</option>
              <option value="buy">只看买入</option>
              <option value="sell">只看卖出</option>
            </Select>
          </label>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="hidden grid-cols-[145px_minmax(170px,1fr)_64px_100px_100px_84px_112px_112px_40px] gap-3 border-b border-border bg-muted/25 px-4 py-3 text-xs font-medium text-muted-foreground xl:grid">
          <span>成交时间</span><span>标的</span><span>方向</span><span className="text-right">价格 / 数量</span><span className="text-right">成交额</span><span className="text-right">手续费</span><span className="text-right">现金变化</span><span className="text-right">已实现盈亏</span><span />
        </div>
        {filteredExecutions.length ? (
          <div className="divide-y divide-border/70">
            {filteredExecutions.map((execution) => {
              const stockName = resolveStockDisplayName({ symbol: execution.symbol, name: execution.name || nameByBase.get(displaySymbolBase(execution.symbol)) });
              return (
                <div key={execution.id} className="grid gap-2 px-4 py-3 text-sm xl:grid-cols-[145px_minmax(170px,1fr)_64px_100px_100px_84px_112px_112px_40px] xl:items-center">
                  <div className="text-xs text-muted-foreground xl:text-sm">{formatFullDateTime(execution.executedAt)}</div>
                  <div className="min-w-0">
                    <StockIdentity symbol={execution.symbol} name={stockName} compact />
                    {execution.note ? <div className="mt-1 truncate text-xs text-muted-foreground" title={execution.note}>{execution.note}</div> : null}
                  </div>
                  <div className={cn("w-fit rounded-md px-2 py-1 text-xs", execution.side === "buy" ? "bg-red-500/10 text-red-600 dark:text-red-300" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300")}>{tradeSideLabel(execution.side)}</div>
                  <LedgerValue label="价格 / 数量" value={`${formatPrice(execution.price)} x ${formatShares(execution.shares)}`} />
                  <LedgerValue label="成交额" value={formatMoney(execution.amount)} />
                  <LedgerValue label="手续费" value={formatMoney(execution.fee)} />
                  <LedgerValue label="现金变化" value={formatSignedMoney(execution.netCashChange)} className={execution.netCashChange >= 0 ? "text-red-500" : "text-emerald-500"} />
                  <LedgerValue label="已实现盈亏" value={execution.realizedPnl === null ? "--" : formatSignedMoney(execution.realizedPnl)} className={execution.realizedPnl === null ? "text-muted-foreground" : execution.realizedPnl >= 0 ? "text-red-500" : "text-emerald-500"} />
                  <Button type="button" size="icon" variant="ghost" onClick={() => void onDelete(execution)} disabled={deletingId === execution.id} title="删除这笔成交" aria-label={`删除 ${execution.symbol} ${tradeSideLabel(execution.side)}记录`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        ) : executions.length ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">没有符合当前筛选条件的流水。</div>
        ) : (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">暂无成交记录。</div>
        )}
      </CardContent>
    </Card>
  );
}

function filterExecutions(executions: TradeExecutionRecord[], filters: { search: string; sideFilter: TradeSideFilter }) {
  const keyword = filters.search.trim().toLowerCase();
  return executions.filter((execution) => {
    if (filters.sideFilter !== "all" && execution.side !== filters.sideFilter) return false;
    if (!keyword) return true;
    return [execution.symbol, execution.name, execution.note, tradeSideLabel(execution.side), formatFullDateTime(execution.executedAt)].filter(Boolean).join(" ").toLowerCase().includes(keyword);
  });
}

function LedgerValue({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 xl:block xl:text-right">
      <span className="text-xs text-muted-foreground xl:hidden">{label}</span>
      <span className={cn("font-medium tabular-nums text-foreground", className)}>{value}</span>
    </div>
  );
}
