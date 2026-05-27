import { AnalyzeStockButton } from "@/components/AnalyzeStockButton";
import { AiAnalysisPanel } from "@/components/AiAnalysisPanel";
import { CollapsiblePanel } from "@/components/CollapsiblePanel";
import { IndicatorPanel } from "@/components/IndicatorPanel";
import { NewsPanel } from "@/components/NewsPanel";
import { PositionEditor } from "@/components/PositionEditor";
import { RiskBadge } from "@/components/RiskBadge";
import { StrategyBadge, trendToStrategy } from "@/components/StrategyBadge";
import { StockChartPanel } from "@/components/StockChartPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageContainer } from "@/components/ui/layout";
import { buildDecisionChange } from "@/lib/decision/change";
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
  const quote = await getQuote(normalized, { allowStale: true });
  const quoteSymbol = quote.raw?.symbol ?? quote.symbol;
  // A 股代码可能带 .SH/.SZ/.BJ 后缀，查询时把几种格式都覆盖
  const symbolVariants = [normalized, quoteSymbol, ...expandChinaSymbol(normalized)];
  const candles = quote.raw ? await safeGetHistory(provider, quoteSymbol, range, interval) : [];

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
  const latestDecisionHistory = latestAnalysis
    ? await prisma.decisionHistory.findFirst({
        where: {
          userId: user.id,
          OR: [{ analysisId: latestAnalysis.id }, { symbol: { in: symbolVariants } }]
        },
        orderBy: { decisionTime: "desc" }
      })
    : null;
  const previousDecisionHistory = latestDecisionHistory
    ? await prisma.decisionHistory.findFirst({
        where: {
          userId: user.id,
          symbol: latestDecisionHistory.symbol,
          decisionTime: { lt: latestDecisionHistory.decisionTime }
        },
        orderBy: { decisionTime: "desc" }
      })
    : null;
  const decisionChange = latestDecisionHistory
    ? buildDecisionChange(toDecisionSnapshot(previousDecisionHistory), toDecisionSnapshot(latestDecisionHistory) ?? {})
    : null;
  const displayName = quote.name ?? quoteSymbol;
  const isIndex = isIndexSymbol(quoteSymbol);
  const displayQuote = buildDisplayQuote(quote, candles);
  const strategy = trendToStrategy(analysis?.trend);
  const currentAction = currentActionLabel(analysis);

  return (
    <PageContainer>
      {quote.isMock ? <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-200">当前为模拟数据，不代表真实行情。</div> : null}
      {quote.status === "error" || quote.status === "unavailable" ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{quote.error ?? "行情不可用。"}</div>
      ) : null}

      <Card className="soft-card">
        <CardContent className="p-5">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-semibold tracking-normal">{displayName}</h1>
                <span className="text-sm text-muted-foreground">{quoteSymbol}</span>
                {watchlistItem ? <RiskBadge risk={watchlistItem.riskLevel} /> : null}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                <span className="text-3xl font-semibold text-foreground tabular-nums">{displayQuote.price === null ? "--" : formatPriceValue(displayQuote.price, { currency: quote.currency, symbol: quoteSymbol })}</span>
                <span className={displayQuote.changePct === null ? "text-muted-foreground" : displayQuote.changePct >= 0 ? "text-red-500" : "text-emerald-500"}>
                  {displayQuote.changePct === null ? "--" : formatPercent(displayQuote.changePct)}
                </span>
                <span>成交量 {displayQuote.volume === null ? "--" : formatNumber(displayQuote.volume)}</span>
                <span>{displayQuote.updatedAt ? new Date(displayQuote.updatedAt).toLocaleString("zh-CN") : "--"}</span>
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

      <AiAnalysisPanel
        analysis={analysis ?? null}
        createdAt={latestAnalysis?.createdAt ?? null}
        fromCache={false}
        currency={quote.currency}
        symbol={quoteSymbol}
        unit={isIndex ? "point" : undefined}
        decisionChange={decisionChange}
        position={{
          isHolding: watchlistItem?.isHolding ?? false,
          holdingPrice: toNumber(watchlistItem?.holdingPrice),
          holdingShares: toNumber(watchlistItem?.holdingShares),
          positionOpenedAt: watchlistItem?.positionOpenedAt ?? null
        }}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <StockChartPanel
          symbol={quoteSymbol}
          initialCandles={candles}
          initialRange={range}
          initialInterval={interval}
          currency={quote.currency}
          unit={isIndex ? "point" : undefined}
        />

        <div className="space-y-5">
          {indicators ? (
            <IndicatorPanel
              indicators={indicators}
              price={displayQuote.price}
              support={analysis?.keyLevels?.support ?? []}
              resistance={analysis?.keyLevels?.resistance ?? []}
              currency={quote.currency}
              symbol={quoteSymbol}
              unit={isIndex ? "point" : undefined}
            />
          ) : (
            <EmptyCard title="技术指标" text={indicatorError ?? "行情不可用，无法计算技术指标。"} />
          )}
          <CollapsiblePanel title={watchlistItem ? "持仓计划 / 交易情景设置" : "交易情景设置"}>
            {watchlistItem ? (
              <PositionEditor
                itemId={watchlistItem.id}
                isHolding={watchlistItem.isHolding}
                holdingPrice={toNumber(watchlistItem.holdingPrice)}
                holdingShares={toNumber(watchlistItem.holdingShares)}
                targetPrice={toNumber(watchlistItem.targetPrice)}
                stopLoss={toNumber(watchlistItem.stopLoss)}
                positionOpenedAt={watchlistItem.positionOpenedAt}
                timeHorizon={watchlistItem.timeHorizon}
                riskLevel={watchlistItem.riskLevel}
                note={watchlistItem.note}
              />
            ) : (
              <div className="text-sm text-muted-foreground">请先把该标的加入自选股，再记录持仓、止损和目标价。</div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">AI 分析不构成投资建议。</p>
          </CollapsiblePanel>
        </div>
      </div>

      <NewsPanel symbol={quoteSymbol} name={displayName} />
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

async function safeGetHistory(provider: ReturnType<typeof getStockDataProvider>, symbol: string, range: string, interval: string) {
  try {
    return await provider.getHistory(symbol, range, interval);
  } catch {
    return [];
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

function EmptyCard({ title, text }: { title: string; text: string }) {
  return (
    <Card className="soft-card">
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

function buildDisplayQuote(
  quote: Awaited<ReturnType<typeof getQuote>>,
  candles: Candle[]
): { price: number | null; changePct: number | null; volume: number | null; updatedAt: string | null } {
  const latestCandle = candles[candles.length - 1];
  const quoteTime = parseTime(quote.updatedAt);
  const candleTime = parseTime(latestCandle?.timestamp);
  const shouldUseCandle =
    latestCandle &&
    Number.isFinite(candleTime) &&
    (quote.price === null || !Number.isFinite(quoteTime) || candleTime > quoteTime + 60_000);

  if (!shouldUseCandle) {
    return {
      price: quote.price,
      changePct: quote.changePct,
      volume: quote.volume,
      updatedAt: quote.updatedAt
    };
  }

  const previousClose = quote.raw?.previousClose ?? estimatePreviousClose(quote.price, quote.changePct);
  const changePct =
    previousClose && previousClose > 0
      ? Number((((latestCandle.close - previousClose) / previousClose) * 100).toFixed(2))
      : latestCandle.open
        ? Number((((latestCandle.close - latestCandle.open) / latestCandle.open) * 100).toFixed(2))
        : null;

  return {
    price: latestCandle.close,
    changePct,
    volume: quote.volume ?? latestCandle.volume,
    updatedAt: latestCandle.timestamp
  };
}

function parseTime(value?: string | null) {
  if (!value) return Number.NaN;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.NaN;
}

function estimatePreviousClose(price?: number | null, changePct?: number | null) {
  if (price === null || price === undefined || changePct === null || changePct === undefined) return null;
  const ratio = 1 + changePct / 100;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return price / ratio;
}

function toDecisionSnapshot(record?: {
  action?: string | null;
  strategyDirection?: string | null;
  riskLevel?: string | null;
  confidence?: { toString(): string } | number | null;
} | null) {
  if (!record) return null;
  return {
    action: record.action ?? null,
    strategyDirection: record.strategyDirection ?? null,
    riskLevel: record.riskLevel ?? null,
    confidence: record.confidence === null || record.confidence === undefined ? null : Number(record.confidence)
  };
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
