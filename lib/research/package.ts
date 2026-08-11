import { calculateIndicators, summarizeHistory } from "@/lib/indicators";
import { buildPortfolioSnapshot } from "@/lib/focus/portfolio";
import { focusSymbolBase, focusSymbolVariants } from "@/lib/focus/symbols";
import { isNewsRelevantToStock } from "@/lib/news/relevance";
import { prisma } from "@/lib/prisma";
import { generateResearchForecast } from "@/lib/research/forecast";
import type {
  ChatGptResearchBundle,
  ResearchCandle,
  ResearchExecution,
  ResearchNewsItem,
  ResearchSymbolData
} from "@/lib/research/types";
import { getQuotesBatch } from "@/lib/services/quoteService";
import { getStockDataProvider } from "@/lib/stock-data";
import { compareBacktestPresets, summarizeBacktestComparisons } from "@/lib/strategy/backtest";
import { buildTradePerformance } from "@/lib/trades/performance";
import { buildPortfolioRiskBudget } from "@/lib/trading/riskBudget";
import { toNumber } from "@/lib/utils";

export async function buildChatGptResearchBundle(input: {
  userId: string;
  symbols: string[];
  range: string;
  interval: string;
  newsDays: number;
  includeForecast: boolean;
}): Promise<ChatGptResearchBundle> {
  const symbols = [...new Set(input.symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
  const allVariants = [...new Set(symbols.flatMap(focusSymbolVariants))];
  const newsFrom = new Date(Date.now() - input.newsDays * 86400000);
  const [watchlistItems, focus, executions, analyses, latestDecision, newsRows, quotes] = await Promise.all([
    prisma.watchlistItem.findMany({
      where: { watchlist: { userId: input.userId } },
      select: {
        symbol: true,
        isHolding: true,
        holdingPrice: true,
        holdingShares: true,
        targetPrice: true,
        stopLoss: true,
        positionOpenedAt: true,
        timeHorizon: true,
        riskLevel: true,
        note: true
      }
    }),
    prisma.focusGroup.findUnique({ where: { userId: input.userId }, select: { capital: true, symbols: true } }),
    prisma.tradeExecution.findMany({
      where: { userId: input.userId },
      orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }]
    }),
    prisma.aiAnalysis.findMany({
      where: { userId: input.userId, symbol: { in: allVariants } },
      orderBy: { createdAt: "desc" },
      take: Math.max(20, symbols.length * 5)
    }),
    prisma.focusDecision.findFirst({
      where: { userId: input.userId },
      orderBy: { createdAt: "desc" },
      select: { decisionJson: true, createdAt: true }
    }),
    prisma.newsItem.findMany({
      where: {
        publishedAt: { gte: newsFrom },
        OR: allVariants.map((symbol) => ({ symbols: { has: symbol } }))
      },
      include: { analyses: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { publishedAt: "desc" },
      take: Math.min(160, Math.max(30, symbols.length * 20))
    }),
    getQuotesBatch(symbols, { allowStale: true })
  ]);

  const capital = toNumber(focus?.capital) ?? 0;
  const holdingItems = watchlistItems.filter((item) => item.isHolding);
  const portfolio = buildPortfolioSnapshot({ capital, portfolioItems: holdingItems, tradeExecutions: executions, quotes });
  const serializedExecutions = executions.map(serializeExecution);
  const performance = buildTradePerformance(serializedExecutions.map((item, index) => ({
    id: `${item.symbol}:${item.executedAt}:${index}`,
    symbol: item.symbol,
    side: item.side,
    amount: item.amount,
    fee: item.fee,
    realizedPnl: item.realizedPnl,
    executedAt: item.executedAt
  })), capital);
  const riskBudget = buildPortfolioRiskBudget({
    capital,
    totalAssets: portfolio.totalAssets,
    tradePerformance: performance,
    positions: holdingItems.map((item) => ({
      symbol: item.symbol,
      shares: toNumber(item.holdingShares),
      currentPrice: resolveQuote(quotes, item.symbol)?.price ?? null,
      holdingPrice: toNumber(item.holdingPrice),
      stopLossPrice: toNumber(item.stopLoss),
      riskLevel: item.riskLevel
    }))
  });
  const latestAnalysisByBase = new Map<string, (typeof analyses)[number]>();
  for (const analysis of analyses) {
    const base = focusSymbolBase(analysis.symbol);
    if (!latestAnalysisByBase.has(base)) latestAnalysisByBase.set(base, analysis);
  }
  const news = newsRows.map(serializeNews);
  const provider = getStockDataProvider();
  const researchSymbols: ResearchSymbolData[] = [];

  for (const symbol of symbols) {
    let candles: ResearchCandle[] = [];
    let historyError: string | null = null;
    try {
      const rawCandles = await provider.getHistory(symbol, input.range, input.interval);
      candles = enrichCandles(rawCandles);
    } catch (error) {
      historyError = error instanceof Error ? error.message : "K 线读取失败。";
    }
    const item = watchlistItems.find((row) => focusSymbolBase(row.symbol) === focusSymbolBase(symbol)) ?? null;
    const quote = resolveQuote(quotes, symbol);
    const analysis = latestAnalysisByBase.get(focusSymbolBase(symbol));
    const relevantNews = news
      .filter((newsItem) => isNewsRelevantToStock({
        title: newsItem.title,
        summary: `${newsItem.summary ?? ""} ${newsAnalysisText(newsItem.analysis)}`,
        rawContent: newsItem.rawContent ?? undefined,
        symbols: newsItem.symbols,
        sectors: newsItem.sectors
      }, { symbol, name: quote?.name ?? null }))
      .slice(0, 20);
    researchSymbols.push({
      symbol,
      name: quote?.name ?? null,
      quote: quote ? jsonRecord(quote) : null,
      position: item ? {
        isHolding: item.isHolding,
        holdingPrice: toNumber(item.holdingPrice),
        holdingShares: toNumber(item.holdingShares),
        targetPrice: toNumber(item.targetPrice),
        stopLoss: toNumber(item.stopLoss),
        positionOpenedAt: item.positionOpenedAt?.toISOString() ?? null,
        timeHorizon: item.timeHorizon,
        riskLevel: item.riskLevel,
        note: item.note
      } : null,
      indicators: safeIndicators(symbol, candles),
      historySummary: summarizeHistory(candles.map((candle) => ({ symbol, ...candle }))),
      candles,
      historyError,
      latestAnalysis: analysis ? {
        createdAt: analysis.createdAt.toISOString(),
        input: analysis.inputJson,
        output: analysis.outputJson
      } : null,
      news: relevantNews,
      executions: serializedExecutions.filter((execution) => focusSymbolBase(execution.symbol) === focusSymbolBase(symbol))
    });
  }

  const portfolioData = {
    capital,
    ...portfolio,
    totalReturnPct: capital > 0 ? Number(((portfolio.totalAssets - capital) / capital * 100).toFixed(2)) : null
  };
  const latestDecisionData = latestDecision ? {
    createdAt: latestDecision.createdAt.toISOString(),
    decision: latestDecision.decisionJson
  } : null;
  const strategyBacktests = input.interval === "1d"
    ? researchSymbols
        .filter((item) => item.candles.length >= 35)
        .map((item) => compareBacktestPresets({
          symbol: item.symbol,
          candles: item.candles.map((candle) => ({ symbol: item.symbol, ...candle })),
          initialCapital: Math.max(1000, capital || 100000),
          range: input.range,
          includeRollingGate: true
        }))
    : [];
  const strategyBacktestPortfolio = summarizeBacktestComparisons(strategyBacktests);
  const forecast = input.includeForecast
    ? await generateResearchForecast({
        symbols: researchSymbols,
        portfolio: portfolioData,
        performance,
        riskBudget,
        latestDecision: latestDecisionData
      })
    : null;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    title: "股票交易研究包",
    range: input.range,
    interval: input.interval,
    newsDays: input.newsDays,
    requestedSymbols: symbols,
    portfolio: portfolioData,
    performance,
    riskBudget,
    latestDecision: latestDecisionData,
    symbols: researchSymbols,
    strategyBacktests,
    strategyBacktestPortfolio,
    forecast,
    chatgptTask: buildChatGptTask(),
    disclaimer: "本研究包仅用于数据整理和辅助研究，不构成投资建议，也不保证任何预测结果。"
  };
}

function enrichCandles(candles: Array<{ timestamp: string; open: number; high: number; low: number; close: number; volume: number }>) {
  return candles.map((candle, index) => {
    const previousClose = candles[index - 1]?.close ?? null;
    return {
      timestamp: candle.timestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      changePct: previousClose && previousClose > 0 ? Number(((candle.close / previousClose - 1) * 100).toFixed(4)) : null,
      amplitudePct: previousClose && previousClose > 0 ? Number((((candle.high - candle.low) / previousClose) * 100).toFixed(4)) : null
    };
  });
}

function safeIndicators(symbol: string, candles: ResearchCandle[]) {
  if (candles.length < 35) return null;
  try {
    return jsonRecord(calculateIndicators(symbol, candles.map((candle) => ({ symbol, ...candle }))));
  } catch {
    return null;
  }
}

function serializeExecution(execution: {
  symbol: string;
  side: string;
  price: unknown;
  shares: unknown;
  amount: unknown;
  fee: unknown;
  realizedPnl: unknown;
  executedAt: Date;
  note: string | null;
}): ResearchExecution {
  return {
    symbol: execution.symbol,
    side: execution.side,
    price: toNumber(execution.price) ?? 0,
    shares: toNumber(execution.shares) ?? 0,
    amount: toNumber(execution.amount) ?? 0,
    fee: toNumber(execution.fee) ?? 0,
    realizedPnl: toNumber(execution.realizedPnl),
    executedAt: execution.executedAt.toISOString(),
    note: execution.note
  };
}

function serializeNews(item: {
  title: string;
  source: string | null;
  publishedAt: Date;
  url: string | null;
  summary: string | null;
  rawContent: string | null;
  sentiment: string | null;
  importance: string | null;
  symbols: string[];
  sectors: string[];
  analyses: Array<Record<string, unknown>>;
}): ResearchNewsItem {
  return {
    title: item.title,
    source: item.source,
    publishedAt: item.publishedAt.toISOString(),
    url: item.url,
    summary: item.summary,
    rawContent: truncate(item.rawContent, 1600),
    sentiment: item.sentiment,
    importance: item.importance,
    symbols: item.symbols,
    sectors: item.sectors,
    analysis: item.analyses[0] ? jsonRecord(item.analyses[0]) : null
  };
}

function resolveQuote(quotes: Record<string, { symbol: string; name?: string | null; price: number | null }>, symbol: string) {
  return quotes[symbol] ?? quotes[focusSymbolVariants(symbol).find((variant) => quotes[variant]) ?? symbol] ?? null;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? Number(item) : item)) as Record<string, unknown>;
}

function truncate(value: string | null, maxLength: number) {
  if (!value) return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function newsAnalysisText(value: Record<string, unknown> | null) {
  if (!value) return "";
  return [
    value.aiSummary,
    value.whyItMatters,
    ...(Array.isArray(value.riskNotes) ? value.riskNotes : [])
  ].map((item) => String(item ?? "")).join(" ");
}

function buildChatGptTask() {
  return "请先检查数据截止时间、缺失字段和样本长度，再分别分析趋势、动量、波动、量价、新闻催化、持仓风险、历史绩效和策略回测。比较当前/均衡/严格过滤时，请同时看净收益、基准超额、最大回撤、手续费拖累和成交样本数，不要只挑收益最高者。滚动门控审计中只能用上一段状态解释下一段仓位，重点比较 ungated 与 gated 的净收益、手续费和改善标的数。请输出上涨/震荡/下跌三情景及概率、关键触发价、止损止盈、失效条件和需要继续观察的数据。不要承诺收益，不要把样本内最优当作未来有效，也不要脱离本研究包编造事实。";
}
