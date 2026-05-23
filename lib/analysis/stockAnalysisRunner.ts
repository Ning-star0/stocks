import type { Prisma } from "@prisma/client";

import { analyzeStock } from "@/lib/ai/analyzeStock";
import { createAnalysisContextHash } from "@/lib/analysis/contextHash";
import { getCache, setCache } from "@/lib/cache";
import { AppError, parseProviderError } from "@/lib/errors";
import { calculateIndicators, summarizeHistory } from "@/lib/indicators";
import { getMemoryContent } from "@/lib/memory";
import { buildSectorNewsKeywords, buildStockNewsKeywords } from "@/lib/news/relevance";
import { searchRelatedNews } from "@/lib/news/webSearch";
import { prisma } from "@/lib/prisma";
import { serializeWatchlistItem } from "@/lib/serializers";
import { getQuote } from "@/lib/services/quoteService";
import { getStockDataProvider } from "@/lib/stock-data";
import { toNumber } from "@/lib/utils";

export type StockAnalysisRunInput = {
  userId: string;
  symbol: string;
  reason: string;
  inputHash?: string | null;
  jobId?: string;
};

export async function runStockAnalysis(input: StockAnalysisRunInput) {
  const startedAt = Date.now();
  const symbol = input.symbol.toUpperCase();
  const context = await buildStockAnalysisContext(input.userId, symbol, { includeWebSearch: true });
  const canonicalSymbol = context.quote.symbol;
  const inputHash = input.inputHash ?? context.contextHash;
  const cacheKey = `ai_analysis:v5:${canonicalSymbol}:${inputHash}`;
  const cached = await getCache<{ analysisId: string; outputJson: unknown }>(cacheKey);

  if (cached) {
    await logAiUsage({
      userId: input.userId,
      symbol: canonicalSymbol,
      jobType: "stock_analysis",
      inputHash,
      cacheHit: true,
      reason: `${input.reason}:cache_hit`,
      promptTokens: context.estimatedTokens
    });
    return { fromCache: true, analysisId: cached.analysisId, outputJson: cached.outputJson, inputHash, durationMs: Date.now() - startedAt, timings: context.timings };
  }

  const aiStartedAt = Date.now();
  const outputJson = await analyzeStock(context.aiInput);
  const aiDurationMs = Date.now() - aiStartedAt;
  const isFallback = Boolean(outputJson.isFallback);
  const jsonSafeInput = JSON.parse(JSON.stringify({ ...context.aiInput, contextHash: inputHash, highImpactNewsIds: context.highImpactNewsIds }));
  const jsonSafeOutput = JSON.parse(JSON.stringify(outputJson)) as Prisma.InputJsonValue;
  const analysis = await prisma.aiAnalysis.create({
    data: {
      userId: input.userId,
      symbol: canonicalSymbol,
      inputJson: jsonSafeInput as Prisma.InputJsonValue,
      outputJson: jsonSafeOutput
    }
  });

  if (!isFallback) {
    await setCache(cacheKey, { analysisId: analysis.id, outputJson }, numberEnv("AI_ANALYSIS_CACHE_TTL_SECONDS", 21600));
  }
  await setCache(
    `latest_analysis:${canonicalSymbol}`,
    { id: analysis.id, createdAt: analysis.createdAt, outputJson },
    isFallback ? 60 : numberEnv("LATEST_ANALYSIS_CACHE_TTL_SECONDS", 300)
  );
  await logAiUsage({
    userId: input.userId,
    symbol: canonicalSymbol,
    jobType: "stock_analysis",
    inputHash,
    cacheHit: false,
    reason: isFallback ? `${input.reason}:fallback` : input.reason,
    promptTokens: context.estimatedTokens
  });

  return { fromCache: false, analysisId: analysis.id, outputJson, inputHash, durationMs: Date.now() - startedAt, timings: { ...context.timings, aiDurationMs } };
}

export async function buildStockAnalysisContext(userId: string, symbol: string, options: { includeWebSearch?: boolean } = {}) {
  const provider = getStockDataProvider();
  const timings = { quoteDurationMs: 0, newsDurationMs: 0 };
  // 先试原始 symbol，失败则尝试去掉 A 股后缀重试
  const quoteStartedAt = Date.now();
  let quoteStatus = await getQuote(symbol, { allowStale: true });
  if (!quoteStatus.raw) {
    const stripped = cleanChinaSymbol(symbol);
    if (stripped && stripped !== symbol) {
      quoteStatus = await getQuote(stripped, { allowStale: true });
    }
  }
  timings.quoteDurationMs = Date.now() - quoteStartedAt;
  if (!quoteStatus.raw) throw new AppError("DATA_PROVIDER_ERROR", quoteStatus.error ?? "行情不可用，无法构造分析上下文。");

  const quote = quoteStatus.raw;
  const canonicalSymbol = quote.symbol;
  const history = await provider.getHistory(canonicalSymbol, "1y", "1d").catch((error) => {
    throw parseProviderError(error);
  });
  const [watchlistItem, sectorWatches, memory, focusGroup] = await Promise.all([
    prisma.watchlistItem.findFirst({ where: { symbol: { in: [symbol, canonicalSymbol] }, watchlist: { userId } } }),
    prisma.sectorWatch.findMany({ where: { userId } }),
    getMemoryContent(userId),
    prisma.focusGroup.findUnique({ where: { userId } })
  ]);

  const indicators = calculateIndicators(canonicalSymbol, history);
  const historySummary = summarizeHistory(history);
  const userContext = watchlistItem ? serializeWatchlistItem(watchlistItem) : { symbol: canonicalSymbol };
  const watchedSectorKeywords = [...sectorWatches.map((watch) => watch.sectorName), ...sectorWatches.flatMap((watch) => watch.keywords)];
  const stockNewsKeywords = buildStockNewsKeywords({ symbol: canonicalSymbol, name: quote.name, extraKeywords: watchedSectorKeywords });
  const sectorKeywords = buildSectorNewsKeywords({ symbol: canonicalSymbol, name: quote.name, extraKeywords: [...watchedSectorKeywords, ...stockNewsKeywords] });
  const newsStartedAt = Date.now();
  const relevantNews = await getRelevantNewsForStock(canonicalSymbol, sectorKeywords);
  const supplementalNews = options.includeWebSearch
    ? await searchRelatedNews({
        symbol: canonicalSymbol,
        name: quote.name,
        sectorKeywords,
        days: 7,
        maxResults: 8
      })
    : {
        provider: "news_provider" as const,
        status: "未执行联网新闻检索",
        queries: [],
        results: []
      };
  timings.newsDurationMs = Date.now() - newsStartedAt;
  const highImpactNewsIds = relevantNews.filter((item) => item.importance === "high" || item.analyses[0]?.impactLevel === "high").map((item) => item.id);
  const contextHash = createAnalysisContextHash({
    symbol: canonicalSymbol,
    quote,
    indicators,
    importantNewsIds: highImpactNewsIds,
    userContext: {
      holdingPrice: toNumber(watchlistItem?.holdingPrice),
      targetPrice: toNumber(watchlistItem?.targetPrice),
      stopLoss: toNumber(watchlistItem?.stopLoss),
      positionOpenedAt: watchlistItem?.positionOpenedAt?.toISOString() ?? null,
      timeHorizon: watchlistItem?.timeHorizon ?? null,
      riskLevel: watchlistItem?.riskLevel ?? null
    }
  });

  const aiSummarizedNews = relevantNews
    .filter((item) => Boolean(item.analyses[0]?.aiSummary))
    .slice(0, numberEnv("AI_ANALYZED_NEWS_LIMIT", 5));
  const newsReferences = aiSummarizedNews.map((item) => ({
    id: item.id,
    title: item.title,
    url: item.url,
    source: item.source,
    publishedAt: item.publishedAt.toISOString(),
    summary: truncateText(item.analyses[0]?.aiSummary ?? "", numberEnv("AI_NEWS_SUMMARY_MAX_CHARS", 360)),
    whyItMatters: truncateText(item.analyses[0]?.whyItMatters ?? "", 240),
    riskNotes: Array.isArray(item.analyses[0]?.riskNotes) ? item.analyses[0].riskNotes.slice(0, 3) : [],
    sentiment: item.analyses[0]?.sentiment ?? item.sentiment,
    impactLevel: item.analyses[0]?.impactLevel ?? item.importance
  }));
  const webSearchResults: Array<{ title: string; url: string | null; source: string | null; publishedAt: string | null; summary: string | null }> = [];
  const recentNews = dedupeAnalysisNews(newsReferences).slice(0, numberEnv("AI_ANALYZED_NEWS_LIMIT", 5));
  const analysisAsOf = new Date().toISOString();
  const firstHistory = history[0]?.timestamp ?? null;
  const lastHistory = history[history.length - 1]?.timestamp ?? null;
  const dataScope = {
    quoteTime: quote.timestamp ?? quoteStatus.updatedAt,
    historyRange: "1y",
    historyInterval: "1d",
    historyFrom: firstHistory,
    historyTo: lastHistory,
    historyCandles: history.length,
    newsWindow: "最近 7 天，已入库 high/medium 行业新闻；传入 AI 的仅为已精读新闻摘要",
    newsCount: recentNews.length,
    webSearchStatus: supplementalNews.status
  };
  const aiInput = {
    symbol: canonicalSymbol,
    quote,
    indicators,
    historySummary,
    userContext,
    userCapital: focusGroup?.capital ? Number(focusGroup.capital) : null,
    userMemory: memory || "",
    analysisAsOf,
    dataScope,
    tradingFeeRule: {
      rate: 0.0005,
      minimumFeeBase: 10000,
      minimumFee: 5,
      lotSize: 100,
      description: "买入手续费为成交金额的万分之五；若成交金额不足 10000 元，按 10000 元计费，即最低手续费 5 元。A 股/ETF 按 100 股/份整数手买入。"
    },
    recentNews,
    webSearchResults
  };

  return {
    quote,
    indicators,
    historySummary,
    userContext,
    highImpactNews: relevantNews,
    highImpactNewsIds,
    contextHash,
    aiInput,
    estimatedTokens: estimateTokens(JSON.stringify(aiInput)),
    timings
  };
}

async function getRelevantNewsForStock(symbol: string, sectors: string[]) {
  const last7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return prisma.newsItem.findMany({
    where: {
      publishedAt: { gte: last7d },
      importance: { in: ["high", "medium"] },
      OR: [{ symbols: { has: symbol } }, ...(sectors.length ? [{ sectors: { hasSome: sectors } }] : [])]
    },
    include: { analyses: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: [{ publishedAt: "desc" }],
    take: 10
  });
}

function dedupeAnalysisNews<T extends { title: string; url?: string | null }>(items: T[]) {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const item of items) {
    const key = (item.url || item.title).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function truncateText(value: string, maxLength: number) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

async function logAiUsage(input: {
  userId: string;
  symbol?: string;
  jobType: string;
  inputHash?: string | null;
  cacheHit: boolean;
  reason: string;
  promptTokens?: number;
  completionTokens?: number;
}) {
  await prisma.aiUsageLog.create({
    data: {
      userId: input.userId,
      symbol: input.symbol ?? null,
      jobType: input.jobType,
      provider: process.env.OPENAI_BASE_URL ? "openai-compatible" : "openai",
      model: process.env.OPENAI_MODEL || "deepseek-v4-pro",
      inputHash: input.inputHash ?? null,
      promptTokens: input.promptTokens ?? null,
      completionTokens: input.completionTokens ?? null,
      estimatedCost: null,
      cacheHit: input.cacheHit,
      reason: input.reason
    }
  });
}

function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// "600519.SH" → "600519"，纯代码去后缀
function cleanChinaSymbol(symbol: string): string | null {
  const cleaned = symbol.trim().toUpperCase().replace(/\.(SH|SZ|BJ)$/, "");
  if (cleaned === symbol.trim().toUpperCase()) return null;
  return cleaned;
}
