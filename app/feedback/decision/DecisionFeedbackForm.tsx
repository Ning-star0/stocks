"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, CircleDot, Clock3, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { resolveStockDisplayName } from "@/lib/trading/display";
import { isValidTradeLotShares, parsePositiveNumber } from "@/lib/trading/rules";
import { cn } from "@/lib/utils";

type FeedbackTradeOption = {
  type: string;
  side: "buy" | "sell";
  symbol: string;
  name: string;
  price: number | null;
  triggerPrice: number | null;
  shares: number;
};

export function DecisionFeedbackForm({
  decisionId,
  token,
  currentAction,
  feedbackNote,
  tradeOptions,
  initialTradeKey,
  initialExecutedPrice,
  initialExecutedShares,
  initialExecutedAt
}: {
  decisionId: string;
  token: string;
  currentAction: string;
  feedbackNote?: string | null;
  tradeOptions: FeedbackTradeOption[];
  initialTradeKey: string;
  initialExecutedPrice: string;
  initialExecutedShares: string;
  initialExecutedAt: string;
}) {
  const [action, setAction] = useState(currentAction);
  const [tradeKey, setTradeKey] = useState(initialTradeKey);
  const [executedPrice, setExecutedPrice] = useState(initialExecutedPrice);
  const [executedShares, setExecutedShares] = useState(initialExecutedShares);
  const [executedAt, setExecutedAt] = useState(initialExecutedAt);
  const shouldSyncTrade = action === "bought" || action === "sold";
  const selectedTrade = tradeOptions.find((option) => `${option.side}:${option.symbol}` === tradeKey) ?? null;
  const tradeBlocked = shouldSyncTrade && (!selectedTrade || parsePositiveNumber(executedPrice) === null || !isValidTradeLotShares(executedShares) || !executedAt);
  const visibleActions = useMemo(() => {
    const hasBuy = tradeOptions.some((option) => option.side === "buy");
    const hasSell = tradeOptions.some((option) => option.side === "sell");
    return [
      hasBuy ? { value: "bought", label: "已买入/增持" } : null,
      hasSell ? { value: "sold", label: "已卖出/减仓" } : null,
      { value: "watched", label: "继续观察" },
      { value: "skipped", label: "未采纳/暂不操作" },
      { value: "other", label: "其他决策" }
    ].filter((item): item is { value: string; label: string } => Boolean(item));
  }, [tradeOptions]);

  function selectAction(nextAction: string) {
    setAction(nextAction);
    const side = nextAction === "bought" ? "buy" : nextAction === "sold" ? "sell" : null;
    if (!side) {
      setTradeKey("");
      setExecutedPrice("");
      setExecutedShares("");
      setExecutedAt("");
      return;
    }
    const nextTrade = tradeOptions.find((option) => option.side === side) ?? null;
    setTradeKey(nextTrade ? `${nextTrade.side}:${nextTrade.symbol}` : "");
    setExecutedPrice(numberInputValue(nextTrade?.triggerPrice ?? nextTrade?.price));
    setExecutedShares(numberInputValue(nextTrade?.shares));
    setExecutedAt((current) => current || datetimeLocalValue());
  }

  function selectTrade(nextTradeKey: string) {
    setTradeKey(nextTradeKey);
    const nextTrade = tradeOptions.find((option) => `${option.side}:${option.symbol}` === nextTradeKey) ?? null;
    if (!nextTrade) {
      setExecutedPrice("");
      setExecutedShares("");
      setExecutedAt("");
      return;
    }
    setAction(nextTrade.side === "buy" ? "bought" : "sold");
    setExecutedPrice(numberInputValue(nextTrade.triggerPrice ?? nextTrade.price));
    setExecutedShares(numberInputValue(nextTrade.shares));
    setExecutedAt((current) => current || datetimeLocalValue());
  }

  return (
    <form method="post" action="/api/decision-feedback" className="space-y-3">
      <input type="hidden" name="decisionId" value={decisionId} />
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="feedbackAction" value={action} />

      <div className="glow-card rounded-xl border border-border bg-background/35 p-3">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <CircleDot className="h-4 w-4 text-primary" />
          最终操作
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {visibleActions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => selectAction(option.value)}
              className={cn(
                "glow-card glow-click-card flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors",
                action === option.value
                  ? "glow-click-card-active border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-background/40 text-foreground hover:border-primary/30"
              )}
            >
              <span className={cn("h-2.5 w-2.5 rounded-full border", action === option.value ? "border-primary bg-primary" : "border-muted-foreground/50")} />
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="glow-card rounded-xl border border-border bg-background/35 p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Clock3 className="h-4 w-4 text-primary" />
            同步成交
          </div>
          <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">{shouldSyncTrade ? "需要填写" : "当前不记录成交"}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {tradeOptions.length ? (
            <div className="space-y-2 sm:col-span-2">
              <span className="block text-sm font-medium">同步交易标的</span>
              <select
                name="tradeSymbol"
                value={tradeKey}
                onChange={(event) => selectTrade(event.target.value)}
                disabled={!shouldSyncTrade}
                required={shouldSyncTrade}
                className="h-10 w-full rounded-xl border border-white/50 bg-white/42 px-3 text-sm shadow-[inset_0_1px_0_hsl(0_0%_100%/0.38)] outline-none backdrop-blur-xl transition-all focus:border-primary/40 focus:ring-2 focus:ring-primary/15 dark:border-white/10 dark:bg-white/6 disabled:opacity-55"
              >
                <option value="">不同步持仓</option>
                {tradeOptions.map((order) => (
                  <option key={`${order.side}-${order.symbol}`} value={`${order.side}:${order.symbol}`}>
                    {resolveStockDisplayName({ symbol: order.symbol, name: order.name })} · {order.type} · {order.symbol}
                  </option>
                ))}
              </select>
              <p className="text-xs leading-5 text-muted-foreground">实际买卖必须绑定一条交易计划，并按 100 股/份整数手记录；继续观察、未采纳或其他决策不会保存成交字段。</p>
            </div>
          ) : null}
          <div className="space-y-2">
            <span className="block text-sm font-medium">{shouldSyncTrade ? "实际成交价，必填" : "实际成交价"}</span>
            <Input
              name="executedPrice"
              inputMode="decimal"
              disabled={!shouldSyncTrade}
              required={shouldSyncTrade}
              placeholder={shouldSyncTrade ? "例如 2.16" : "非成交反馈不记录成交价"}
              value={executedPrice}
              onChange={(event) => setExecutedPrice(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <span className="block text-sm font-medium">{shouldSyncTrade ? "实际数量，必填" : "实际数量"}</span>
            <Input
              name="executedShares"
              inputMode="numeric"
              min={100}
              step={100}
              disabled={!shouldSyncTrade}
              required={shouldSyncTrade}
              placeholder={shouldSyncTrade ? "例如 200" : "非成交反馈不记录数量"}
              value={executedShares}
              onChange={(event) => setExecutedShares(event.target.value)}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <span className="block text-sm font-medium">{shouldSyncTrade ? "实际成交时间，必填" : "实际成交时间"}</span>
            <Input
              type="datetime-local"
              name="executedAt"
              disabled={!shouldSyncTrade}
              required={shouldSyncTrade}
              value={executedAt}
              onChange={(event) => setExecutedAt(event.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="glow-card rounded-xl border border-border bg-background/35 p-3">
        <span className="mb-2 block text-sm font-medium">备注，可选</span>
        <Textarea className="min-h-24" name="note" placeholder="例如：价格没到，没有买；或实际买入 200 份。" defaultValue={feedbackNote ?? ""} />
      </div>

      <div className="glow-card flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/15 p-3">
        <Button type="submit" disabled={tradeBlocked}>
          <Save className="h-4 w-4" />
          保存反馈
        </Button>
        <Button asChild variant="outline">
          <Link href="/focus">
            <ArrowLeft className="h-4 w-4" />
            今日工作台
          </Link>
        </Button>
        {tradeBlocked ? <span className="text-xs text-muted-foreground">请选择同步标的，填写有效成交时间和价格，并按 100 股/份整数手填写数量。</span> : null}
      </div>
    </form>
  );
}

function numberInputValue(value?: number | null) {
  return value && Number.isFinite(value) ? String(value) : "";
}

function datetimeLocalValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
