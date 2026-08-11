"use client";

import Link from "next/link";
import { AlertTriangle, ChevronDown, ShieldAlert, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { DecisionFeedbackPanel } from "@/components/focus/DecisionFeedbackPanel";
import { StockIdentity } from "@/components/StockIdentity";
import type { FocusDecision, StockItem, TradeOption } from "@/components/focus/types";
import { StrategyBadge } from "@/components/StrategyBadge";
import { motionClassNames, staggerDelay } from "@/lib/motion";
import { formatDate, formatDateTime, formatMoney, formatPercent, formatRatio, formatShares } from "@/lib/trading/display";
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
  const riskBudget = decision.riskBudget;
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
      shares: order.shares,
      amount: order.amount,
      triggerPrice: order.triggerPrice,
      stopLossPrice: order.stopLossPrice,
      takeProfitPrice: order.takeProfitPrice,
      priority: order.priority,
      planType: order.planType,
      riskRewardRatio: order.riskRewardRatio,
      maxLossAmount: order.maxLossAmount,
      roundTripFees: order.roundTripFees,
      feeDragPct: order.feeDragPct,
      breakEvenPrice: order.breakEvenPrice,
      breakEvenMovePct: order.breakEvenMovePct,
      netExpectedProfit: order.netExpectedProfit,
      netMaxLossAmount: order.netMaxLossAmount,
      netRiskRewardRatio: order.netRiskRewardRatio,
      riskBudgetAmount: order.riskBudgetAmount,
      riskUsagePct: order.riskUsagePct,
      portfolioRiskAfterOrder: order.portfolioRiskAfterOrder,
      entryCondition: order.entryCondition,
      executionWindow: order.executionWindow,
      positionImpact: order.positionImpact
    })),
    ...sellOrders.map((order) => ({
      key: `sell:${order.symbol}`,
      symbol: order.symbol,
      name: order.name,
      side: "sell" as const,
      label: `${order.name || order.symbol} · ${order.action === "sell" ? "卖出" : "减仓"}`,
      price: order.estimatedPrice,
      shares: order.shares,
      amount: order.amount,
      triggerPrice: order.triggerPrice,
      stopLossPrice: order.stopLossPrice,
      takeProfitPrice: order.takeProfitPrice,
      priority: order.priority,
      sellRatioPct: order.sellRatioPct,
      exitCondition: order.exitCondition,
      executionWindow: order.executionWindow,
      positionImpact: order.positionImpact
    }))
  ];
  return (
    <div className="space-y-4">
      {decision.fallbackReason ? (
        <div className="glow-card rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-200">{decision.fallbackReason}</div>
      ) : null}
      <div className={cn("glow-card rounded-xl border p-5", hasBuy ? "border-primary/25 bg-primary/12" : shouldSell ? "border-rose-500/30 bg-rose-500/10" : "border-amber-500/35 bg-amber-50/70 text-foreground dark:bg-amber-500/10")}>
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
      <div className="grid gap-3 xl:grid-cols-[1.05fr_1fr_1fr]">
        <div className={cn("glow-card rounded-xl border border-border bg-background/35 p-4", motionClassNames.cardEnter)} style={{ animationDelay: `${staggerDelay(0)}ms` }}>
          <div className="text-xs font-medium text-muted-foreground">资产概览</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <AssetMetric label="总资产" value={formatMoney(totalAssets)} size="lg" />
            <AssetMetric label="投入本金" value={formatMoney(decision.capital)} />
            <AssetMetric label="当前现金" value={formatMoney(availableCash)} />
            <AssetMetric label="计划后现金" value={formatMoney(decision.cashReserve)} tone={decision.cashReserve < availableCash ? "warning" : "neutral"} />
          </div>
        </div>
        <div className={cn("glow-card rounded-xl border border-border bg-background/35 p-4", motionClassNames.cardEnter)} style={{ animationDelay: `${staggerDelay(1)}ms` }}>
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
        <div className={cn("glow-card rounded-xl border border-border bg-background/35 p-4", motionClassNames.cardEnter)} style={{ animationDelay: `${staggerDelay(2)}ms` }}>
          <div className="text-xs font-medium text-muted-foreground">本次计划影响</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <AssetMetric label="计划买入" value={formatMoney(decision.totalBudgetToUse)} tone={hasBuy ? "success" : "neutral"} muted={decision.totalBudgetToUse === 0} />
            <AssetMetric label="计划卖出" value={formatMoney(decision.totalSellAmount ?? 0)} tone={shouldSell ? "warning" : "neutral"} muted={(decision.totalSellAmount ?? 0) === 0} />
            <AssetMetric label="本次下单手续费" value={formatMoney(decision.totalEstimatedFee)} muted={decision.totalEstimatedFee === 0} />
            <AssetMetric label="买入计划双边手续费" value={formatMoney(decision.totalEstimatedRoundTripFee ?? 0)} muted={(decision.totalEstimatedRoundTripFee ?? 0) === 0} />
            <AssetMetric label="买入计划目标净收益" value={formatMoney(decision.totalExpectedNetProfit ?? 0)} tone={(decision.totalExpectedNetProfit ?? 0) >= 0 ? "danger" : "success"} muted={(decision.totalExpectedNetProfit ?? 0) === 0} />
          </div>
        </div>
      </div>
      {riskBudget ? (
        <div className="glow-card rounded-xl border border-border bg-background/35 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-medium text-muted-foreground">组合风险预算</div>
              <div className="mt-1 text-sm font-semibold">{riskBudgetStatusLabel(riskBudget.status)}</div>
            </div>
            <Badge variant={riskBudget.status === "normal" ? "success" : riskBudget.status === "tight" ? "warning" : "danger"}>
              止损覆盖 {riskBudget.positionCount ? `${riskBudget.protectedPositionCount}/${riskBudget.positionCount}` : "暂无持仓"}
            </Badge>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <AssetMetric label="现有持仓风险" value={`${formatMoney(riskBudget.openRiskAmount)} / ${formatPrecisePercent(riskBudget.openRiskPct)}`} />
            <AssetMetric label="组合风险上限" value={`${formatMoney(riskBudget.portfolioRiskLimitAmount)} / ${formatPrecisePercent(riskBudget.portfolioRiskLimitPct)}`} />
            <AssetMetric label="单笔风险上限" value={`${formatMoney(riskBudget.singleTradeRiskLimitAmount)} / ${formatPrecisePercent(riskBudget.singleTradeRiskLimitPct)}`} />
            <AssetMetric label="本次计划风险" value={formatMoney(decision.plannedRiskAmount ?? 0)} muted={!decision.plannedRiskAmount} />
            <AssetMetric label="计划后组合风险" value={`${formatMoney(decision.riskAfterPlanAmount ?? riskBudget.openRiskAmount)} / ${formatPrecisePercent(decision.riskAfterPlanPct ?? riskBudget.openRiskPct)}`} />
            <AssetMetric label="计划后剩余额度" value={formatMoney(decision.availableRiskAfterPlan ?? riskBudget.availableRiskAmount)} tone={(decision.availableRiskAfterPlan ?? riskBudget.availableRiskAmount) > 0 ? "success" : "warning"} />
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full", riskBudget.status === "normal" ? "bg-primary" : riskBudget.status === "tight" ? "bg-amber-500" : "bg-red-500")}
              style={{ width: `${Math.min(100, Math.max(0, ((decision.riskAfterPlanAmount ?? riskBudget.openRiskAmount) / Math.max(1, riskBudget.portfolioRiskLimitAmount)) * 100))}%` }}
            />
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">{riskBudget.reason}</p>
        </div>
      ) : null}
      {decision.orders.length ? (
        <div className="grid gap-3 xl:grid-cols-2">
          {decision.orders.map((order) => (
            <div key={order.symbol} className="glow-card rounded-xl border border-border bg-background/30 p-4">
              <div className="flex items-start justify-between gap-3">
                <StockIdentity symbol={order.symbol} name={order.name} />
                <Badge variant="success">{order.action === "add" ? "增持" : "买入"}</Badge>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <DecisionNumber label="策略类型" value={planTypeLabel(order.planType)} />
                <DecisionNumber label="优先级" value={priorityLabel(order.priority)} />
                <DecisionNumber label="触发价" value={formatMoney(order.triggerPrice ?? order.estimatedPrice)} />
                <DecisionNumber label="止损价" value={formatMoney(order.stopLossPrice)} />
                <DecisionNumber label="止盈价" value={formatMoney(order.takeProfitPrice)} />
                <DecisionNumber label="毛风险收益比" value={formatRatio(order.riskRewardRatio)} />
                <DecisionNumber label="净风险收益比" value={formatRatio(order.netRiskRewardRatio)} />
                <DecisionNumber label="数量" value={`${formatShares(order.shares)} 股/份`} />
                <DecisionNumber label="参考价" value={formatMoney(order.estimatedPrice)} />
                <DecisionNumber label="成交金额" value={formatMoney(order.amount)} />
                <DecisionNumber label="手续费" value={formatMoney(order.estimatedFee)} />
                <DecisionNumber label="预计双边手续费" value={formatMoney(order.roundTripFees)} />
                <DecisionNumber label="手续费占比" value={formatPrecisePercent(order.feeDragPct)} />
                <DecisionNumber label="盈亏平衡价" value={formatMoney(order.breakEvenPrice)} />
                <DecisionNumber label="盈亏平衡涨幅" value={formatPrecisePercent(order.breakEvenMovePct)} />
                <DecisionNumber label="目标净收益" value={formatMoney(order.netExpectedProfit)} className={cn((order.netExpectedProfit ?? 0) >= 0 ? "text-red-500" : "text-emerald-500")} />
                <DecisionNumber label="最大价格风险" value={formatMoney(order.maxLossAmount)} className="col-span-2" />
                <DecisionNumber label="扣费最大风险" value={formatMoney(order.netMaxLossAmount)} className="col-span-2" />
                <DecisionNumber label="单笔风险额度" value={formatMoney(order.riskBudgetAmount)} />
                <DecisionNumber label="额度使用率" value={formatPrecisePercent(order.riskUsagePct)} />
                <DecisionNumber label="下单后组合风险" value={formatMoney(order.portfolioRiskAfterOrder)} className="col-span-2" />
                <DecisionNumber label="总成本" value={formatMoney(order.totalCost)} className="col-span-2" />
              </div>
              <TradePlanDetails
                items={[
                  ["触发条件", order.entryCondition],
                  ["执行窗口", order.executionWindow],
                  ["仓位影响", order.positionImpact]
                ]}
              />
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
            <div key={order.symbol} className="glow-card rounded-xl border border-rose-500/25 bg-rose-500/10 p-4">
              <div className="flex items-start justify-between gap-3">
                <StockIdentity symbol={order.symbol} name={order.name} />
                <Badge variant="danger">{order.action === "sell" ? "卖出" : "减仓"}</Badge>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <DecisionNumber label="优先级" value={priorityLabel(order.priority)} />
                <DecisionNumber label="卖出比例" value={formatPercent(order.sellRatioPct)} />
                <DecisionNumber label="触发价" value={formatMoney(order.triggerPrice ?? order.estimatedPrice)} />
                <DecisionNumber label="止损价" value={formatMoney(order.stopLossPrice)} />
                <DecisionNumber label="止盈价" value={formatMoney(order.takeProfitPrice)} />
                <DecisionNumber label="数量" value={`${formatShares(order.shares)} 股/份`} />
                <DecisionNumber label="参考价" value={formatMoney(order.estimatedPrice)} />
                <DecisionNumber label="计划市值" value={formatMoney(order.amount)} />
                <DecisionNumber label="手续费" value={formatMoney(order.estimatedFee)} />
                <DecisionNumber label="净回收" value={formatMoney(order.netProceeds)} />
                <DecisionNumber label="估算盈亏" value={formatMoney(order.estimatedPnl)} className={cn((order.estimatedPnl ?? 0) >= 0 ? "text-red-500" : "text-emerald-500")} />
              </div>
              <TradePlanDetails
                items={[
                  ["退出条件", order.exitCondition],
                  ["执行窗口", order.executionWindow],
                  ["仓位影响", order.positionImpact]
                ]}
              />
              <p className="mt-4 text-sm leading-6 text-muted-foreground">{order.reason}</p>
              {order.riskControl ? <p className="mt-2 text-xs leading-5 text-muted-foreground">风控：{order.riskControl}</p> : null}
              {order.invalidIf ? <p className="mt-1 text-xs leading-5 text-amber-700 dark:text-amber-300">失效：{order.invalidIf}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
      {decision.nearMisses?.length ? <NearMissPanel items={decision.nearMisses} /> : null}
      <DecisionFeedbackPanel
        decisionId={decision.decisionId}
        feedback={decision.feedback}
        hasBuy={hasBuy}
        hasSell={shouldSell}
        tradeOptions={tradeOptions}
        watchlist={watchlist}
        onFeedbackSaved={onFeedbackSaved}
      />
      {decision.strategyHealthGates?.length ? <StrategyHealthGatePanel decision={decision} /> : null}
      <p className="border-t border-border pt-3 text-xs text-muted-foreground">{decision.disclaimer}</p>
    </div>
  );
}

function NearMissPanel({ items }: { items: NonNullable<FocusDecision["nearMisses"]> }) {
  return (
    <div className="overflow-hidden rounded-lg border border-amber-500/30 bg-amber-500/10">
      <div className="flex items-start gap-3 border-b border-amber-500/20 px-4 py-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <div>
          <div className="text-sm font-semibold">接近触发，但本次没有形成交易指令</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">这里展示离阈值最近或已过量化阈值但仍被其他风控拦截的候选，仅用于提前观察。</p>
        </div>
      </div>
      <div className="grid gap-px bg-border/65 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <div key={`${item.side}:${item.symbol}`} className="bg-card/95 p-3.5">
            <div className="flex items-start justify-between gap-3">
              <StockIdentity symbol={item.symbol} name={item.name} compact />
              <Badge variant="warning">{item.score.toFixed(1)} / {item.threshold.toFixed(1)}</Badge>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {item.scoreGap > 0 ? `距离阈值还差 ${item.scoreGap.toFixed(1)} 分` : "量化分已达到阈值，仍待其他条件确认"}
              {item.entryPermission === "reduce_size" ? " · 仅允许半仓" : item.entryPermission === "pause" ? " · 健康门控暂停" : ""}
            </div>
            <ul className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
              {item.blockers.slice(0, 3).map((blocker) => <li key={blocker}>• {blocker}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function StrategyHealthGatePanel({ decision }: { decision: FocusDecision }) {
  const gates = decision.strategyHealthGates ?? [];
  const summary = decision.strategyHealthSummary;
  const hasPause = (summary?.paused ?? 0) > 0;
  return (
    <details className="group overflow-hidden rounded-lg border border-border bg-background/35">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-3 marker:content-none">
        {hasPause ? <ShieldAlert className="h-4 w-4 text-amber-500" /> : <ShieldCheck className="h-4 w-4 text-primary" />}
        <span className="text-sm font-semibold">样本外策略门控</span>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="success">允许 {summary?.allowed ?? 0}</Badge>
          <Badge variant="warning">半仓 {summary?.reduced ?? 0}</Badge>
          <Badge variant="danger">暂停 {summary?.paused ?? 0}</Badge>
        </div>
        {summary?.generatedAt ? <span className="text-xs text-muted-foreground">更新于 {formatDateTime(summary.generatedAt)}</span> : null}
        <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="grid gap-px border-t border-border/70 bg-border/65 sm:grid-cols-2 xl:grid-cols-3">
        {gates.map((gate) => {
          const status = strategyGateStatus(gate.entryPermission);
          return (
            <div key={gate.symbol} className="min-w-0 bg-card/95 p-3.5">
              <div className="flex items-start justify-between gap-3">
                <StockIdentity symbol={gate.symbol} name={gate.name} compact />
                <Badge variant={status.variant}>{status.label}</Badge>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div><span className="text-muted-foreground">样本外</span><div className={cn("mt-0.5 font-semibold tabular-nums", (gate.validationReturnPct ?? 0) >= 0 ? "text-red-500" : "text-emerald-500")}>{formatSignedPercent(gate.validationReturnPct)}</div></div>
                <div><span className="text-muted-foreground">回撤</span><div className="mt-0.5 font-semibold tabular-nums text-emerald-500">{formatPrecisePercent(gate.validationMaxDrawdownPct)}</div></div>
                <div><span className="text-muted-foreground">平仓</span><div className="mt-0.5 font-semibold tabular-nums">{gate.validationClosedTrades}</div></div>
              </div>
              <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground" title={gate.reason}>{gate.reason}</p>
            </div>
          );
        })}
      </div>
      <div className="border-t border-border/70 px-4 py-3 text-right">
        <Link href="/strategy-lab" className="text-xs font-medium text-primary hover:underline">查看完整回测</Link>
      </div>
    </details>
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
  if (!notification.skipped) return <Badge variant="success">{notification.kind === "near_miss" ? "已推送近信号" : "已推送手机"}</Badge>;
  return <span className="rounded-full border border-border/70 px-2 py-0.5 text-muted-foreground">未推送：{notificationReasonLabel(notification.reason)}</span>;
}

function NotificationStatus({ notification }: { notification: NonNullable<FocusDecision["notification"]> }) {
  if (!notification.skipped) {
    return (
      <div className="glow-card rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary">
        {notification.kind === "near_miss" ? "接近触发提醒" : "手机交易计划推送"}已发送{notification.provider ? `（${notification.provider}）` : ""}：{formatDateTime(notification.sentAt)}
      </div>
    );
  }
  return (
    <div className="glow-card rounded-xl border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
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
    <div className={cn("glow-card rounded-lg border border-border bg-background/40 px-3 py-2", className)}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium tabular-nums">{value}</div>
    </div>
  );
}

function TradePlanDetails({ items }: { items: Array<[string, string | null | undefined]> }) {
  const visibleItems = items.filter((item): item is [string, string] => Boolean(item[1]?.trim()));
  if (!visibleItems.length) return null;

  return (
    <div className="mt-4 grid gap-2 text-xs">
      {visibleItems.map(([label, value]) => (
        <div key={label} className="glow-card rounded-lg border border-border/70 bg-background/35 px-3 py-2">
          <div className="font-medium text-foreground">{label}</div>
          <div className="mt-1 whitespace-pre-wrap break-words leading-5 text-muted-foreground">{value}</div>
        </div>
      ))}
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
    <div className="glow-card rounded-lg border border-border bg-background/35 px-3 py-2">
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

function formatPrecisePercent(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return `${value.toFixed(2)}%`;
}

function formatSignedPercent(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function strategyGateStatus(permission: NonNullable<FocusDecision["strategyHealthGates"]>[number]["entryPermission"]): {
  label: string;
  variant: "success" | "warning" | "danger";
} {
  if (permission === "allow") return { label: "允许", variant: "success" };
  if (permission === "reduce_size") return { label: "半仓", variant: "warning" };
  return { label: "暂停", variant: "danger" };
}

function riskBudgetStatusLabel(status: NonNullable<FocusDecision["riskBudget"]>["status"]) {
  if (status === "normal") return "风险额度正常";
  if (status === "tight") return "风险额度偏紧";
  if (status === "breached_stop") return "先处理已触发止损持仓";
  return "暂停增加新仓位";
}

function priorityLabel(value?: number | null) {
  if (!value || !Number.isFinite(value)) return "--";
  return `P${value}`;
}

function planTypeLabel(value?: FocusDecision["orders"][number]["planType"]) {
  const map: Record<NonNullable<FocusDecision["orders"][number]["planType"]>, string> = {
    pullback: "回调低吸",
    breakout: "突破确认",
    support: "支撑确认",
    trend_follow: "趋势跟随",
    add_on_strength: "强势增持",
    risk_rebalance: "调仓再平衡"
  };
  return value ? map[value] : "--";
}
