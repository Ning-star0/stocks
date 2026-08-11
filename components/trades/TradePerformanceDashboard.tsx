"use client";

import { useMemo, useState } from "react";
import { Activity, BadgePercent, CircleGauge, Scale, ShieldAlert, ShieldCheck, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TradeExecutionRecord, TradePortfolioSnapshot } from "@/components/trades/types";
import { Input } from "@/components/ui/input";
import { buildTradePerformance, type TradePerformanceSummary } from "@/lib/trades/performance";
import type { PortfolioRiskBudget } from "@/lib/trading/riskBudget";
import { formatDate, formatMoney, formatSignedMoney } from "@/lib/trading/display";
import { cn } from "@/lib/utils";

export function PortfolioOverview({ portfolio }: { portfolio: TradePortfolioSnapshot }) {
  const metrics = [
    { label: "总资产", value: formatMoney(portfolio.totalAssets), tone: portfolio.totalReturnPct !== null && portfolio.totalReturnPct >= 0 ? "positive" : "negative" },
    { label: "累计收益率", value: formatSignedPercent(portfolio.totalReturnPct), tone: portfolio.totalReturnPct !== null && portfolio.totalReturnPct >= 0 ? "positive" : "negative" },
    { label: "可用现金", value: formatMoney(portfolio.availableCash) },
    { label: "持仓市值", value: formatMoney(portfolio.currentMarketValue) },
    { label: "持仓成本", value: formatMoney(portfolio.investedCost) },
    { label: "未实现盈亏", value: formatSignedMoney(portfolio.unrealizedPnl), tone: portfolio.unrealizedPnl >= 0 ? "positive" : "negative" },
    { label: "已实现盈亏", value: formatSignedMoney(portfolio.realizedPnl), tone: portfolio.realizedPnl >= 0 ? "positive" : "negative" }
  ];
  return (
    <Card className="performance-card overflow-hidden">
      <CardContent className="grid grid-cols-2 gap-px bg-border/65 p-0 xl:grid-cols-7">
        {metrics.map((metric) => (
          <div key={metric.label} className="min-w-0 bg-card/95 px-3 py-3.5 sm:px-4">
            <div className="text-xs text-muted-foreground">{metric.label}</div>
            <div className={cn("mt-1 truncate text-lg font-semibold tabular-nums", metric.tone === "positive" ? "pnl-change-positive text-red-500" : metric.tone === "negative" ? "pnl-change-negative text-emerald-500" : "text-foreground")}>{metric.value}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function TradePerformanceDashboard({ performance, executions, capital }: {
  performance: TradePerformanceSummary;
  executions: TradeExecutionRecord[];
  capital: number;
}) {
  const [period, setPeriod] = useState<PerformancePeriod>("all");
  const [customFrom, setCustomFrom] = useState(earliestExecutionDate(executions));
  const [customTo, setCustomTo] = useState(todayInputValue());
  const periodExecutions = useMemo(
    () => filterExecutionsByPeriod(executions, period, customFrom, customTo),
    [customFrom, customTo, executions, period]
  );
  const periodPerformance = useMemo(
    () => period === "all" ? performance : buildTradePerformance(periodExecutions, capital),
    [capital, performance, period, periodExecutions]
  );
  const chartData = periodPerformance.equityCurve.map((point) => ({ ...point, date: formatDate(point.executedAt) }));
  const quality = strategyQuality(periodPerformance);
  const positive = periodPerformance.netRealizedPnl >= 0;
  const chartScale = pnlChartScale(chartData.map((point) => point.cumulativePnl));
  const metrics = [
    { label: "平仓胜率", value: formatMetricPercent(periodPerformance.winRatePct), icon: CircleGauge },
    { label: "利润因子", value: formatDecimal(periodPerformance.profitFactor), icon: TrendingUp },
    { label: "平均盈亏比", value: formatDecimal(periodPerformance.payoffRatio), icon: Scale },
    { label: "单笔期望", value: formatSignedMoney(periodPerformance.expectancy), icon: Activity, tone: pnlTone(periodPerformance.expectancy) },
    { label: "最大回撤", value: formatMoney(periodPerformance.maxDrawdown), subvalue: formatMetricPercent(periodPerformance.maxDrawdownPct), icon: TrendingDown, tone: periodPerformance.maxDrawdown > 0 ? "negative" : "neutral" },
    { label: "区间手续费率", value: formatMetricPercent(periodPerformance.feeRatePct), icon: BadgePercent }
  ];

  return (
    <Card className="performance-card overflow-hidden">
      <CardHeader className="gap-3 border-b border-border/70 bg-background/25 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            策略绩效
          </CardTitle>
          <span className={cn("rounded-md border px-2.5 py-1 text-xs font-medium", quality.className)}>{quality.label}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex h-9 items-center rounded-md border border-border bg-background/45 p-1">
            {performancePeriods.map((item) => (
              <button key={item.value} type="button" onClick={() => setPeriod(item.value)} className={cn("h-7 rounded px-2.5 text-xs font-medium transition-colors", period === item.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{item.label}</button>
            ))}
          </div>
          {period === "custom" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input aria-label="绩效开始日期" type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="h-9 w-36" />
              <span className="text-xs text-muted-foreground">至</span>
              <Input aria-label="绩效结束日期" type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="h-9 w-36" />
            </div>
          ) : null}
          <span className="text-xs text-muted-foreground">区间成交 {periodPerformance.totalTrades} 笔</span>
        </div>
      </CardHeader>
      <CardContent className="grid p-0 xl:grid-cols-[minmax(0,1.45fr)_minmax(390px,0.85fr)]">
        <div className="min-w-0 border-b border-border/70 p-4 xl:border-b-0 xl:border-r">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-xs text-muted-foreground">累计已实现盈亏</div>
              <div key={`${period}:${periodPerformance.netRealizedPnl}`} className={cn("mt-1 text-2xl font-semibold tabular-nums", positive ? "pnl-change-positive text-red-500" : "pnl-change-negative text-emerald-500")}>{formatSignedMoney(periodPerformance.netRealizedPnl)}</div>
            </div>
            <div className="flex gap-4 text-right text-xs text-muted-foreground">
              <span>盈利 {periodPerformance.winningTrades}</span>
              <span>亏损 {periodPerformance.losingTrades}</span>
              <span>平仓 {periodPerformance.closedTrades}</span>
            </div>
          </div>
          {chartData.length ? (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="tradePnlStroke" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ef4444" />
                      <stop offset={chartScale.zeroOffset} stopColor="#ef4444" />
                      <stop offset={chartScale.zeroOffset} stopColor="#10b981" />
                      <stop offset="100%" stopColor="#10b981" />
                    </linearGradient>
                    <linearGradient id="tradePnlFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ef4444" stopOpacity={0.28} />
                      <stop offset={chartScale.zeroOffset} stopColor="#ef4444" stopOpacity={0.04} />
                      <stop offset={chartScale.zeroOffset} stopColor="#10b981" stopOpacity={0.04} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.28} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 4" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis domain={chartScale.domain} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={52} />
                  <Tooltip
                    formatter={(value) => [formatSignedMoney(Number(value)), "累计盈亏"]}
                    labelFormatter={(label) => `日期 ${label}`}
                    contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", fontSize: 12 }}
                  />
                  <Area type="linear" dataKey="cumulativePnl" stroke="url(#tradePnlStroke)" strokeWidth={2} fill="url(#tradePnlFill)" dot={<PnlDot />} activeDot={<PnlDot active />} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-56 items-center justify-center border-y border-dashed border-border text-sm text-muted-foreground">当前时间范围没有成交记录</div>
          )}
        </div>
        <div className="grid grid-cols-2 content-start divide-x divide-y divide-border/65">
          {metrics.map((metric) => {
            const Icon = metric.icon;
            return (
              <div key={metric.label} className="min-w-0 p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" />
                  {metric.label}
                </div>
                <div className={cn("mt-2 truncate text-lg font-semibold tabular-nums", metric.tone === "positive" ? "text-red-500" : metric.tone === "negative" ? "text-emerald-500" : "text-foreground")}>{metric.value}</div>
                {metric.subvalue ? <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">{metric.subvalue}</div> : null}
              </div>
            );
          })}
          <div className="col-span-2 flex items-center justify-between gap-4 p-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-2"><Wallet className="h-3.5 w-3.5" />总成交额 {formatMoney(performance.turnover)}</span>
            <span>手续费 {formatMoney(performance.totalFees)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function pnlChartScale(values: number[]) {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  if (min === 0 && max === 0) return { domain: [-1, 1] as [number, number], zeroOffset: "50%" };
  const span = max - min;
  const domainMin = min < 0 ? min - span * 0.08 : 0;
  const domainMax = max > 0 ? max + span * 0.08 : 0;
  const zeroOffset = domainMax / (domainMax - domainMin) * 100;
  return {
    domain: [domainMin, domainMax] as [number, number],
    zeroOffset: `${Math.max(0, Math.min(100, zeroOffset)).toFixed(2)}%`
  };
}

function PnlDot({ cx, cy, payload, active = false }: { cx?: number; cy?: number; payload?: { cumulativePnl?: number }; active?: boolean }) {
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  const color = (payload?.cumulativePnl ?? 0) < 0 ? "#10b981" : "#ef4444";
  return <circle cx={cx} cy={cy} r={active ? 5 : 3} fill={color} stroke="hsl(var(--card))" strokeWidth={active ? 2 : 1} />;
}

export function PortfolioRiskDashboard({ riskBudget }: { riskBudget: PortfolioRiskBudget }) {
  const status = riskBudgetStatus(riskBudget.status);
  const StatusIcon = riskBudget.status === "normal" ? ShieldCheck : ShieldAlert;
  const utilization = Math.min(100, Math.max(0, riskBudget.riskUtilizationPct));
  const metrics = [
    { label: "现有持仓风险", value: formatMoney(riskBudget.openRiskAmount), subvalue: formatMetricPercent(riskBudget.openRiskPct) },
    { label: "组合风险上限", value: formatMoney(riskBudget.portfolioRiskLimitAmount), subvalue: formatMetricPercent(riskBudget.portfolioRiskLimitPct) },
    { label: "剩余风险额度", value: formatMoney(riskBudget.availableRiskAmount) },
    { label: "单笔风险上限", value: formatMoney(riskBudget.singleTradeRiskLimitAmount), subvalue: formatMetricPercent(riskBudget.singleTradeRiskLimitPct) },
    { label: "止损覆盖", value: riskBudget.positionCount ? `${riskBudget.protectedPositionCount} / ${riskBudget.positionCount}` : "暂无持仓", subvalue: formatMetricPercent(riskBudget.stopCoveragePct) }
  ];

  return (
    <Card className="performance-card overflow-hidden">
      <CardHeader className="flex-row items-center justify-between gap-3 border-b border-border/70 bg-background/25 p-4">
        <CardTitle className="flex items-center gap-2">
          <StatusIcon className="h-4 w-4 text-primary" />
          组合风险预算
        </CardTitle>
        <span className={cn("rounded-md border px-2.5 py-1 text-xs font-medium", status.className)}>{status.label}</span>
      </CardHeader>
      <CardContent className="p-0">
        <div className="grid grid-cols-2 gap-px bg-border/65 lg:grid-cols-5">
          {metrics.map((metric) => (
            <div key={metric.label} className="min-w-0 bg-card/95 px-4 py-3.5">
              <div className="text-xs text-muted-foreground">{metric.label}</div>
              <div className="mt-1 truncate text-lg font-semibold tabular-nums">{metric.value}</div>
              {metric.subvalue ? <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">{metric.subvalue}</div> : null}
            </div>
          ))}
        </div>
        <div className="space-y-2 border-t border-border/70 px-4 py-3">
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>风险额度使用</span>
            <span className="tabular-nums">{formatMetricPercent(riskBudget.riskUtilizationPct)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full", status.barClassName)} style={{ width: `${utilization}%` }} />
          </div>
          <p className="text-xs leading-5 text-muted-foreground">{riskBudget.reason}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function strategyQuality(performance: TradePerformanceSummary) {
  if (performance.closedTrades < 5) return { label: "样本积累中", className: "border-border bg-muted/40 text-muted-foreground" };
  if ((performance.profitFactor ?? 0) >= 1.5 && (performance.payoffRatio ?? 0) >= 1.2) return { label: "收益结构健康", className: "border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-300" };
  if ((performance.profitFactor ?? 0) >= 1) return { label: "收益结构待优化", className: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300" };
  return { label: "风险收益失衡", className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" };
}

function riskBudgetStatus(status: PortfolioRiskBudget["status"]) {
  if (status === "normal") return { label: "额度正常", className: "border-primary/25 bg-primary/10 text-primary", barClassName: "bg-primary" };
  if (status === "tight") return { label: "额度偏紧", className: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300", barClassName: "bg-amber-500" };
  if (status === "breached_stop") return { label: "止损待处理", className: "border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-300", barClassName: "bg-red-500" };
  return { label: "暂停加仓", className: "border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-300", barClassName: "bg-red-500" };
}

function formatSignedPercent(value: number | null) {
  return value === null ? "--" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatMetricPercent(value: number | null) {
  return value === null ? "--" : `${value.toFixed(2)}%`;
}

function formatDecimal(value: number | null) {
  return value === null ? "--" : value.toFixed(2);
}

type PerformancePeriod = "all" | "7d" | "30d" | "90d" | "custom";

const performancePeriods: Array<{ value: PerformancePeriod; label: string }> = [
  { value: "all", label: "全部" },
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
  { value: "90d", label: "90 天" },
  { value: "custom", label: "自定义" }
];

function filterExecutionsByPeriod(
  executions: TradeExecutionRecord[],
  period: PerformancePeriod,
  customFrom: string,
  customTo: string
) {
  if (period === "all") return executions;
  const now = new Date();
  const start = period === "custom"
    ? startOfDay(customFrom)
    : new Date(now.getTime() - Number(period.replace("d", "")) * 86400000);
  const end = period === "custom" ? endOfDay(customTo) : now;
  return executions.filter((execution) => {
    const time = new Date(execution.executedAt).getTime();
    return Number.isFinite(time) && time >= start.getTime() && time <= end.getTime();
  });
}

function earliestExecutionDate(executions: TradeExecutionRecord[]) {
  if (!executions.length) return todayInputValue();
  const earliest = [...executions].sort((a, b) => new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime())[0];
  return dateInputValue(new Date(earliest.executedAt));
}

function startOfDay(value: string) {
  const date = value ? new Date(`${value}T00:00:00`) : new Date(0);
  return Number.isFinite(date.getTime()) ? date : new Date(0);
}

function endOfDay(value: string) {
  const date = value ? new Date(`${value}T23:59:59.999`) : new Date();
  return Number.isFinite(date.getTime()) ? date : new Date();
}

function todayInputValue() {
  return dateInputValue(new Date());
}

function dateInputValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function pnlTone(value: number | null) {
  if (value === null || value === 0) return "neutral" as const;
  return value > 0 ? "positive" as const : "negative" as const;
}
