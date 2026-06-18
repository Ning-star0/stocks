"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, Save, WalletCards } from "lucide-react";

import { StockIdentity } from "@/components/StockIdentity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FocusDecision, StockItem, TradeOption } from "@/components/focus/types";
import { readJsonResponse } from "@/lib/clientApi";
import {
  displaySymbolBase,
  formatDateTime,
  formatMoney,
  formatPercent,
  formatPrice,
  formatRatio,
  formatShares,
  formatSignedMoney,
  resolveStockDisplayName,
  TRADE_CASH_CHANGE_DESCRIPTION,
  TRADE_LEDGER_PREVIEW_LIMIT,
  tradeSideLabel
} from "@/lib/trading/display";
import { isValidTradeLotShares, parsePositiveNumber } from "@/lib/trading/rules";
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

const nativeFieldClass =
  "h-10 rounded-xl border border-white/50 bg-white/42 px-3 text-sm shadow-[inset_0_1px_0_hsl(0_0%_100%/0.38)] outline-none backdrop-blur-xl transition-all focus:border-primary/40 focus:ring-2 focus:ring-primary/15 dark:border-white/10 dark:bg-white/6 disabled:opacity-55";

export function DecisionFeedbackPanel({
  decisionId,
  feedback,
  hasBuy,
  hasSell,
  tradeOptions,
  watchlist,
  onFeedbackSaved
}: {
  decisionId?: string;
  feedback?: FocusDecision["feedback"];
  hasBuy: boolean;
  hasSell: boolean;
  tradeOptions: TradeOption[];
  watchlist: StockItem[];
  onFeedbackSaved?: () => void;
}) {
  const initialAction = defaultFeedbackAction(feedback, hasBuy, hasSell);
  const initialTradeFeedback = isSyncedTradeFeedback(feedback);
  const [action, setAction] = useState(initialAction);
  const [tradeKey, setTradeKey] = useState(defaultTradeKey(feedback, tradeOptions, initialAction));
  const [executedPrice, setExecutedPrice] = useState(initialTradeFeedback && feedback?.executedPrice ? String(feedback.executedPrice) : "");
  const [executedShares, setExecutedShares] = useState(initialTradeFeedback && feedback?.executedShares ? String(feedback.executedShares) : "");
  const [executedAt, setExecutedAt] = useState(initialTradeFeedback ? datetimeLocalValue(feedback?.executedAt) : "");
  const [note, setNote] = useState(feedback?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(feedback ? feedbackMessage(feedback) : null);
  const manualSymbols = useMemo(() => {
    const bySymbol = new Map<string, { symbol: string; name: string }>();
    for (const item of watchlist) {
      bySymbol.set(item.symbol, { symbol: item.symbol, name: item.name || item.symbol });
    }
    for (const option of tradeOptions) {
      bySymbol.set(option.symbol, { symbol: option.symbol, name: option.name || option.symbol });
    }
    return Array.from(bySymbol.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [tradeOptions, watchlist]);
  const [manualSymbol, setManualSymbol] = useState(manualSymbols[0]?.symbol ?? "");
  const [manualSide, setManualSide] = useState<"buy" | "sell">("sell");
  const [manualPrice, setManualPrice] = useState("");
  const [manualShares, setManualShares] = useState("");
  const [manualExecutedAt, setManualExecutedAt] = useState(datetimeLocalValue());
  const [manualNote, setManualNote] = useState("");
  const [manualSaving, setManualSaving] = useState(false);
  const [manualMessage, setManualMessage] = useState<string | null>(null);
  const [tradeExecutions, setTradeExecutions] = useState<TradeExecutionRecord[]>([]);
  const [tradeLedgerLoading, setTradeLedgerLoading] = useState(false);
  const [tradeLedgerError, setTradeLedgerError] = useState<string | null>(null);

  const selectedTrade = tradeOptions.find((option) => option.key === tradeKey) ?? null;
  const shouldSyncTrade = action === "bought" || action === "sold";
  const tradeFeedbackBlocked = shouldSyncTrade && (!selectedTrade || parsePositiveNumber(executedPrice) === null || !isValidTradeLotShares(executedShares) || !executedAt);
  const manualTradeBlocked = !manualSymbol || parsePositiveNumber(manualPrice) === null || !isValidTradeLotShares(manualShares);
  const ledgerSummary = useMemo(() => {
    return tradeExecutions.reduce(
      (summary, execution) => {
        const netCashChange = Number.isFinite(execution.netCashChange) ? execution.netCashChange : 0;
        summary.totalFee += Number.isFinite(execution.fee) ? execution.fee : 0;
        summary.netCashChange += netCashChange;
        if (netCashChange > 0) summary.cashIn += netCashChange;
        if (netCashChange < 0) summary.cashOut += Math.abs(netCashChange);
        return summary;
      },
      { cashIn: 0, cashOut: 0, netCashChange: 0, totalFee: 0 }
    );
  }, [tradeExecutions]);
  const symbolNameByBase = useMemo(() => {
    const output = new Map<string, string>();
    for (const item of watchlist) {
      if (item.name) output.set(displaySymbolBase(item.symbol), item.name);
    }
    for (const option of tradeOptions) {
      if (option.name) output.set(displaySymbolBase(option.symbol), option.name);
    }
    for (const execution of tradeExecutions) {
      if (execution.name) output.set(displaySymbolBase(execution.symbol), execution.name);
    }
    return output;
  }, [tradeExecutions, tradeOptions, watchlist]);
  const visibleTradeExecutions = tradeExecutions.slice(0, TRADE_LEDGER_PREVIEW_LIMIT);
  const hiddenTradeExecutionCount = Math.max(0, tradeExecutions.length - visibleTradeExecutions.length);

  useEffect(() => {
    if (!manualSymbol && manualSymbols[0]?.symbol) setManualSymbol(manualSymbols[0].symbol);
  }, [manualSymbol, manualSymbols]);

  const loadTradeLedger = useCallback(async () => {
    setTradeLedgerLoading(true);
    setTradeLedgerError(null);
    try {
      const response = await fetch("/api/trades");
      const json = await readJsonResponse<{ executions?: TradeExecutionRecord[] }>(response);
      setTradeExecutions(Array.isArray(json.executions) ? json.executions : []);
    } catch (error) {
      setTradeLedgerError(error instanceof Error ? error.message : "资金流水读取失败。");
    } finally {
      setTradeLedgerLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTradeLedger();
  }, [loadTradeLedger]);

  useEffect(() => {
    const nextAction = defaultFeedbackAction(feedback, hasBuy, hasSell);
    const nextTradeKey = defaultTradeKey(feedback, tradeOptions, nextAction);
    const nextTrade = tradeOptions.find((option) => option.key === nextTradeKey) ?? null;
    const hasSyncedTrade = isSyncedTradeFeedback(feedback);
    setAction(nextAction);
    setTradeKey(nextTradeKey);
    setExecutedPrice(hasSyncedTrade && feedback?.executedPrice ? String(feedback.executedPrice) : numberInputValue(nextTrade?.triggerPrice ?? nextTrade?.price));
    setExecutedShares(hasSyncedTrade && feedback?.executedShares ? String(feedback.executedShares) : numberInputValue(nextTrade?.shares));
    setExecutedAt(hasSyncedTrade ? datetimeLocalValue(feedback?.executedAt) : nextTrade ? datetimeLocalValue() : "");
    setNote(feedback?.note ?? "");
    setMessage(feedback ? feedbackMessage(feedback) : null);
  }, [decisionId, feedback, hasBuy, hasSell, tradeOptions]);

  const options = [
    ...(hasBuy ? [{ value: "bought", label: "已买入/增持" }] : []),
    ...(hasSell ? [{ value: "sold", label: "已卖出/减仓" }] : []),
    { value: "watched", label: "继续观察" },
    { value: "skipped", label: "未采纳/暂不操作" },
    { value: "other", label: "其他决策" }
  ];

  function selectAction(nextAction: string) {
    setAction(nextAction);
    const nextTradeKey = defaultTradeKey(null, tradeOptions, nextAction);
    if (nextTradeKey) {
      setTradeKey(nextTradeKey);
      const nextTrade = tradeOptions.find((option) => option.key === nextTradeKey) ?? null;
      setExecutedPrice(numberInputValue(nextTrade?.triggerPrice ?? nextTrade?.price));
      setExecutedShares(numberInputValue(nextTrade?.shares));
      setExecutedAt((current) => current || datetimeLocalValue());
    } else {
      setTradeKey("");
      setExecutedPrice("");
      setExecutedShares("");
      setExecutedAt("");
    }
  }

  function selectTrade(nextTradeKey: string) {
    setTradeKey(nextTradeKey);
    const nextTrade = tradeOptions.find((option) => option.key === nextTradeKey) ?? null;
    if (nextTrade) {
      setExecutedPrice(numberInputValue(nextTrade.triggerPrice ?? nextTrade.price));
      setExecutedShares(numberInputValue(nextTrade.shares));
      setExecutedAt((current) => current || datetimeLocalValue());
      setAction(nextTrade.side === "buy" ? "bought" : "sold");
    }
  }

  async function submitFeedback() {
    if (!decisionId) {
      setMessage("当前决策还没有保存 ID，暂时不能记录反馈。");
      return;
    }
    if (shouldSyncTrade && !selectedTrade) {
      setMessage("记录实际成交前，请先选择一条需要同步持仓的交易标的。");
      return;
    }
    if (shouldSyncTrade && (parsePositiveNumber(executedPrice) === null || !isValidTradeLotShares(executedShares) || !executedAt)) {
      setMessage("记录实际成交前，请填写有效的成交时间和价格，并按 100 股/份整数手填写数量。");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/decision-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decisionId,
          feedbackAction: action,
          executedPrice: shouldSyncTrade ? executedPrice : null,
          executedShares: shouldSyncTrade ? executedShares : null,
          executedAt: shouldSyncTrade && executedAt ? new Date(executedAt).toISOString() : null,
          tradeSymbol: shouldSyncTrade ? selectedTrade?.symbol : null,
          tradeSide: shouldSyncTrade ? selectedTrade?.side : null,
          note
        })
      });
      const json = await readJsonResponse<{ feedback?: NonNullable<FocusDecision["feedback"]> & { label?: string } }>(response);
      setMessage(json.feedback ? feedbackMessage(json.feedback) : `已记录：${feedbackActionLabel(action)}`);
      void loadTradeLedger();
      onFeedbackSaved?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "反馈保存失败。");
    } finally {
      setSaving(false);
    }
  }

  async function submitManualTrade() {
    if (manualTradeBlocked) {
      setManualMessage("补录交易前，请选择标的、填写有效成交价，并按 100 股/份整数手填写数量。");
      return;
    }
    setManualSaving(true);
    setManualMessage(null);
    try {
      const response = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: manualSymbol,
          side: manualSide,
          price: manualPrice,
          shares: manualShares,
          executedAt: manualExecutedAt ? new Date(manualExecutedAt).toISOString() : undefined,
          note: manualNote
        })
      });
      const json = await readJsonResponse<{ execution?: { symbol: string; side: string; shares: number; price: number }; position?: { holdingShares?: number | null } }>(response);
      const execution = json.execution;
      const sideText = execution?.side === "buy" ? "买入" : "卖出";
      setManualMessage(execution ? `已补录 ${execution.symbol} ${sideText} ${execution.shares} 股/份，并重算持仓。` : "已补录并重算持仓。");
      setManualNote("");
      void loadTradeLedger();
      onFeedbackSaved?.();
    } catch (error) {
      setManualMessage(error instanceof Error ? error.message : "补录交易失败。");
    } finally {
      setManualSaving(false);
    }
  }

  return (
    <div className="glow-card rounded-xl border border-border bg-background/35 p-3 sm:p-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]">
        <section className="rounded-xl border border-border bg-background/45 p-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-sm font-semibold">记录你的最终决策</div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">成交会同步持仓；观察和未采纳只保存反馈。</p>
            </div>
            {feedback?.updatedAt ? <span className="text-xs text-muted-foreground">上次记录：{formatDateTime(feedback.updatedAt)}</span> : null}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => selectAction(option.value)}
                className={cn(
                  "glow-card glow-click-card rounded-full border px-3 py-1.5 text-xs transition-colors",
                  action === option.value
                    ? "glow-click-card-active border-primary/40 bg-primary/12 text-primary"
                    : "border-border bg-muted/20 text-muted-foreground hover:border-primary/30 hover:text-foreground"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          {tradeOptions.length ? (
            <div className="mt-3 grid gap-2">
              <label className="text-xs font-medium text-muted-foreground">同步交易标的</label>
              <select
                value={tradeKey}
                onChange={(event) => selectTrade(event.target.value)}
                disabled={!shouldSyncTrade}
                className={nativeFieldClass}
              >
                <option value="">不同步持仓</option>
                {tradeOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label} · {option.symbol}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">实际买卖必须绑定交易计划，并按 100 股/份整数手记录。</p>
              {selectedTrade ? <TradeExecutionHint trade={selectedTrade} /> : null}
            </div>
          ) : null}

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Input
              value={executedPrice}
              onChange={(event) => setExecutedPrice(event.target.value)}
              inputMode="decimal"
              disabled={!shouldSyncTrade}
              placeholder={shouldSyncTrade ? "实际成交价，必填" : "非成交反馈不记录成交价"}
            />
            <Input
              value={executedShares}
              onChange={(event) => setExecutedShares(event.target.value)}
              inputMode="numeric"
              min={100}
              step={100}
              disabled={!shouldSyncTrade}
              placeholder={shouldSyncTrade ? "实际数量，按 100 的整数倍" : "非成交反馈不记录数量"}
            />
          </div>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            placeholder="备注，可选，例如：价格没到，继续观察。"
            className="mt-3 w-full resize-none rounded-xl border border-white/50 bg-white/42 px-3 py-2 text-sm shadow-[inset_0_1px_0_hsl(0_0%_100%/0.38)] outline-none backdrop-blur-xl transition-all placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/15 dark:border-white/10 dark:bg-white/6"
          />
          <div className="mt-3 grid gap-2">
            <label className="text-xs font-medium text-muted-foreground">实际成交时间</label>
            <Input
              type="datetime-local"
              value={executedAt}
              onChange={(event) => setExecutedAt(event.target.value)}
              disabled={!shouldSyncTrade}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button type="button" size="sm" onClick={submitFeedback} disabled={saving || !decisionId || tradeFeedbackBlocked}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              保存反馈
            </Button>
            {tradeFeedbackBlocked ? (
              <span className="text-xs text-muted-foreground">请选择同步标的，填写有效成交时间和价格，并按 100 股/份整数手填写数量。</span>
            ) : message ? (
              <span className="text-xs text-muted-foreground">{message}</span>
            ) : null}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-background/45 p-3">
          <div className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-sm font-semibold">补录历史买卖</div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">保存后按全部流水重算持仓、成本、现金和已实现盈亏。</p>
            </div>
            <span className="text-xs text-muted-foreground">最低 100 股/份</span>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1.2fr)_140px] xl:grid-cols-1 2xl:grid-cols-[minmax(0,1.2fr)_140px]">
            <select
              value={manualSymbol}
              onChange={(event) => setManualSymbol(event.target.value)}
              className={nativeFieldClass}
            >
              {manualSymbols.map((item) => (
                <option key={item.symbol} value={item.symbol}>
                  {item.name} · {item.symbol}
                </option>
              ))}
            </select>
            <select
              value={manualSide}
              onChange={(event) => setManualSide(event.target.value === "buy" ? "buy" : "sell")}
              className={nativeFieldClass}
            >
              <option value="buy">买入/增持</option>
              <option value="sell">卖出/减仓</option>
            </select>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Input value={manualPrice} onChange={(event) => setManualPrice(event.target.value)} inputMode="decimal" placeholder="实际成交价，必填" />
            <Input value={manualShares} onChange={(event) => setManualShares(event.target.value)} inputMode="numeric" min={100} step={100} placeholder="实际数量，按 100 的整数倍" />
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-[220px_1fr] xl:grid-cols-1 2xl:grid-cols-[220px_1fr]">
            <Input type="datetime-local" value={manualExecutedAt} onChange={(event) => setManualExecutedAt(event.target.value)} />
            <Input value={manualNote} onChange={(event) => setManualNote(event.target.value)} placeholder="备注，可选，例如：补录上周卖出。" />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button type="button" size="sm" variant="outline" onClick={submitManualTrade} disabled={manualSaving || manualTradeBlocked}>
              {manualSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              补录并重算
            </Button>
            {manualTradeBlocked ? (
              <span className="text-xs text-muted-foreground">请选择标的，填写有效成交价，并按 100 股/份整数手填写数量。</span>
            ) : manualMessage ? (
              <span className="text-xs text-muted-foreground">{manualMessage}</span>
            ) : null}
          </div>
        </section>
      </div>

      <section className="mt-4 rounded-xl border border-border bg-background/45 p-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-sm font-semibold">资金明细流水</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">默认显示最近 {TRADE_LEDGER_PREVIEW_LIMIT} 笔；{TRADE_CASH_CHANGE_DESCRIPTION}。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={loadTradeLedger} disabled={tradeLedgerLoading}>
              <RefreshCw className={cn("h-4 w-4", tradeLedgerLoading ? "animate-spin" : "")} />
              刷新流水
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link href="/trades">
                <WalletCards className="h-4 w-4" />
                查看全部流水
              </Link>
            </Button>
          </div>
        </div>

        {tradeLedgerError ? <div className="mt-3 rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive">{tradeLedgerError}</div> : null}

        <div className="mt-3 grid gap-3 xl:grid-cols-[260px_minmax(0,1fr)]">
          <div className="glow-card rounded-xl border border-border bg-muted/10 p-3">
            <div className="text-xs font-medium text-muted-foreground">最近 {tradeExecutions.length} 笔汇总</div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              <LedgerMetric label="现金净变化" value={formatSignedMoney(ledgerSummary.netCashChange)} tone={ledgerSummary.netCashChange >= 0 ? "in" : "out"} muted={!tradeExecutions.length} />
              <LedgerMetric label="现金流入" value={formatMoney(ledgerSummary.cashIn)} tone="in" muted={!tradeExecutions.length} />
              <LedgerMetric label="现金流出" value={formatMoney(ledgerSummary.cashOut)} tone="out" muted={!tradeExecutions.length} />
              <LedgerMetric label="手续费合计" value={formatMoney(ledgerSummary.totalFee)} muted={!tradeExecutions.length} />
            </div>
            <div className="mt-3 rounded-md bg-background/70 px-3 py-2 text-xs leading-5 text-muted-foreground">
              买入会减少现金，卖出会增加现金；手续费买卖都扣除，所以卖出到账金额会小于成交额。
            </div>
          </div>

          <div className="glow-card overflow-hidden rounded-xl border border-border">
            <div className="hidden grid-cols-[92px_minmax(160px,1fr)_66px_94px_76px_102px_94px] gap-2 border-b border-border bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground md:grid">
              <span>时间</span>
              <span>标的</span>
              <span>方向</span>
              <span className="text-right">成交额</span>
              <span className="text-right">手续费</span>
              <span className="text-right">现金变化</span>
              <span className="text-right">已实现盈亏</span>
            </div>
            {tradeExecutions.length ? (
              <>
                <div className="divide-y divide-border">
                  {visibleTradeExecutions.map((execution) => {
                    const stockName = resolveStockDisplayName({
                      symbol: execution.symbol,
                      name: execution.name || symbolNameByBase.get(displaySymbolBase(execution.symbol))
                    });
                    return (
                      <div key={execution.id} className="grid gap-2 px-3 py-2.5 text-xs md:grid-cols-[92px_minmax(160px,1fr)_66px_94px_76px_102px_94px] md:items-center">
                        <div className="text-muted-foreground">{formatDateTime(execution.executedAt)}</div>
                        <div className="min-w-0">
                          <StockIdentity symbol={execution.symbol} name={stockName} compact />
                          <div className="mt-0.5 truncate text-muted-foreground">
                            {formatPrice(execution.price)} x {formatShares(execution.shares)} 股/份{execution.note ? ` · ${execution.note}` : ""}
                          </div>
                        </div>
                        <div className={cn("w-fit rounded-full px-2 py-1", execution.side === "buy" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" : "bg-red-500/10 text-red-600 dark:text-red-300")}>
                          {tradeSideLabel(execution.side)}
                        </div>
                        <LedgerCell label="成交额" value={formatMoney(execution.amount)} />
                        <LedgerCell label="手续费" value={formatMoney(execution.fee)} />
                        <LedgerCell label="现金变化" value={formatSignedMoney(execution.netCashChange)} className={execution.netCashChange >= 0 ? "text-red-500" : "text-emerald-500"} />
                        <LedgerCell
                          label="已实现盈亏"
                          value={execution.realizedPnl === null ? "--" : formatSignedMoney(execution.realizedPnl)}
                          className={execution.realizedPnl === null ? "text-muted-foreground" : execution.realizedPnl >= 0 ? "text-red-500" : "text-emerald-500"}
                        />
                      </div>
                    );
                  })}
                </div>
                {tradeExecutions.length > TRADE_LEDGER_PREVIEW_LIMIT ? (
                  <Link
                    href="/trades"
                    className="flex w-full items-center justify-center gap-2 border-t border-border bg-muted/20 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/35 hover:text-foreground"
                  >
                    查看其余 {hiddenTradeExecutionCount} 笔完整流水
                  </Link>
                ) : null}
              </>
            ) : (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">{tradeLedgerLoading ? "正在读取资金流水..." : "暂无资金流水，成交反馈或补录买卖后会自动生成。"}</div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function defaultFeedbackAction(feedback: FocusDecision["feedback"] | undefined, hasBuy: boolean, hasSell: boolean) {
  return feedback?.feedbackAction ?? (hasBuy ? "bought" : hasSell ? "sold" : "watched");
}

function defaultTradeKey(feedback: FocusDecision["feedback"] | null | undefined, tradeOptions: TradeOption[], action: string) {
  if (isSyncedTradeFeedback(feedback) && feedback?.tradeSymbol && feedback.tradeSide) {
    const side = feedback.tradeSide === "sell" ? "sell" : "buy";
    const key = `${side}:${feedback.tradeSymbol.toUpperCase()}`;
    if (tradeOptions.some((option) => option.key === key)) return key;
  }
  const side = action === "sold" ? "sell" : action === "bought" ? "buy" : null;
  if (!side) return "";
  return tradeOptions.find((option) => option.side === side)?.key ?? "";
}

function isSyncedTradeFeedback(feedback: FocusDecision["feedback"] | null | undefined) {
  return Boolean(feedback?.positionSyncedAt && feedback.tradeSymbol && feedback.tradeSide);
}

function numberInputValue(value?: number | null) {
  return value && Number.isFinite(value) ? String(value) : "";
}

function datetimeLocalValue(value?: string | Date | null) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function feedbackMessage(feedback: NonNullable<FocusDecision["feedback"]> & { label?: string }) {
  const label = feedback.label ?? feedbackActionLabel(feedback.feedbackAction);
  if (feedback.positionSyncedAt && feedback.tradeSymbol) {
    const position = feedback.position?.holdingShares ? `，当前持仓 ${feedback.position.holdingShares} 股/份` : "";
    return `已记录并同步持仓：${feedback.tradeSymbol}${position}`;
  }
  return `已记录：${label}`;
}

function feedbackActionLabel(value?: string | null) {
  const map: Record<string, string> = {
    bought: "已买入/增持",
    sold: "已卖出/减仓",
    watched: "继续观察",
    skipped: "未采纳/暂不操作",
    other: "其他决策"
  };
  return value ? map[value] ?? map.other : map.other;
}

function TradeExecutionHint({ trade }: { trade: TradeOption }) {
  const rows = [
    ["计划类型", trade.side === "buy" ? planTypeLabel(trade.planType) : trade.sellRatioPct ? `卖出 ${formatPercent(trade.sellRatioPct)}` : "卖出/减仓"],
    ["优先级", priorityLabel(trade.priority)],
    ["触发价", formatPrice(trade.triggerPrice ?? trade.price)],
    ["止损价", formatPrice(trade.stopLossPrice)],
    ["止盈价", formatPrice(trade.takeProfitPrice)],
    ["计划金额", formatMoney(trade.amount)],
    ...(trade.side === "buy" ? [["风险收益比", formatRatio(trade.riskRewardRatio)], ["最大价格风险", formatMoney(trade.maxLossAmount)]] : []),
    [trade.side === "buy" ? "触发条件" : "退出条件", trade.side === "buy" ? trade.entryCondition ?? "--" : trade.exitCondition ?? "--"],
    ["执行窗口", trade.executionWindow ?? "--"],
    ["仓位影响", trade.positionImpact ?? "--"]
  ].filter((row): row is [string, string] => row[1] !== "--");

  if (!rows.length) return null;

  return (
    <div className="glow-card grid gap-2 rounded-xl border border-border bg-muted/20 p-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <div className="text-muted-foreground">{label}</div>
          <div className="mt-1 break-words font-medium tabular-nums text-foreground" title={value}>{value}</div>
        </div>
      ))}
    </div>
  );
}

function planTypeLabel(value?: TradeOption["planType"]) {
  const map: Record<NonNullable<TradeOption["planType"]>, string> = {
    pullback: "回调低吸",
    breakout: "突破确认",
    support: "支撑确认",
    trend_follow: "趋势跟随",
    add_on_strength: "强势增持",
    risk_rebalance: "调仓再平衡"
  };
  return value ? map[value] : "--";
}

function priorityLabel(value?: number | null) {
  return value && Number.isFinite(value) ? `P${value}` : "--";
}

function LedgerMetric({ label, value, tone = "neutral", muted = false }: { label: string; value: string; tone?: "in" | "out" | "neutral"; muted?: boolean }) {
  return (
    <div className="glow-card rounded-lg border border-border bg-muted/15 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-sm font-semibold tabular-nums", muted ? "text-muted-foreground" : tone === "in" ? "text-red-500" : tone === "out" ? "text-emerald-500" : "text-foreground")}>{value}</div>
    </div>
  );
}

function LedgerCell({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 md:block md:text-right">
      <span className="text-muted-foreground md:hidden">{label}</span>
      <span className={cn("font-medium tabular-nums text-foreground", className)}>{value}</span>
    </div>
  );
}
