import type { Prisma } from "@prisma/client";

import { analyzeStock } from "@/lib/ai/analyzeStock";
import { createAnalysisContextHash } from "@/lib/analysis/contextHash";
import { getCache, setCache } from "@/lib/cache";
import { AppError, parseProviderError } from "@/lib/errors";
import { calculateIndicators, summarizeHistory } from "@/lib/indicators";
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
  const context = await buildStockAnalysisContext(input.userId, symbol);
  const canonicalSymbol = context.quote.symbol;
  const inputHash = input.inputHash ?? context.contextHash;
  const cacheKey = `ai_analysis:${canonicalSymbol}:${inputHash}`;
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
    return { fromCache: true, analysisId: cached.analysisId, outputJson: cached.outputJson, inputHash, durationMs: Date.now() - startedAt };
  }

  const outputJson = await analyzeStock(context.aiInput);
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

  await setCache(cacheKey, { analysisId: analysis.id, outputJson }, numberEnv("AI_ANALYSIS_CACHE_TTL_SECONDS", 21600));
  await setCache(`latest_analysis:${canonicalSymbol}`, { id: analysis.id, createdAt: analysis.createdAt, outputJson }, numberEnv("LATEST_ANALYSIS_CACHE_TTL_SECONDS", 300));
  await logAiUsage({
    userId: input.userId,
    symbol: canonicalSymbol,
    jobType: "stock_analysis",
    inputHash,
    cacheHit: false,
    reason: input.reason,
    promptTokens: context.estimatedTokens
  });

  return { fromCache: false, analysisId: analysis.id, outputJson, inputHash, durationMs: Date.now() - startedAt };
}

export async function buildStockAnalysisContext(userId: string, symbol: string) {
  const provider = getStockDataProvider();
  const quoteStatus = await getQuote(symbol, { allowStale: true });
  if (!quoteStatus.raw) throw new AppError("DATA_PROVIDER_ERROR", quoteStatus.error ?? "行情不可用，无法构造分析上下文。");
  const quote = quoteStatus.raw;
  const canonicalSymbol = quote.symbol;
  const history = await provider.getHistory(canonicalSymbol, "1y", "1d").catch((error) => {
    throw parseProviderError(error);
  });
  const [watchlistItem, sectorWatches] = await Promise.all([
    prisma.watchlistItem.findFirst({ where: { symbol: { in: [symbol, canonicalSymbol] }, watchlist: { userId } } }),
    prisma.sectorWatch.findMany({ where: { userId } })
  ]);
  const indicators = calculateIndicators(canonicalSymbol, history);
  const historySummary = summarizeHistory(history);
  const userContext = watchlistItem ? serializeWatchlistItem(watchlistItem) : { symbol: canonicalSymbol };
  const highImpactNews = await getHighImpactNewsForStock(canonicalSymbol, sectorWatches.map((watch) => watch.sectorName));
  const highImpactNewsIds = highImpactNews.map((item) => item.id);
  const contextHash = createAnalysisContextHash({
    symbol: canonicalSymbol,
    quote,
    indicators,
    importantNewsIds: highImpactNewsIds,
    userContext: {
      holdingPrice: toNumber(watchlistItem?.holdingPrice),
      targetPrice: toNumber(watchlistItem?.targetPrice),
      stopLoss: toNumber(watchlistItem?.stopLoss),
      timeHorizon: watchlistItem?.timeHorizon ?? null,
      riskLevel: watchlistItem?.riskLevel ?? null
    }
  });
  const recentNews = highImpactNews.slice(0, 8).map((item) => ({
    id: item.id,
    title: item.title,
    source: item.source,
    publishedAt: item.publishedAt.toISOString(),
    summary: item.analyses[0]?.aiSummary ?? item.summary ?? item.title,
    sentiment: item.analyses[0]?.sentiment ?? item.sentiment,
    impactLevel: item.analyses[0]?.impactLevel ?? item.importance
  }));
  const aiInput = {
    symbol: canonicalSymbol,
    quote,
    indicators,
    historySummary,
    userContext,
    recentNews
  };

  return {
    quote,
    indicators,
    historySummary,
    userContext,
    highImpactNews,
    highImpactNewsIds,
    contextHash,
    aiInput,
    estimatedTokens: estimateTokens(JSON.stringify(aiInput))
  };
}

async function getHighImpactNewsForStock(symbol: string, sectors: string[]) {
  const last7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return prisma.newsItem.findMany({
    where: {
      publishedAt: { gte: last7d },
      importance: "high",
      OR: [{ symbols: { has: symbol } }, ...(sectors.length ? [{ sectors: { hasSome: sectors } }] : [])]
    },
    include: { analyses: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: [{ publishedAt: "desc" }],
    take: 10
  });
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
      model: process.env.OPENAI_MODEL || "deepseek-v4-flash",
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
