"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, ChartNoAxesCombined, FlaskConical, Loader2, Play, ShieldCheck } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { StockIdentity } from "@/components/StockIdentity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageContainer, SectionHeader } from "@/components/ui/layout";
import { Select } from "@/components/ui/select";
import { readJsonResponse } from "@/lib/clientApi";
import type { StrategyBacktestComparison, StrategyBacktestPortfolioSummary, StrategyBacktestResult } from "@/lib/strategy/backtest";
import { formatDate, formatDateTime, formatMoney, formatSignedMoney } from "@/lib/trading/display";
import { cn } from "@/lib/utils";
import type { ForecastCalibrationSummary } from "@/lib/validation/shadowForecastStore";

type BacktestOptions = {
  instruments: Array<{ symbol: string; name: string | null; isHolding: boolean; isFocused: boolean }>;
  defaults: { symbols: string[]; range: string; initialCapital: number };
};

type BacktestResponse = { generatedAt: string; portfolioSummary: StrategyBacktestPortfolioSummary | null; comparisons: StrategyBacktestComparison[] };

export default function StrategyLabPage() {
  const [options, setOptions] = useState<BacktestOptions | null>(null);
  const [symbols, setSymbols] = useState<string[]>([]);
  const [range, setRange] = useState("2y");
  const [initialCapital, setInitialCapital] = useState(100000);
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [calibration, setCalibration] = useState<ForecastCalibrationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [response, calibrationResponse] = await Promise.all([
          fetch("/api/strategy-backtest", { cache: "no-store" }),
          fetch("/api/forecast-calibration", { cache: "no-store" })
        ]);
        const data = await readJsonResponse<BacktestOptions>(response);
        setOptions(data);
        setSymbols(data.defaults.symbols);
        setRange(data.defaults.range);
        setInitialCapital(data.defaults.initialCapital);
        try {
          setCalibration(await readJsonResponse<ForecastCalibrationSummary>(calibrationResponse));
        } catch (calibrationLoadError) {
          setCalibrationError(calibrationLoadError instanceof Error ? calibrationLoadError.message : "影子校准读取失败。");
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "回测配置读取失败。");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function toggleSymbol(symbol: string) {
    setError(null);
    setSymbols((current) => {
      if (current.includes(symbol)) return current.filter((item) => item !== symbol);
      if (current.length >= 8) {
        setError("单次最多回测 8 个标的。");
        return current;
      }
      return [...current, symbol];
    });
  }

  async function runBacktest() {
    if (!symbols.length) return setError("请至少选择一个标的。");
    if (!Number.isFinite(initialCapital) || initialCapital < 1000) return setError("初始资金不能低于 1000 元。");
    setRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/strategy-backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols, range, initialCapital })
      });
      setResult(await readJsonResponse<BacktestResponse>(response));
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "策略回测失败。");
    } finally {
      setRunning(false);
    }
  }

  return (
    <PageContainer>
      <SectionHeader eyebrow="交易策略" title="策略回测" action={<Badge variant="secondary">收盘信号 / 次日开盘成交</Badge>} />
      {error ? <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div> : null}
      {calibrationError ? <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">影子校准暂不可用：{calibrationError}</div> : null}
      {calibration ? <ForecastCalibrationPanel summary={calibration} /> : null}

      <Card className="performance-card overflow-hidden">
        <CardHeader className="border-b border-border/70 bg-background/25 p-4">
          <CardTitle className="flex items-center gap-2"><ChartNoAxesCombined className="h-4 w-4 text-primary" />回测参数</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {(options?.instruments ?? []).map((item) => (
              <label key={item.symbol} className={cn("flex min-w-0 cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 transition-colors", symbols.includes(item.symbol) ? "border-primary/35 bg-primary/8" : "border-border bg-background/35 hover:bg-muted/35")}>
                <input type="checkbox" checked={symbols.includes(item.symbol)} onChange={() => toggleSymbol(item.symbol)} className="h-4 w-4 accent-primary" />
                <div className="min-w-0 flex-1"><StockIdentity symbol={item.symbol} name={item.name} compact /></div>
                {item.isHolding ? <Badge variant="warning">持仓</Badge> : item.isFocused ? <Badge variant="secondary">关注</Badge> : null}
              </label>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-[180px_220px_1fr_auto] md:items-end">
            <Field label="历史范围">
              <Select value={range} onChange={(event) => setRange(event.target.value)}><option value="1y">近 1 年</option><option value="2y">近 2 年</option></Select>
            </Field>
            <Field label="单标的初始资金">
              <Input type="number" min={1000} step={1000} value={initialCapital} onChange={(event) => setInitialCapital(Number(event.target.value))} />
            </Field>
            <div className="text-xs leading-5 text-muted-foreground">每个标的独立使用相同资金，结果不能直接相加。系统比较当前、均衡、严格三套过滤条件，并计入最低手续费和整手限制。</div>
            <Button onClick={() => void runBacktest()} disabled={loading || running || !symbols.length} className="min-w-32">
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}{running ? "计算中" : "运行回测"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {result ? <div className="space-y-4">{result.portfolioSummary ? <PortfolioValidation summary={result.portfolioSummary} /> : null}{result.comparisons.map((comparison) => <ComparisonPanel key={comparison.symbol} comparison={comparison} />)}<div className="text-right text-xs text-muted-foreground">计算时间 {formatDateTime(result.generatedAt)}</div></div> : null}
    </PageContainer>
  );
}

function ForecastCalibrationPanel({ summary }: { summary: ForecastCalibrationSummary }) {
  const report = summary.overall;
  const enoughSamples = report.sampleSize >= report.minimumSampleSize;
  return (
    <Card className="performance-card overflow-hidden">
      <CardHeader className="flex-row items-start justify-between gap-3 border-b border-border/70 bg-background/25 p-4">
        <div>
          <CardTitle className="flex items-center gap-2"><FlaskConical className="h-4 w-4 text-primary" />AI 条件计划影子校准</CardTitle>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">只观察分析之后的真实价格路径，包含交易费用；结果不会自动解锁买入或提高仓位。</p>
        </div>
        <Badge variant={enoughSamples ? "warning" : "secondary"}>{enoughSamples ? "样本达标，仍仅观察" : `样本 ${report.sampleSize}/${report.minimumSampleSize}`}</Badge>
      </CardHeader>
      <CardContent className="p-0">
        <div className="grid sm:grid-cols-2 xl:grid-cols-5">
          <SummaryMetric label="等待结算" value={String(summary.counts.pending)} />
          <SummaryMetric label="已结算" value={String(summary.counts.resolved)} />
          <SummaryMetric label="无效样本" value={String(summary.counts.invalid)} />
          <SummaryMetric label="追踪失败" value={String(summary.counts.failedChecks)} hint="保持等待并重试" />
          <SummaryMetric label="基准待满周期" value={String(summary.counts.benchmarkPending)} />
          <SummaryMetric label="Brier Score" value={formatDecimal(report.brierScore)} hint="越低越好" />
          <SummaryMetric label="基准 Brier" value={formatDecimal(report.baselineBrierScore)} hint="与样本平均胜率比较" />
          <SummaryMetric label="扣费后平均收益" value={formatSignedPercent(summary.averageNetReturnPct)} positive={(summary.averageNetReturnPct ?? 0) > 0} />
          <SummaryMetric label="同期持有基准" value={formatSignedPercent(summary.averageBenchmarkNetReturnPct)} positive={(summary.averageBenchmarkNetReturnPct ?? 0) > 0} hint={`${summary.benchmarkSampleSize} 个完整周期`} />
          <SummaryMetric label="平均超额收益" value={formatSignedPercent(summary.averageExcessNetReturnPct)} positive={(summary.averageExcessNetReturnPct ?? 0) > 0} />
        </div>
        <div className="grid gap-4 border-t border-border/70 p-4 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)]">
          <div className="space-y-2 text-xs leading-5 text-muted-foreground">
            <div className="flex justify-between gap-3"><span>实际目标先达率</span><b className="text-foreground">{report.observedWinRate === null ? "--" : formatPercent(report.observedWinRate * 100)}</b></div>
            <div className="flex justify-between gap-3"><span>正净收益比例</span><b className="text-foreground">{summary.positiveNetReturnRate === null ? "--" : formatPercent(summary.positiveNetReturnRate * 100)}</b></div>
            <div className="flex justify-between gap-3"><span>校准误差 ECE</span><b className="text-foreground">{formatDecimal(report.expectedCalibrationError)}</b></div>
            <div className="flex justify-between gap-3"><span>最近结算</span><b className="text-foreground">{summary.latestResolvedAt ? formatDateTime(summary.latestResolvedAt) : "--"}</b></div>
          </div>
          <div className="space-y-1.5">
            {report.limitations.map((limitation) => <div key={limitation} className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />{limitation}</div>)}
          </div>
        </div>
        {report.bins.length ? (
          <div className="overflow-x-auto border-t border-border/70">
            <table className="w-full min-w-[620px] text-left text-xs">
              <thead className="bg-muted/25 text-muted-foreground"><tr><th className="px-4 py-2 font-medium">预测区间</th><th className="px-3 py-2 font-medium">样本</th><th className="px-3 py-2 font-medium">平均预测</th><th className="px-4 py-2 text-right font-medium">实际目标先达率</th></tr></thead>
              <tbody className="divide-y divide-border/60">{report.bins.map((bin) => <tr key={`${bin.lowerBound}-${bin.upperBound}`}><td className="px-4 py-2.5 tabular-nums">{Math.round(bin.lowerBound * 100)}%–{Math.round(bin.upperBound * 100)}%</td><td className="px-3 py-2.5 tabular-nums">{bin.sampleSize}</td><td className="px-3 py-2.5 tabular-nums">{formatPercent(bin.averageForecast * 100)}</td><td className="px-4 py-2.5 text-right tabular-nums">{formatPercent(bin.observedWinRate * 100)}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <div className="border-t border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">尚无已结算影子计划；系统会继续采集，不会用空样本推断胜率。</div>}
        {summary.recentFailures.length ? <div className="space-y-1 border-t border-border/70 p-4">{summary.recentFailures.map((item) => <div key={`${item.symbol}-${item.checkedAt}`} className="text-xs leading-5 text-amber-700 dark:text-amber-300">{item.symbol} · {item.checkedAt ? formatDateTime(item.checkedAt) : "未记录时间"} · {item.failure}</div>)}</div> : null}
      </CardContent>
    </Card>
  );
}

function ComparisonPanel({ comparison }: { comparison: StrategyBacktestComparison }) {
  const recommended = comparison.walkForward?.selectedValidation ?? comparison.results.find((item) => item.preset.id === comparison.recommendedPreset) ?? comparison.results[0];
  const chartData = useMemo(() => recommended.equityCurve.map((point) => ({ ...point, label: formatDate(point.date) })), [recommended]);
  const positive = recommended.netPnl >= 0;
  const color = positive ? "#ef4444" : "#10b981";
  return (
    <Card className="performance-card overflow-hidden">
      <CardHeader className="flex-row items-center justify-between gap-3 border-b border-border/70 bg-background/25 p-4">
        <div><StockIdentity symbol={comparison.symbol} /><div className="mt-1 text-xs text-muted-foreground">{comparison.candleCount} 根日线 · 单标的独立资金 {formatMoney(comparison.initialCapital)}{comparison.walkForward ? ` · 样本外自 ${formatDate(comparison.walkForward.validationStartDate)}` : ""}</div></div>
        <Badge variant={healthBadge(comparison.strategyHealth).variant}>{healthBadge(comparison.strategyHealth).label}</Badge>
      </CardHeader>
      <CardContent className="p-0">
        <div className="grid gap-px bg-border/65 md:grid-cols-3">
          {(comparison.walkForward?.validationResults ?? comparison.results).map((item) => <PresetResult key={item.preset.id} validation={item} training={comparison.walkForward?.trainingResults.find((training) => training.preset.id === item.preset.id) ?? null} selected={item.preset.id === comparison.recommendedPreset} />)}
        </div>
        <div className="grid border-t border-border/70 xl:grid-cols-[minmax(0,1.3fr)_minmax(360px,0.7fr)]">
          <div className="min-w-0 border-b border-border/70 p-4 xl:border-b-0 xl:border-r">
            <div className="mb-3 flex items-center justify-between gap-3"><span className="text-sm font-medium">{recommended.preset.name}资金曲线</span><span className={cn("text-lg font-semibold tabular-nums", positive ? "text-red-500" : "text-emerald-500")}>{formatSignedMoney(recommended.netPnl)}</span></div>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}><defs><linearGradient id={`equity-${comparison.symbol}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.25} /><stop offset="100%" stopColor={color} stopOpacity={0.02} /></linearGradient></defs><CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 4" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} minTickGap={28} /><YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={58} /><Tooltip formatter={(value) => [formatMoney(Number(value)), "资金"]} contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", fontSize: 12 }} /><Area type="monotone" dataKey="equity" stroke={color} strokeWidth={2} fill={`url(#equity-${comparison.symbol})`} dot={false} /></AreaChart></ResponsiveContainer>
            </div>
          </div>
          <div className="space-y-3 p-4">
            <div className="flex items-start gap-2 text-sm"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div><p className="font-medium leading-6">{entryPermissionLabel(comparison.entryPermission)}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{comparison.healthReason}</p></div></div>
            <p className="border-l-2 border-primary/30 pl-3 text-xs leading-5 text-muted-foreground">{comparison.recommendationNote}</p>
            {comparison.rollingGate ? <div className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-border bg-border"><Metric label="滚动原始" value={formatSignedPercent(comparison.rollingGate.ungatedReturnPct)} /><Metric label="门控后" value={formatSignedPercent(comparison.rollingGate.gatedReturnPct)} /><Metric label="改善" value={formatSignedPercent(comparison.rollingGate.returnImprovementPct)} /></div> : null}
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border">
              <Metric label="利润因子" value={formatDecimal(recommended.profitFactor)} />
              <Metric label="胜率" value={formatPercent(recommended.winRatePct)} />
              <Metric label="最大回撤" value={formatPercent(recommended.maxDrawdownPct)} negative />
              <Metric label="手续费拖累" value={formatPercent(recommended.feeDragPct)} />
              <Metric label="平均持有" value={recommended.averageHoldingDays === null ? "--" : `${recommended.averageHoldingDays.toFixed(1)} 天`} />
              <Metric label="资金暴露" value={formatPercent(recommended.exposurePct)} />
            </div>
            <div className="space-y-1.5">{recommended.warnings.map((warning) => <div key={warning} className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />{warning}</div>)}</div>
          </div>
        </div>
        <div className="border-t border-border/70">
          <div className="flex items-center justify-between gap-3 px-4 py-3"><span className="text-sm font-medium">最近平仓</span><span className="text-xs text-muted-foreground">共 {recommended.closedTrades} 笔</span></div>
          {recommended.trades.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="border-y border-border/70 bg-muted/25 text-muted-foreground"><tr><th className="px-4 py-2 font-medium">买入</th><th className="px-3 py-2 font-medium">卖出</th><th className="px-3 py-2 font-medium">数量</th><th className="px-3 py-2 font-medium">价格</th><th className="px-3 py-2 font-medium">持有</th><th className="px-3 py-2 font-medium">费用</th><th className="px-4 py-2 text-right font-medium">净盈亏</th></tr></thead><tbody className="divide-y divide-border/60">{recommended.trades.slice(-8).reverse().map((trade, index) => <tr key={`${trade.entryDate}-${trade.exitDate}-${index}`}><td className="px-4 py-2.5">{formatDate(trade.entryDate)}</td><td className="px-3 py-2.5">{formatDate(trade.exitDate)}</td><td className="px-3 py-2.5 tabular-nums">{trade.shares}</td><td className="px-3 py-2.5 tabular-nums">{trade.entryPrice.toFixed(3)} → {trade.exitPrice.toFixed(3)}</td><td className="px-3 py-2.5 tabular-nums">{trade.holdingDays} 天</td><td className="px-3 py-2.5 tabular-nums">{formatMoney(trade.entryFee + trade.exitFee)}</td><td className={cn("px-4 py-2.5 text-right font-semibold tabular-nums", trade.netPnl >= 0 ? "text-red-500" : "text-emerald-500")}>{formatSignedMoney(trade.netPnl)}</td></tr>)}</tbody></table></div> : <div className="border-t border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">当前资金与约束下没有完成平仓。</div>}
        </div>
      </CardContent>
    </Card>
  );
}

function PresetResult({ validation, training, selected }: { validation: StrategyBacktestResult; training: StrategyBacktestResult | null; selected: boolean }) {
  const positive = validation.netReturnPct >= 0;
  return <div className="bg-card/95 p-4"><div className="flex items-center justify-between gap-2"><span className="font-medium">{validation.preset.name}</span>{selected ? <span className="flex items-center gap-1 text-xs font-medium text-primary"><Activity className="h-4 w-4" />训练选中</span> : null}</div><p className="mt-1 min-h-10 text-xs leading-5 text-muted-foreground">{validation.preset.description}</p><div className="mt-3 text-xs text-muted-foreground">后段样本外净收益</div><div className={cn("mt-1 text-2xl font-semibold tabular-nums", positive ? "text-red-500" : "text-emerald-500")}>{formatSignedPercent(validation.netReturnPct)}</div><div className="mt-3 grid grid-cols-4 gap-2 text-xs"><span>训练<br /><b className={cn("tabular-nums", (training?.netReturnPct ?? 0) >= 0 ? "text-red-500" : "text-emerald-500")}>{formatSignedPercent(training?.netReturnPct ?? null)}</b></span><span>超额<br /><b className={cn("tabular-nums", (validation.excessReturnPct ?? 0) >= 0 ? "text-red-500" : "text-emerald-500")}>{formatSignedPercent(validation.excessReturnPct)}</b></span><span>回撤<br /><b className="tabular-nums text-emerald-500">{formatPercent(validation.maxDrawdownPct)}</b></span><span>平仓<br /><b className="tabular-nums">{validation.closedTrades}</b></span></div></div>;
}

function PortfolioValidation({ summary }: { summary: StrategyBacktestPortfolioSummary }) {
  const validated = summary.status === "validated";
  const rolling = summary.rollingGate;
  return (
    <Card className="performance-card overflow-hidden">
      <CardContent className="p-0">
        <div className="grid lg:grid-cols-[minmax(280px,1.15fr)_repeat(4,minmax(130px,0.55fr))]">
          <div className="border-b border-border/70 p-4 lg:border-b-0 lg:border-r">
            <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className={cn("h-4 w-4", validated ? "text-primary" : "text-amber-500")} />跨标的样本外验证</div>
            <div className="mt-2 flex flex-wrap items-center gap-2"><span className="text-xl font-semibold">{summary.recommendedPresetName}</span><Badge variant={validated ? "success" : "warning"}>{summary.status === "validated" ? "允许按策略开仓" : summary.status === "weak" ? "暂停新增仓位" : "仅小仓观察"}</Badge></div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{summary.note}</p>
          </div>
          <SummaryMetric label="训练平均收益" value={formatSignedPercent(summary.trainingAverageReturnPct)} positive={summary.trainingAverageReturnPct >= 0} />
          <SummaryMetric label="样本外平均收益" value={formatSignedPercent(summary.validationAverageReturnPct)} positive={summary.validationAverageReturnPct >= 0} />
          <SummaryMetric label="样本外平均回撤" value={formatPercent(summary.validationAverageMaxDrawdownPct)} negative />
          <SummaryMetric label="样本覆盖" value={`${summary.validationProfitableSymbols} / ${summary.symbolCount}`} hint={`${summary.validationClosedTrades} 笔平仓`} />
        </div>
        {rolling ? (
          <div className="grid border-t border-border/70 lg:grid-cols-[minmax(280px,1.15fr)_repeat(4,minmax(130px,0.55fr))]">
            <div className="border-b border-border/70 p-4 lg:border-b-0 lg:border-r">
              <div className="flex items-center gap-2 text-sm font-semibold"><Activity className="h-4 w-4 text-primary" />滚动门控实测</div>
              <div className="mt-2"><Badge variant={rolling.status === "improved" ? "success" : rolling.status === "worse" ? "danger" : "secondary"}>{rolling.status === "improved" ? "降低历史亏损" : rolling.status === "worse" ? "门控拖累收益" : "影响中性"}</Badge></div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">每段只使用此前数据决定下一段仓位，避免用当前段结果反推门控。</p>
            </div>
            <SummaryMetric label="不启用门控" value={formatSignedPercent(rolling.ungatedAverageReturnPct)} positive={rolling.ungatedAverageReturnPct >= 0} />
            <SummaryMetric label="启用门控" value={formatSignedPercent(rolling.gatedAverageReturnPct)} positive={rolling.gatedAverageReturnPct >= 0} />
            <SummaryMetric label="平均改善" value={formatSignedPercent(rolling.averageImprovementPct)} positive={rolling.averageImprovementPct >= 0} />
            <SummaryMetric label="改善标的" value={`${rolling.improvedSymbols} / ${rolling.symbolCount}`} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SummaryMetric({ label, value, hint, positive, negative }: { label: string; value: string; hint?: string; positive?: boolean; negative?: boolean }) { return <div className="border-b border-border/70 p-4 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0"><div className="text-xs text-muted-foreground">{label}</div><div className={cn("mt-1 text-xl font-semibold tabular-nums", positive ? "text-red-500" : negative ? "text-emerald-500" : "")}>{value}</div>{hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}</div>; }

function Metric({ label, value, negative = false }: { label: string; value: string; negative?: boolean }) { return <div className="bg-card px-3 py-2"><div className="text-xs text-muted-foreground">{label}</div><div className={cn("mt-1 font-semibold tabular-nums", negative ? "text-emerald-500" : "")}>{value}</div></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">{label}</span>{children}</label>; }
function formatPercent(value: number | null) { return value === null ? "--" : `${value.toFixed(2)}%`; }
function formatSignedPercent(value: number | null) { return value === null ? "--" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`; }
function formatDecimal(value: number | null) { return value === null ? "--" : value.toFixed(2); }
function healthBadge(health: StrategyBacktestComparison["strategyHealth"]): { label: string; variant: "success" | "warning" | "danger" | "secondary" } { if (health === "healthy") return { label: "策略健康", variant: "success" }; if (health === "pause") return { label: "暂停新开仓", variant: "danger" }; if (health === "watch") return { label: "半仓观察", variant: "warning" }; return { label: "样本不足", variant: "secondary" }; }
function entryPermissionLabel(permission: StrategyBacktestComparison["entryPermission"]) { if (permission === "allow") return "允许按现有风控开仓"; if (permission === "pause") return "暂停该标的新开仓"; return "新开仓降至建议仓位的 50%"; }
