"use client";

import { Badge } from "@/components/ui/badge";
import { DecisionFeedbackPanel } from "@/components/focus/DecisionFeedbackPanel";
import type { FocusDecision, StockItem, TradeOption } from "@/components/focus/types";
import { StrategyBadge } from "@/components/StrategyBadge";
import { motionClassNames, staggerDelay } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function FocusDecisionPanel({
  decision,
  nextObserveAt,
  names,
  watchlist,
  onFeedbackSaved
}: {
  decision: FocusDecision;
  nextObserveAt: string;
  names: Record<string, string>;
  watchlist: StockItem[];
  onFeedbackSaved?: () => void;
}) {
  const sellOrders = decision.sellOrders ?? [];
  const shouldSell = sellOrders.length > 0;
  const hasBuy = decision.orders.length > 0;
  const investedCost = decision.investedCost ?? 0;
  const availableCash = decision.availableCash ?? decision.capital;
  const rawMarketValue = decision.currentMarketValue ?? 0;
  const marketValueUsesCostFallback = investedCost > 0 && rawMarketValue <= 0;
  const valuationStatus = decision.portfolioValuationStatus ?? (marketValueUsesCostFallback ? "cost_fallback" : rawMarketValue > 0 ? "live" : "empty");
  const valuationIsFallback = valuationStatus === "cost_fallback" || valuationStatus === "partial_fallback" || marketValueUsesCostFallback;
  const currentMarketValue = marketValueUsesCostFallback ? investedCost : rawMarketValue;
  const unrealizedPnl = marketValueUsesCostFallback ? 0 : decision.unrealizedPnl ?? 0;
  const realizedPnl = decision.realizedPnl ?? 0;
  const totalAssets = marketValueUsesCostFallback
    ? Number((availableCash + currentMarketValue).toFixed(2))
    : decision.totalAssets ?? Number((availableCash + currentMarketValue).toFixed(2));
  const hasAddOnly = hasBuy && decision.orders.every((order) => order.action === "add");
  const actionLabel = hasBuy && shouldSell ? "买入 + 卖出/减仓" : hasBuy ? (hasAddOnly ? "形成增持观察计划" : "形成观察买入计划") : shouldSell ? "形成卖出/减仓计划" : "等待 / 暂不行动";
  const conclusionLabel = hasBuy && shouldSell ? "调仓观察" : hasBuy ? (hasAddOnly ? "形成增持观察计划" : "形成观察买入计划") : shouldSell ? "风险处理 / 减仓观察" : "不建议交易";
  const highlightNames = uniqueText([
    ...Object.values(names),
    ...decision.ranking.map((item) => names[item.symbol] || item.symbol),
    ...decision.orders.map((item) => item.name || item.symbol),
    ...sellOrders.map((item) => item.name || item.symbol)
  ]);
  const tradeOptions: TradeOption[] = [
    ...decision.orders.map((order) => ({
      key: `buy:${order.symbol}`,
      symbol: order.symbol,
      name: order.name,
      side: "buy" as const,
      label: `${order.name || order.symbol} · ${order.action === "add" ? "增持" : "买入"}`,
      price: order.estimatedPrice,
      shares: order.shares
    })),
    ...sellOrders.map((order) => ({
      key: `sell:${order.symbol}`,
      symbol: order.symbol,
      name: order.name,
      side: "sell" as const,
      label: `${order.name || order.symbol} · ${order.action === "sell" ? "卖出" : "减仓"}`,
      price: order.estimatedPrice,
      shares: order.shares
    }))
  ];
  return (
    <div className="space-y-4">
      {decision.fallbackReason ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-200">{decision.fallbackReason}</div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {decision.generatedAt ? <span>生成时间：{formatDateTime(decision.generatedAt)}</span> : null}
        {decision.scheduledFor ? <span>计划时间：{formatDateTime(decision.scheduledFor)}</span> : null}
        {decision.persistedAt ? <span>保存时间：{formatDateTime(decision.persistedAt)}</span> : null}
        {decision.dataScope?.latestQuoteTime ? <span>行情截止：{formatDateTime(decision.dataScope.latestQuoteTime)}</span> : null}
        {decision.dataScope?.latestHistoryTo ? <span>日K截止：{formatDate(decision.dataScope.latestHistoryTo)}</span> : null}
        <Badge variant={decision.source === "scheduled" ? "success" : "secondary"}>{decision.source === "scheduled" ? "定时决策" : "手动决策"}</Badge>
        <span className="rounded-full border border-border/70 px-2 py-0.5 text-muted-foreground">{decision.fromCache ? "已保存" : "最新"}</span>
        {decision.stale ? <span className="rounded-full border border-border/70 px-2 py-0.5 text-muted-foreground">配置已变化</span> : null}
        <NotificationBadge notification={decision.notification} />
      </div>
      {decision.notification ? <NotificationStatus notification={decision.notification} /> : null}
      <div className={cn("rounded-xl border p-5", hasBuy ? "border-primary/25 bg-primary/12" : shouldSell ? "border-rose-500/30 bg-rose-500/10" : "border-amber-500/35 bg-amber-50/70 text-foreground dark:bg-amber-500/10")}>
        <div className="flex flex-wrap items-center gap-2">
          <StrategyBadge tone={hasBuy ? "bullish" : shouldSell ? "avoid" : "wait"}>今日结论：{conclusionLabel}</StrategyBadge>
          <StrategyBadge tone={hasBuy ? "watch" : shouldSell ? "avoid" : "wait"}>当前动作：{actionLabel}</StrategyBadge>
          <Badge variant="secondary">下一次观察：{nextObserveAt}</Badge>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
          <span className="text-foreground">核心原因：</span>
          <HighlightedText text={decision.summary} highlights={highlightNames} />
        </p>
      </div>
      <div className="grid gap-3 xl:grid-cols-[1.05fr_1fr_1fr]">
        <div className={cn("soft-card p-4", motionClassNames.cardEnter)} style={{ animationDelay: `${staggerDelay(0)}ms` }}>
          <div className="text-xs font-medium text-muted-foreground">资产概览</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <AssetMetric label="总资产" value={formatMoney(totalAssets)} size="lg" />
            <AssetMetric label="投入本金" value={formatMoney(decision.capital)} />
            <AssetMetric label="当前现金" value={formatMoney(availableCash)} />
            <AssetMetric label="计划后现金" value={formatMoney(decision.cashReserve)} tone={decision.cashReserve < availableCash ? "warning" : "neutral"} />
          </div>
        </div>
        <div className={cn("soft-card p-4", motionClassNames.cardEnter)} style={{ animationDelay: `${staggerDelay(1)}ms` }}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-medium text-muted-foreground">持仓与盈亏</div>
            {valuationStatus !== "empty" ? <Badge variant={valuationStatus === "live" ? "success" : "warning"}>{valuationStatusLabel(valuationStatus)}</Badge> : null}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <AssetMetric label="持仓市值" value={formatMoney(currentMarketValue)} />
            <AssetMetric label="已持仓成本" value={formatMoney(investedCost)} />
            <AssetMetric label="持仓浮盈" value={formatMoney(unrealizedPnl)} tone={unrealizedPnl >= 0 ? "danger" : "success"} muted={valuationIsFallback || unrealizedPnl === 0} />
            <AssetMetric label="已实现盈亏" value={formatMoney(realizedPnl)} tone={realizedPnl >= 0 ? "danger" : "success"} muted={realizedPnl === 0} />
          </div>
          {valuationStatus !== "live" && valuationStatus !== "empty" ? (
            <p className="mt-3 text-xs leading-5 text-muted-foreground">{valuationStatusHelp(valuationStatus)}</p>
          ) : null}
        </div>
        <div className={cn("soft-card p-4", motionClassNames.cardEnter)} style={{ animationDelay: `${staggerDelay(2)}ms` }}>
          <div className="text-xs font-medium text-muted-foreground">本次计划影响</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <AssetMetric label="计划买入" value={formatMoney(decision.totalBudgetToUse)} tone={hasBuy ? "success" : "neutral"} muted={decision.totalBudgetToUse === 0} />
            <AssetMetric label="计划卖出" value={formatMoney(decision.totalSellAmount ?? 0)} tone={shouldSell ? "warning" : "neutral"} muted={(decision.totalSellAmount ?? 0) === 0} />
            <AssetMetric label="预计手续费" value={formatMoney(decision.totalEstimatedFee)} muted={decision.totalEstimatedFee === 0} />
          </div>
        </div>
      </div>
      {decision.orders.length ? (
        <div className="grid gap-3 xl:grid-cols-2">
          {decision.orders.map((order) => (
            <div key={order.symbol} className="rounded-md border border-border bg-background/30 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{order.name || order.symbol}</div>
                  <div className="mt-1 text-xs tabular-nums text-muted-foreground">{order.symbol}</div>
                </div>
                <Badge variant="success">{order.action === "add" ? "增持" : "买入"}</Badge>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <DecisionNumber label="数量" value={`${order.shares} 股/份`} />
                <DecisionNumber label="参考价" value={formatMoney(order.estimatedPrice)} />
                <DecisionNumber label="成交金额" value={formatMoney(order.amount)} />
                <DecisionNumber label="手续费" value={formatMoney(order.estimatedFee)} />
                <DecisionNumber label="总成本" value={formatMoney(order.totalCost)} className="col-span-2" />
              </div>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">{order.reason}</p>
              {order.riskControl ? <p className="mt-2 text-xs leading-5 text-muted-foreground">风控：{order.riskControl}</p> : null}
              {order.invalidIf ? <p className="mt-1 text-xs leading-5 text-amber-700 dark:text-amber-300">失效：{order.invalidIf}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
      {sellOrders.length ? (
        <div className="grid gap-3 xl:grid-cols-2">
          {sellOrders.map((order) => (
            <div key={order.symbol} className="rounded-md border border-rose-500/25 bg-rose-500/10 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{order.name || order.symbol}</div>
                  <div className="mt-1 text-xs tabular-nums text-muted-foreground">{order.symbol}</div>
                </div>
                <Badge variant="danger">{order.action === "sell" ? "卖出" : "减仓"}</Badge>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <DecisionNumber label="数量" value={`${order.shares} 股/份`} />
                <DecisionNumber label="参考价" value={formatMoney(order.estimatedPrice)} />
                <DecisionNumber label="计划市值" value={formatMoney(order.amount)} />
                <DecisionNumber label="手续费" value={formatMoney(order.estimatedFee)} />
                <DecisionNumber label="净回收" value={formatMoney(order.netProceeds)} />
                <DecisionNumber label="估算盈亏" value={formatMoney(order.estimatedPnl)} className={cn((order.estimatedPnl ?? 0) >= 0 ? "text-red-500" : "text-emerald-500")} />
              </div>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">{order.reason}</p>
              {order.riskControl ? <p className="mt-2 text-xs leading-5 text-muted-foreground">风控：{order.riskControl}</p> : null}
              {order.invalidIf ? <p className="mt-1 text-xs leading-5 text-amber-700 dark:text-amber-300">失效：{order.invalidIf}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
      <DecisionFeedbackPanel
        decisionId={decision.decisionId}
        feedback={decision.feedback}
        hasBuy={hasBuy}
        hasSell={shouldSell}
        tradeOptions={tradeOptions}
        watchlist={watchlist}
        onFeedbackSaved={onFeedbackSaved}
      />
      <p className="border-t border-border pt-3 text-xs text-muted-foreground">{decision.disclaimer}</p>
    </div>
  );
}

function valuationStatusLabel(status: NonNullable<FocusDecision["portfolioValuationStatus"]>) {
  if (status === "live") return "实时估值";
  if (status === "stale") return "缓存估值";
  if (status === "partial_fallback") return "部分按成本";
  if (status === "cost_fallback") return "按成本估值";
  return "暂无持仓";
}

function valuationStatusHelp(status: NonNullable<FocusDecision["portfolioValuationStatus"]>) {
  if (status === "stale") return "当前持仓市值使用最近一次可用报价估算，浮盈会随报价缓存更新。";
  if (status === "partial_fallback") return "部分持仓暂缺可用报价，缺失部分按持仓成本估值。";
  if (status === "cost_fallback") return "当前持仓暂缺可用报价，市值按持仓成本估算，浮盈会在报价恢复后更新。";
  return "";
}

function NotificationBadge({ notification }: { notification?: FocusDecision["notification"] }) {
  if (!notification) return <span className="rounded-full border border-border/70 px-2 py-0.5 text-muted-foreground">推送待确认</span>;
  if (!notification.skipped) return <Badge variant="success">已推送手机</Badge>;
  return <span className="rounded-full border border-border/70 px-2 py-0.5 text-muted-foreground">未推送：{notificationReasonLabel(notification.reason)}</span>;
}

function NotificationStatus({ notification }: { notification: NonNullable<FocusDecision["notification"]> }) {
  if (!notification.skipped) {
    return (
      <div className="rounded-md border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary">
        手机推送已发送{notification.provider ? `（${notification.provider}）` : ""}：{formatDateTime(notification.sentAt)}
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
      本次未推送：{notificationReasonLabel(notification.reason)}
      {notification.error ? `。${notification.error}` : ""}
    </div>
  );
}

function HighlightedText({ text, highlights }: { text: string; highlights: string[] }) {
  const terms = highlights
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .sort((a, b) => b.length - a.length)
    .slice(0, 16);
  if (!terms.length) return <>{text}</>;
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "g");
  return (
    <>
      {text.split(pattern).map((part, index) =>
        terms.includes(part) ? (
          <span key={`${part}-${index}`} className="font-semibold text-foreground">
            {part}
          </span>
        ) : (
          part
        )
      )}
    </>
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniqueText(values: string[]) {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function notificationReasonLabel(value?: string | null) {
  const map: Record<string, string> = {
    manual_source: "手动分析不自动推送",
    fallback_decision: "兜底决策不推送",
    no_budget: "没有计划买入金额",
    no_orders: "没有形成交易计划",
    disabled: "推送未启用或配置不完整",
    deduped: "同一分析时间已推送过",
    send_failed: "发送失败"
  };
  return value ? map[value] ?? value : "未满足推送条件";
}

function DecisionNumber({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("rounded-md border border-border bg-background/40 px-3 py-2", className)}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium tabular-nums">{value}</div>
    </div>
  );
}

function AssetMetric({
  label,
  value,
  tone = "neutral",
  muted = false,
  size = "md"
}: {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "warning" | "danger";
  muted?: boolean;
  size?: "md" | "lg";
}) {
  return (
    <div className="rounded-md border border-border bg-background/35 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 font-semibold tabular-nums",
          size === "lg" ? "text-xl" : "text-base",
          muted ? "text-muted-foreground" : tone === "success" ? "text-primary" : tone === "warning" ? "text-amber-600 dark:text-amber-300" : tone === "danger" ? "text-red-500" : "text-foreground"
        )}
      >
        {value}
      </div>
    </div>
  );
}

function formatMoney(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 }).format(value);
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

function formatDate(value?: string | Date | null) {
  if (!value) return "--";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit"
  });
}
