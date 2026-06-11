"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FocusDecision, StockItem, TradeOption } from "@/components/focus/types";
import { readJsonResponse } from "@/lib/clientApi";
import { cn } from "@/lib/utils";

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
  const [action, setAction] = useState(initialAction);
  const [tradeKey, setTradeKey] = useState(defaultTradeKey(feedback, tradeOptions, initialAction));
  const [executedPrice, setExecutedPrice] = useState(feedback?.executedPrice ? String(feedback.executedPrice) : "");
  const [executedShares, setExecutedShares] = useState(feedback?.executedShares ? String(feedback.executedShares) : "");
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

  const selectedTrade = tradeOptions.find((option) => option.key === tradeKey) ?? null;
  const shouldSyncTrade = action === "bought" || action === "sold";

  useEffect(() => {
    if (!manualSymbol && manualSymbols[0]?.symbol) setManualSymbol(manualSymbols[0].symbol);
  }, [manualSymbol, manualSymbols]);

  useEffect(() => {
    const nextAction = defaultFeedbackAction(feedback, hasBuy, hasSell);
    const nextTradeKey = defaultTradeKey(feedback, tradeOptions, nextAction);
    const nextTrade = tradeOptions.find((option) => option.key === nextTradeKey) ?? null;
    setAction(nextAction);
    setTradeKey(nextTradeKey);
    setExecutedPrice(feedback?.executedPrice ? String(feedback.executedPrice) : numberInputValue(nextTrade?.triggerPrice ?? nextTrade?.price));
    setExecutedShares(feedback?.executedShares ? String(feedback.executedShares) : numberInputValue(nextTrade?.shares));
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
    }
  }

  function selectTrade(nextTradeKey: string) {
    setTradeKey(nextTradeKey);
    const nextTrade = tradeOptions.find((option) => option.key === nextTradeKey) ?? null;
    if (nextTrade) {
      setExecutedPrice(numberInputValue(nextTrade.triggerPrice ?? nextTrade.price));
      setExecutedShares(numberInputValue(nextTrade.shares));
      setAction(nextTrade.side === "buy" ? "bought" : "sold");
    }
  }

  async function submitFeedback() {
    if (!decisionId) {
      setMessage("当前决策还没有保存 ID，暂时不能记录反馈。");
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
          executedPrice,
          executedShares,
          tradeSymbol: shouldSyncTrade ? selectedTrade?.symbol : null,
          tradeSide: shouldSyncTrade ? selectedTrade?.side : null,
          note
        })
      });
      const json = await readJsonResponse<{ feedback?: NonNullable<FocusDecision["feedback"]> & { label?: string } }>(response);
      setMessage(json.feedback ? feedbackMessage(json.feedback) : `已记录：${feedbackActionLabel(action)}`);
      onFeedbackSaved?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "反馈保存失败。");
    } finally {
      setSaving(false);
    }
  }

  async function submitManualTrade() {
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
      onFeedbackSaved?.();
    } catch (error) {
      setManualMessage(error instanceof Error ? error.message : "补录交易失败。");
    } finally {
      setManualSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-background/35 p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-sm font-semibold">记录你的最终决策</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">填写实际成交价和数量后会同步持仓；继续观察、未采纳或其他决策不会改动持仓。</p>
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
              "rounded-full border px-3 py-1.5 text-xs transition-colors",
              action === option.value
                ? "border-primary/40 bg-primary/12 text-primary"
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
            className="h-10 rounded-md border border-input bg-background/40 px-3 text-sm outline-none transition-colors focus:border-primary/40 focus:ring-2 focus:ring-primary/15 disabled:opacity-55"
          >
            <option value="">不同步持仓</option>
            {tradeOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label} · {option.symbol}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">实际买卖按 100 股/份整数手记录；保存后会更新自选股里的持仓成本和持仓数量。</p>
          {selectedTrade ? <TradeExecutionHint trade={selectedTrade} /> : null}
        </div>
      ) : null}

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Input value={executedPrice} onChange={(event) => setExecutedPrice(event.target.value)} inputMode="decimal" placeholder="实际成交价，可选" />
        <Input value={executedShares} onChange={(event) => setExecutedShares(event.target.value)} inputMode="numeric" placeholder="实际数量，按 100 的整数倍" />
      </div>
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={2}
        placeholder="备注，可选，例如：价格没到，继续观察。"
        className="mt-3 w-full resize-none rounded-md border border-input bg-background/40 px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" onClick={submitFeedback} disabled={saving || !decisionId}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          保存反馈
        </Button>
        {message ? <span className="text-xs text-muted-foreground">{message}</span> : null}
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <div className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-sm font-semibold">补录历史买卖</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">适合补填之前忘记记录的买入或卖出；保存后会按全部交易流水重新统计持仓、成本、现金和已实现盈亏。</p>
          </div>
          <span className="text-xs text-muted-foreground">规则：最低 100 股/份，按整数手</span>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1.2fr)_140px_1fr_1fr]">
          <select
            value={manualSymbol}
            onChange={(event) => setManualSymbol(event.target.value)}
            className="h-10 rounded-md border border-input bg-background/40 px-3 text-sm outline-none transition-colors focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
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
            className="h-10 rounded-md border border-input bg-background/40 px-3 text-sm outline-none transition-colors focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
          >
            <option value="buy">买入/增持</option>
            <option value="sell">卖出/减仓</option>
          </select>
          <Input value={manualPrice} onChange={(event) => setManualPrice(event.target.value)} inputMode="decimal" placeholder="实际成交价" />
          <Input value={manualShares} onChange={(event) => setManualShares(event.target.value)} inputMode="numeric" placeholder="实际数量" />
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-[220px_1fr]">
          <Input type="datetime-local" value={manualExecutedAt} onChange={(event) => setManualExecutedAt(event.target.value)} />
          <Input value={manualNote} onChange={(event) => setManualNote(event.target.value)} placeholder="备注，可选，例如：补录上周卖出。" />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" variant="outline" onClick={submitManualTrade} disabled={manualSaving || !manualSymbol}>
            {manualSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            补录并重算
          </Button>
          {manualMessage ? <span className="text-xs text-muted-foreground">{manualMessage}</span> : null}
        </div>
      </div>
    </div>
  );
}

function defaultFeedbackAction(feedback: FocusDecision["feedback"] | undefined, hasBuy: boolean, hasSell: boolean) {
  return feedback?.feedbackAction ?? (hasBuy ? "bought" : hasSell ? "sold" : "watched");
}

function defaultTradeKey(feedback: FocusDecision["feedback"] | null | undefined, tradeOptions: TradeOption[], action: string) {
  if (feedback?.tradeSymbol && feedback.tradeSide) {
    const side = feedback.tradeSide === "sell" ? "sell" : "buy";
    const key = `${side}:${feedback.tradeSymbol.toUpperCase()}`;
    if (tradeOptions.some((option) => option.key === key)) return key;
  }
  const side = action === "sold" ? "sell" : action === "bought" ? "buy" : null;
  if (!side) return "";
  return tradeOptions.find((option) => option.side === side)?.key ?? "";
}

function numberInputValue(value?: number | null) {
  return value && Number.isFinite(value) ? String(value) : "";
}

function datetimeLocalValue(date = new Date()) {
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
    <div className="grid gap-2 rounded-md border border-border bg-muted/20 p-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
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

function formatPrice(value?: number | null) {
  return value !== null && value !== undefined && Number.isFinite(value) ? String(value) : "--";
}

function formatMoney(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 }).format(value);
}

function formatRatio(value?: number | null) {
  return value !== null && value !== undefined && Number.isFinite(value) ? `${value.toFixed(2)} : 1` : "--";
}

function formatPercent(value?: number | null) {
  return value !== null && value !== undefined && Number.isFinite(value) ? `${value.toFixed(0)}%` : "--";
}

function formatDateTime(value?: string | Date | null) {
  if (!value) return "--";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
