"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";

import { TradeEntryPanel } from "@/components/trades/TradeEntryPanel";
import { TradeLedger } from "@/components/trades/TradeLedger";
import { PortfolioOverview, PortfolioRiskDashboard, TradePerformanceDashboard } from "@/components/trades/TradePerformanceDashboard";
import type { TradeExecutionRecord, TradesApiResponse } from "@/components/trades/types";
import { Button } from "@/components/ui/button";
import { PageContainer, SectionHeader } from "@/components/ui/layout";
import { readJsonResponse } from "@/lib/clientApi";
import { tradeSideLabel } from "@/lib/trading/display";
import { cn } from "@/lib/utils";

export default function TradesPage() {
  const [data, setData] = useState<TradesApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [entryOpen, setEntryOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/trades?limit=all", { cache: "no-store" });
      setData(await readJsonResponse<TradesApiResponse>(response));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "交易数据读取失败。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function saved(message: string) {
    setNotice(message);
    await load();
  }

  async function deleteExecution(execution: TradeExecutionRecord) {
    if (!window.confirm(`删除 ${execution.symbol} 的${tradeSideLabel(execution.side)}记录？持仓和全部后续盈亏会重新计算。`)) return;
    setDeletingId(execution.id);
    setError(null);
    try {
      const response = await fetch(`/api/trades?id=${encodeURIComponent(execution.id)}`, { method: "DELETE" });
      await readJsonResponse(response);
      setNotice(`${execution.symbol} 成交记录已删除，持仓与绩效已重算。`);
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "成交记录删除失败。");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <PageContainer>
      <SectionHeader
        eyebrow="交易复盘"
        title="交易中心"
        action={
          <>
            <Button size="sm" variant="outline" onClick={() => setEntryOpen((value) => !value)} disabled={!data?.instruments.length}>
              <Plus className="h-4 w-4" />
              录入成交
            </Button>
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading} title="刷新交易数据">
              <RefreshCw className={cn("h-4 w-4", loading ? "animate-spin" : "")} />
              刷新
            </Button>
          </>
        }
      />

      {error ? <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div> : null}
      {notice ? <div className="rounded-md border border-primary/25 bg-primary/8 px-4 py-3 text-sm text-foreground">{notice}</div> : null}

      {entryOpen && data ? <TradeEntryPanel instruments={data.instruments} onClose={() => setEntryOpen(false)} onSaved={saved} /> : null}

      {data ? (
        <>
          <PortfolioOverview portfolio={data.portfolio} />
          <PortfolioRiskDashboard riskBudget={data.riskBudget} />
          <TradePerformanceDashboard performance={data.performance} executions={data.executions} capital={data.portfolio.capital} />
          <TradeLedger executions={data.executions} deletingId={deletingId} onDelete={deleteExecution} />
        </>
      ) : loading ? (
        <div className="rounded-md border border-border bg-muted/20 px-4 py-12 text-center text-sm text-muted-foreground">正在计算交易绩效...</div>
      ) : null}
    </PageContainer>
  );
}
