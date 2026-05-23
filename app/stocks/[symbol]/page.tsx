import Link from "next/link";

import { AnalyzeStockButton } from "@/components/AnalyzeStockButton";
import { AiAnalysisPanel } from "@/components/AiAnalysisPanel";
import { IndicatorPanel } from "@/components/IndicatorPanel";
import { NewsPanel } from "@/components/NewsPanel";
import { PositionEditor } from "@/components/PositionEditor";
import { RiskBadge } from "@/components/RiskBadge";
import { StrategyBadge, trendToStrategy } from "@/components/StrategyBadge";
import { StockChart } from "@/components/StockChart";
import { TrendBadge } from "@/components/TrendBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageContainer } from "@/components/ui/layout";
import { AppError } from "@/lib/errors";
import { getCurrentUser } from "@/lib/currentUser";
import { calculateIndicators } from "@/lib/indicators";
import { prisma } from "@/lib/prisma";
import { getQuote } from "@/lib/services/quoteService";
import { getStockDataProvider } from "@/lib/stock-data";
import type { AiAnalysisResult, Candle, IndicatorSnapshot } from "@/lib/types";
import { formatNumber, formatPercent, formatPriceValue, isIndexSymbol, toNumber } from "@/lib/utils";

const rangeOptions = [
  { value: "1mo", label: "1月" },
  { value: "3mo", label: "3月" },
  { value: "6mo", label: "6月" },
  { value: "1y", label: "1年" },
  { value: "2y", label: "2年" },
  { value: "5y", label: "5年" },
  { value: "all", label: "全部" }
];

const intradayRangeOptions = [
  { value: "1d", label: "最近交易日" },
  { value: "5d", label: "5日" },
  { value: "1mo", label: "1月" },
  { value: "3mo", label: "3月" }
];

const intervalOptions = [
  { value: "1m", label: "分时" },
  { value: "5m", label: "5分" },
  { value: "15m", label: "15分" },
  { value: "30m", label: "30分" },
  { value: "60m", label: "60分" },
  { value: "1d", label: "日K" },
  { value: "1wk", label: "周K" },
  { value: "1mo", label: "月K" }
];

export default async function StockDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ symbol: string }>;
  searchParams?: Promise<{ range?: string; interval?: string }>;
}) {
  const { symbol } = await params;
  const query = (await searchParams) ?? {};
  const normalized = symbol.toUpperCase();
  const interval = normalizeInterval(query.interval);
  const range = normalizeRange(query.range, interval);
  const user = await getCurrentUser();
  const provider = getStockDataProvider();
  const quote = await getQuote(normalized);
  const quoteSymbol = quote.raw?.symbol ?? quote.symbol;
  // A 股代码可能带 .SH/.SZ/.BJ 后缀，查询时把几种格式都覆盖
  const symbolVariants = [normalized, quoteSymbol, ...expandChinaSymbol(normalized)];
  const candles = quote.raw ? await provider.getHistory(quoteSymbol, range, interval) : [];

  const [latestAnalysis, watchlistItem] = await Promise.all([
    prisma.aiAnalysis.findFirst({
      where: { userId: user.id, symbol: { in: symbolVariants } },
      orderBy: { createdAt: "desc" }
    }),
    prisma.watchlistItem.findFirst({
      where: { symbol: { in: symbolVariants }, watchlist: { userId: user.id } }
    })
  ]);

  const indicatorCandles = quote.raw ? await getIndicatorCandles(provider, quoteSymbol, interval, candles) : [];
  const { indicators, indicatorError } = safeCalculateIndicators(quoteSymbol, indicatorCandles);
  const analysis = latestAnalysis?.outputJson as AiAnalysisResult | undefined;
  const displayName = quote.name ?? quoteSymbol;
  const isIndex = isIndexSymbol(quoteSymbol);
  const strategy = trendToStrategy(analysis?.trend);
  const currentAction = currentActionLabel(analysis);

  return (
    <PageContainer>
      {quote.isMock ? <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">当前为模拟数据，不代表真实行情。</div> : null}
      {quote.status === "error" || quote.status === "unavailable" ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{quote.error ?? "行情不可用。"}</div>
      ) : null}

      <Card className="soft-card">
        <CardContent className="p-5">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-semibold tracking-normal">{displayName}</h1>
                <span className="text-sm text-muted-foreground">{quoteSymbol}</span>
                <TrendBadge trend={analysis?.trend} />
                {watchlistItem ? <RiskBadge risk={watchlistItem.riskLevel} /> : null}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                <span className="text-3xl font-semibold text-foreground tabular-nums">{quote.price === null ? "--" : formatPriceValue(quote.price, { currency: quote.currency, symbol: quoteSymbol })}</span>
                <span className={quote.changePct === null ? "text-muted-foreground" : quote.changePct >= 0 ? "text-red-500" : "text-emerald-500"}>
                  {quote.changePct === null ? "--" : formatPercent(quote.changePct)}
                </span>
                <span>成交量 {quote.volume === null ? "--" : formatNumber(quote.volume)}</span>
                <span>{quote.updatedAt ? new Date(quote.updatedAt).toLocaleString("zh-CN") : "--"}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StrategyBadge tone={strategy.tone}>策略方向：{strategy.label}</StrategyBadge>
              <StrategyBadge tone={currentAction.tone}>当前动作：{currentAction.label}</StrategyBadge>
              <AnalyzeStockButton symbol={quoteSymbol} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Card>
            <CardHeader className="gap-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <CardTitle>价格走势图</CardTitle>
                <ChartControls symbol={quoteSymbol} range={range} interval={interval} />
              </div>
            </CardHeader>
            <CardContent>
              {candles.length ? <StockChart candles={candles} currency={quote.currency} symbol={quoteSymbol} unit={isIndex ? "point" : undefined} interval={interval} /> : <div className="text-sm text-muted-foreground">暂无可展示的 K 线数据。</div>}
            </CardContent>
          </Card>

          <NewsPanel symbol={quoteSymbol} name={displayName} />
          <AiAnalysisPanel
            analysis={analysis ?? null}
            createdAt={latestAnalysis?.createdAt ?? null}
            fromCache={false}
            currency={quote.currency}
            symbol={quoteSymbol}
            unit={isIndex ? "point" : undefined}
            position={{
              holdingPrice: toNumber(watchlistItem?.holdingPrice),
              positionOpenedAt: watchlistItem?.positionOpenedAt ?? null
            }}
          />
        </div>

        <div className="space-y-5">
          {indicators ? <IndicatorPanel indicators={indicators} price={quote.price} /> : <EmptyCard title="技术指标" text={indicatorError ?? "行情不可用，无法计算技术指标。"} />}
          <Card>
            <CardHeader>
              <CardTitle>持仓计划</CardTitle>
            </CardHeader>
            <CardContent>
              {watchlistItem ? (
                <PositionEditor
                  itemId={watchlistItem.id}
                  holdingPrice={toNumber(watchlistItem.holdingPrice)}
                  targetPrice={toNumber(watchlistItem.targetPrice)}
                  stopLoss={toNumber(watchlistItem.stopLoss)}
                  positionOpenedAt={watchlistItem.positionOpenedAt}
                  timeHorizon={watchlistItem.timeHorizon}
                  riskLevel={watchlistItem.riskLevel}
                  note={watchlistItem.note}
                />
              ) : (
                <div className="text-sm text-muted-foreground">请先把该标的加入自选股，然后再记录持仓设置。</div>
              )}
              <p className="mt-3 text-xs text-muted-foreground">AI 分析不构成投资建议。</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}

async function getIndicatorCandles(provider: ReturnType<typeof getStockDataProvider>, symbol: string, interval: string, currentCandles: Candle[]) {
  if (interval === "1d" && currentCandles.length >= 35) return currentCandles;
  try {
    return await provider.getHistory(symbol, "1y", "1d");
  } catch {
    return currentCandles;
  }
}

function safeCalculateIndicators(symbol: string, candles: Candle[]): { indicators: IndicatorSnapshot | null; indicatorError: string | null } {
  if (candles.length < 35) {
    return {
      indicators: null,
      indicatorError: `当前只有 ${candles.length} 根 K 线，至少需要 35 根才能计算 RSI、MACD、均线和布林带。`
    };
  }

  try {
    return { indicators: calculateIndicators(symbol, candles), indicatorError: null };
  } catch (error) {
    if (error instanceof AppError && error.code === "INSUFFICIENT_DATA") {
      return {
        indicators: null,
        indicatorError: "当前 K 线数量不足，至少需要 35 根才能计算技术指标。"
      };
    }
    throw error;
  }
}

function ChartControls({ symbol, range, interval }: { symbol: string; range: string; interval: string }) {
  const ranges = isIntraday(interval) ? intradayRangeOptions : rangeOptions;
  return (
    <div className="rounded-lg border border-border bg-muted/10 p-2">
      <div className="grid gap-2 lg:grid-cols-[auto_auto] lg:items-center">
        <div className="text-[11px] font-medium text-muted-foreground">周期</div>
        <div className="flex flex-wrap gap-1">
        {intervalOptions.map((option) => (
          <Link
            key={option.value}
            href={`/stocks/${symbol}?interval=${option.value}&range=${normalizeRange(range, option.value)}`}
            className={`min-w-11 rounded-md border px-2.5 py-1 text-center text-xs transition-colors ${interval === option.value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background/40 text-muted-foreground hover:text-foreground"}`}
          >
            {option.label}
          </Link>
        ))}
        </div>
        <div className="text-[11px] font-medium text-muted-foreground">范围</div>
        <div className="flex flex-wrap gap-1">
        {ranges.map((option) => (
          <Link
            key={option.value}
            href={`/stocks/${symbol}?interval=${interval}&range=${option.value}`}
            className={`min-w-11 rounded-md border px-2.5 py-1 text-center text-xs transition-colors ${range === option.value ? "border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-200" : "border-border bg-background/40 text-muted-foreground hover:text-foreground"}`}
          >
            {option.label}
          </Link>
        ))}
        </div>
      </div>
    </div>
  );
}

function EmptyCard({ title, text }: { title: string; text: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{text}</CardContent>
    </Card>
  );
}

function normalizeInterval(value?: string) {
  if (!value) return "1m";
  if (["1m", "5m", "60m", "30m", "15m", "1d", "1wk", "1mo"].includes(value)) return value;
  return "1m";
}

function normalizeRange(value: string | undefined, interval: string) {
  const allowed = isIntraday(interval) ? intradayRangeOptions.map((option) => option.value) : rangeOptions.map((option) => option.value);
  if (value && allowed.includes(value)) return value;
  if (interval === "1m") return "1d";
  return isIntraday(interval) ? "1mo" : "6mo";
}

function currentActionLabel(analysis?: AiAnalysisResult): { label: string; tone: "watch" | "wait" | "avoid" | "bullish" | "neutral" } {
  const action = analysis?.entryAdvice?.action || analysis?.holdAdvice?.action || "";
  if (/回避|止损|减仓|离场|不建议/.test(action)) return { label: "风险规避", tone: "avoid" };
  if (/等待|回调|观察|观望/.test(action)) return { label: "等待回调", tone: "wait" };
  if (/入场|建仓|试探|加仓|增持/.test(action)) return { label: "谨慎追踪", tone: "bullish" };
  return { label: "继续观察", tone: "watch" };
}

function isIntraday(interval: string) {
  return ["1m", "5m", "15m", "30m", "60m", "1h"].includes(interval);
}

// 6 位纯数字代码展开成可能的 A 股格式，让 DB 查询能匹配上各种后缀
function expandChinaSymbol(normalized: string): string[] {
  const base = normalized.replace(/\.(SH|SZ|BJ)$/, "");
  if (!/^\d{6}$/.test(base)) return [];
  return [base, `${base}.SH`, `${base}.SZ`, `${base}.BJ`];
}
