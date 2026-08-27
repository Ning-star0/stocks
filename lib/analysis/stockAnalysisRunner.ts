import type { Prisma } from "@prisma/client";
import type { ApiQuotaPriority } from "@/lib/apiQuota";
import type { NewsBatchContext } from "@/lib/news/batchCoordinator";

import { estimateAiCost, getAiConfig, type AiModelTier } from "@/lib/ai/config";
import { analyzeStockWithExecution, type AiProviderTokenUsage } from "@/lib/ai/analyzeStock";
import { createAnalysisCacheKey, createAnalysisContextHash } from "@/lib/analysis/contextHash";
import { buildAnalysisEvidencePackage } from "@/lib/analysis/evidence";
import { summarizeFundamentalCoverage } from "@/lib/analysis/fundamentalCoverage";
import { loadBenchmarkMarketRegimeEvidence } from "@/lib/analysis/marketRegime";
import {
  extractPreviousHighImpactNewsIds,
  hasDecisionContextChanged,
  hasMaterialEvidenceChanged,
  shouldRunStockAnalysis
} from "@/lib/analysis/shouldAnalyze";
import {
  getStoredStockCompanyEvidence,
  prepareStockCompanyEvidence,
  type StockCompanyEvidenceRefresh
} from "@/lib/analysis/prepareCompanyEvidence";
import { loadPortfolioRiskContext } from "@/lib/analysis/portfolioRiskContext";
import { getCache, setCache } from "@/lib/cache";
import { AppError, parseProviderError } from "@/lib/errors";
import { calculateIndicators, summarizeHistory } from "@/lib/indicators";
import { getMemoryContent } from "@/lib/memory";
import { buildSectorNewsKeywords, buildStockNewsKeywords } from "@/lib/news/relevance";
import { buildNewsEventTimeline } from "@/lib/news/eventTimeline";
import {
  getStoredStockNewsEvidenceRefresh,
  prepareStockNewsEvidence,
  type StockNewsEvidenceRefresh
} from "@/lib/news/prepareStockNewsEvidence";
import { prisma } from "@/lib/prisma";
import { serializeWatchlistItem } from "@/lib/serializers";
import { getQuote } from "@/lib/services/quoteService";
import { getStockDataProvider } from "@/lib/stock-data";
import { stockSymbolVariants } from "@/lib/symbols";
import { toNumber } from "@/lib/utils";
import { persistAnalysisWithShadowForecast } from "@/lib/validation/shadowForecastStore";

export type StockAnalysisRunInput = {
  userId: string;
  symbol: string;
  reason: string;
  inputHash?: string | null;
  jobId?: string;
  forceRefresh?: boolean;
  refreshNewsBeforeAnalysis?: boolean;
  refreshCompanyEvidenceBeforeAnalysis?: boolean;
  forceQuoteRefresh?: boolean;
  forceHistoryRefresh?: boolean;
  newsQuotaPriority?: ApiQuotaPriority;
  newsRequestBatchId?: string;
  newsBatchContext?: NewsBatchContext;
  forceCriticalNewsRefresh?: boolean;
};

export async function runStockAnalysis(input: StockAnalysisRunInput) {
  const startedAt = Date.now();
  const symbol = input.symbol.toUpperCase();
  const newsRefreshStartedAt = Date.now();
  const newsEvidenceRefresh = input.refreshNewsBeforeAnalysis
    ? await prepareStockNewsEvidence({
        userId: input.userId,
        symbol,
        quotaPriority: input.newsQuotaPriority ?? "routine",
        requestBatchId: input.newsRequestBatchId,
        batchContext: input.newsBatchContext,
        forceCriticalRefresh: input.forceCriticalNewsRefresh
      })
    : undefined;
  const newsRefreshDurationMs = input.refreshNewsBeforeAnalysis ? Date.now() - newsRefreshStartedAt : 0;
  const context = await buildStockAnalysisContext(input.userId, symbol, {
    newsEvidenceRefresh,
    refreshCompanyEvidenceBeforeAnalysis: input.refreshCompanyEvidenceBeforeAnalysis,
    forceQuoteRefresh: input.forceQuoteRefresh,
    forceHistoryRefresh: input.forceHistoryRefresh
  });
  context.timings.newsDurationMs += newsRefreshDurationMs;
  const canonicalSymbol = context.quote.symbol;
  // 调用方的 inputHash 只用于任务去重；刷新新闻后必须以最终证据包计算出的哈希为准。
  const inputHash = context.contextHash;
  const cacheKey = createAnalysisCacheKey(input.userId, canonicalSymbol, inputHash);
  const cached = input.forceRefresh ? null : await getCache<{ analysisId: string; outputJson: unknown }>(cacheKey);

  if (cached) {
    await logAiUsage({
      userId: input.userId,
      symbol: canonicalSymbol,
      jobType: "stock_analysis",
      inputHash,
      cacheHit: true,
      reason: `${input.reason}:cache_hit`,
      model: "application-cache",
      modelTier: "standard",
      routingReason: "analysis-context-hash-cache-hit",
      promptTokens: 0,
      completionTokens: 0
    });
    return { fromCache: true, analysisId: cached.analysisId, outputJson: cached.outputJson, inputHash, durationMs: Date.now() - startedAt, timings: context.timings };
  }

  const latestAnalysis = input.forceRefresh
    ? null
    : await prisma.aiAnalysis.findFirst({
        where: { userId: input.userId, symbol: { in: stockSymbolVariants(canonicalSymbol) } },
        orderBy: { createdAt: "desc" }
      });
  if (latestAnalysis) {
    const gate = shouldRunStockAnalysis({
      latestAnalysis,
      currentQuote: context.quote,
      currentIndicators: context.indicators,
      highImpactNewsIds: context.highImpactNewsIds,
      previousHighImpactNewsIds: extractPreviousHighImpactNewsIds(latestAnalysis.inputJson),
      userContextHashChanged: hasDecisionContextChanged(latestAnalysis.inputJson, context.aiInput),
      materialEvidenceChanged: hasMaterialEvidenceChanged(latestAnalysis.inputJson, context.aiInput),
      importantAlertTriggered: await hasImportantAlertTriggered(input.userId, canonicalSymbol)
    });
    if (!gate.shouldRun) {
      await logAiUsage({
        userId: input.userId,
        symbol: canonicalSymbol,
        jobType: "stock_analysis",
        inputHash,
        cacheHit: true,
        reason: `${input.reason}:gate_reuse:${gate.reason}`,
        model: "application-cache",
        modelTier: "standard",
        routingReason: "material-change-gate-reuse",
        promptTokens: 0,
        completionTokens: 0
      });
      return {
        fromCache: true,
        analysisId: latestAnalysis.id,
        outputJson: latestAnalysis.outputJson,
        inputHash,
        durationMs: Date.now() - startedAt,
        timings: context.timings
      };
    }
  }

  const aiStartedAt = Date.now();
  const execution = await analyzeStockWithExecution(context.aiInput);
  const outputJson = execution.analysis;
  const aiDurationMs = Date.now() - aiStartedAt;
  const isFallback = Boolean(outputJson.isFallback);
  const jsonSafeInput = JSON.parse(JSON.stringify({
    ...context.aiInput,
    contextHash: inputHash,
    highImpactNewsIds: context.highImpactNewsIds,
    modelRouting: {
      policyVersion: execution.route.policyVersion,
      tier: execution.route.tier,
      reason: execution.route.reason,
      model: execution.model
    }
  }));
  const jsonSafeOutput = JSON.parse(JSON.stringify(outputJson)) as Prisma.InputJsonValue;
  const { analysis } = await persistAnalysisWithShadowForecast({
    userId: input.userId,
    symbol: canonicalSymbol,
    inputJson: jsonSafeInput as Prisma.InputJsonValue,
    outputJson: jsonSafeOutput,
    analysis: outputJson,
    evidenceHash: context.aiInput.evidencePackage.evidenceHash,
    analysisAsOf: context.aiInput.analysisAsOf,
    marketFeatures: context.aiInput.evidencePackage.deterministicFeatures.market,
    marketEnvironment: context.aiInput.evidencePackage.marketEnvironment,
    modelName: isFallback ? null : execution.model
  });

  if (!isFallback) {
    await setCache(cacheKey, { analysisId: analysis.id, outputJson }, numberEnv("AI_ANALYSIS_CACHE_TTL_SECONDS", 21600));
  }
  await logAiUsage({
    userId: input.userId,
    symbol: canonicalSymbol,
    jobType: "stock_analysis",
    inputHash,
    cacheHit: false,
    reason: isFallback ? `${input.reason}:fallback` : input.reason,
    model: execution.model,
    modelTier: execution.route.tier,
    routingReason: `${execution.route.policyVersion}:${execution.route.reason}`,
    usage: execution.usage,
    promptTokens: execution.usage?.promptTokens ?? context.estimatedTokens,
    completionTokens: execution.usage?.completionTokens ?? estimateTokens(JSON.stringify(outputJson))
  });

  return { fromCache: false, analysisId: analysis.id, outputJson, inputHash, durationMs: Date.now() - startedAt, timings: { ...context.timings, aiDurationMs } };
}

export async function buildStockAnalysisContext(
  userId: string,
  symbol: string,
  options: {
    newsEvidenceRefresh?: StockNewsEvidenceRefresh | null;
    companyEvidenceRefresh?: StockCompanyEvidenceRefresh | null;
    refreshCompanyEvidenceBeforeAnalysis?: boolean;
    forceQuoteRefresh?: boolean;
    forceHistoryRefresh?: boolean;
  } = {}
) {
  const provider = getStockDataProvider();
  const timings = { quoteDurationMs: 0, newsDurationMs: 0, companyEvidenceDurationMs: 0, portfolioRiskDurationMs: 0 };
  // 先试原始 symbol，失败则尝试去掉 A 股后缀重试
  const quoteStartedAt = Date.now();
  let quoteStatus = await getQuote(symbol, { allowStale: true, forceRefresh: options.forceQuoteRefresh });
  if (!quoteStatus.raw) {
    const stripped = cleanChinaSymbol(symbol);
    if (stripped && stripped !== symbol) {
      quoteStatus = await getQuote(stripped, { allowStale: true, forceRefresh: options.forceQuoteRefresh });
    }
  }
  timings.quoteDurationMs = Date.now() - quoteStartedAt;
  if (!quoteStatus.raw) throw new AppError("DATA_PROVIDER_ERROR", quoteStatus.error ?? "行情不可用，无法构造分析上下文。");

  const quote = quoteStatus.raw;
  const canonicalSymbol = quote.symbol;
  const analysisAsOf = new Date().toISOString();
  const symbolVariants = uniqueSymbols([...stockSymbolVariants(symbol), ...stockSymbolVariants(canonicalSymbol)]);
  const [history, marketEnvironment] = await Promise.all([
    provider.getHistory(canonicalSymbol, "1y", "1d", { forceRefresh: options.forceHistoryRefresh }).catch((error) => {
      throw parseProviderError(error);
    }),
    loadBenchmarkMarketRegimeEvidence({ provider, analysisAsOf })
  ]);
  const companyEvidenceStartedAt = Date.now();
  const companyEvidencePromise = options.companyEvidenceRefresh
    ? Promise.resolve(options.companyEvidenceRefresh)
    : options.refreshCompanyEvidenceBeforeAnalysis
      ? prepareStockCompanyEvidence({ userId, symbol: canonicalSymbol, quote, forceRefresh: true })
      : getStoredStockCompanyEvidence(userId, canonicalSymbol).catch(() => null);
  const [watchlistItem, sectorWatches, memory, focusGroup, storedNewsEvidenceRefresh, companyEvidenceRefresh] = await Promise.all([
    prisma.watchlistItem.findFirst({ where: { symbol: { in: symbolVariants }, watchlist: { userId } } }),
    prisma.sectorWatch.findMany({ where: { userId } }),
    getMemoryContent(userId),
    prisma.focusGroup.findUnique({ where: { userId } }),
    options.newsEvidenceRefresh
      ? Promise.resolve(null)
      : getStoredStockNewsEvidenceRefresh(userId, canonicalSymbol).catch(() => null),
    companyEvidencePromise
  ]);
  timings.companyEvidenceDurationMs = Date.now() - companyEvidenceStartedAt;
  const effectiveNewsEvidenceRefresh = options.newsEvidenceRefresh ?? storedNewsEvidenceRefresh;

  const indicators = calculateIndicators(canonicalSymbol, history);
  const historySummary = summarizeHistory(history);
  const userContext = watchlistItem ? serializeWatchlistItem(watchlistItem) : { symbol: canonicalSymbol };
  const watchedSectorKeywords = [...sectorWatches.map((watch) => watch.sectorName), ...sectorWatches.flatMap((watch) => watch.keywords)];
  const stockNewsKeywords = buildStockNewsKeywords({ symbol: canonicalSymbol, name: quote.name, extraKeywords: watchedSectorKeywords });
  const sectorKeywords = buildSectorNewsKeywords({ symbol: canonicalSymbol, name: quote.name, extraKeywords: [...watchedSectorKeywords, ...stockNewsKeywords] });
  const newsStartedAt = Date.now();
  const relevantNews = await getRelevantNewsForStock(canonicalSymbol, sectorKeywords);
  const supplementalNews = {
    provider: "news_provider" as const,
    status: "AI 分析阶段未执行联网新闻检索，仅复用每日定时截取后入库的新闻",
    queries: [],
    results: []
  };
  timings.newsDurationMs = Date.now() - newsStartedAt;
  const highImpactNewsIds = relevantNews.filter((item) => item.importance === "high" || item.analyses[0]?.impactLevel === "high").map((item) => item.id);
  const aiSummarizedNews = relevantNews
    .filter((item) => Boolean(item.analyses[0]?.aiSummary) && !item.analyses[0]?.isFallback)
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
  const webSearchResults = normalizeWebSearchResults(supplementalNews.results).slice(0, numberEnv("AI_WEB_SEARCH_RESULT_LIMIT", 3));
  const recentNews = dedupeAnalysisNews(newsReferences).slice(0, numberEnv("AI_ANALYZED_NEWS_LIMIT", 5));
  const newsEventTimeline = buildNewsEventTimeline({ articles: relevantNews, candles: history, analysisAsOf });
  const firstHistory = history[0]?.timestamp ?? null;
  const lastHistory = history[history.length - 1]?.timestamp ?? null;
  const dataScope = {
    quoteTime: quote.timestamp ?? quoteStatus.updatedAt,
    historyRange: "1y",
    historyInterval: "1d",
    historyFrom: firstHistory,
    historyTo: lastHistory,
    historyCandles: history.length,
    newsWindow: "最近 7 天，已入库 high/medium 相关新闻；传入 AI 的仅为已验证、非 fallback 精读摘要",
    newsCount: recentNews.length,
    newsCoverage: effectiveNewsEvidenceRefresh ? {
      fetchedCount: effectiveNewsEvidenceRefresh.fetch?.fetched ?? 0,
      savedCount: effectiveNewsEvidenceRefresh.fetch?.saved ?? 0,
      filteredOutCount: effectiveNewsEvidenceRefresh.fetch?.filteredOut ?? 0,
      relevantCount: effectiveNewsEvidenceRefresh.coverage.relevantCount,
      highCount: effectiveNewsEvidenceRefresh.coverage.highCount,
      mediumCount: effectiveNewsEvidenceRefresh.coverage.mediumCount,
      verifiedAnalyzedCount: effectiveNewsEvidenceRefresh.coverage.verifiedAnalyzedCount,
      fallbackAnalysisCount: effectiveNewsEvidenceRefresh.coverage.fallbackAnalysisCount,
      failedAnalysisCount: effectiveNewsEvidenceRefresh.coverage.failedAnalysisCount,
      pendingCriticalCount: effectiveNewsEvidenceRefresh.coverage.pendingCriticalCount,
      pendingRelevantCount: effectiveNewsEvidenceRefresh.coverage.pendingRelevantCount,
      deadlineExceeded: effectiveNewsEvidenceRefresh.deadlineExceeded,
      webSearchUsed: effectiveNewsEvidenceRefresh.fetch?.webSearchUsed ?? false,
      quotaStatus: effectiveNewsEvidenceRefresh.fetch?.quotaStatus ?? "available",
      cacheHitCount: effectiveNewsEvidenceRefresh.fetch?.cacheHitCount ?? 0,
      tianapiCalls: effectiveNewsEvidenceRefresh.fetch?.tianapiCalls ?? 0,
      tavilyCalls: effectiveNewsEvidenceRefresh.fetch?.tavilyCalls ?? 0,
      sharedTopicReused: effectiveNewsEvidenceRefresh.fetch?.sharedTopicReused ?? false,
      skippedQueryCount: effectiveNewsEvidenceRefresh.fetch?.skippedQueryCount ?? 0,
      sourceProviders: effectiveNewsEvidenceRefresh.fetch?.sourceProviders ?? [],
      eventClusterCount: newsEventTimeline.clusterCount,
      duplicateArticleCount: newsEventTimeline.duplicateArticleCount,
      futureDatedArticleCount: newsEventTimeline.futureDatedArticleCount,
      explicitExpectationCount: newsEventTimeline.explicitExpectationCount,
      inferredExpectationCount: newsEventTimeline.inferredExpectationCount,
      unavailableExpectationCount: newsEventTimeline.unavailableExpectationCount,
      priceReactionAvailableCount: newsEventTimeline.priceReactionAvailableCount
    } : null,
    newsTimeline: {
      schemaVersion: newsEventTimeline.schemaVersion,
      algorithmVersion: newsEventTimeline.algorithmVersion,
      status: newsEventTimeline.status,
      windowDescription: newsEventTimeline.windowDescription,
      futureDatedArticleCount: newsEventTimeline.futureDatedArticleCount,
      events: newsEventTimeline.events.slice(0, 8).map((event) => ({
        eventId: event.eventId,
        title: event.title,
        firstSeenAt: event.firstSeenAt,
        latestSeenAt: event.latestSeenAt,
        novelty: event.novelty,
        articleCount: event.articleCount,
        importance: event.importance,
        canonicalSource: {
          name: event.canonicalSource.name,
          url: event.canonicalSource.url,
          tier: event.canonicalSource.tier
        },
        expectation: event.eventContext.expectation,
        eventContextSource: event.eventContextSource ? {
          name: event.eventContextSource.name,
          url: event.eventContextSource.url,
          publishedAt: event.eventContextSource.publishedAt
        } : null,
        expectedImpactHorizon: event.eventContext.expectedImpactHorizon,
        priceReaction: event.priceReaction,
        limitations: event.limitations
      }))
    },
    newsRefreshFailures: effectiveNewsEvidenceRefresh?.failures ?? [],
    marketRegimeStatus: marketEnvironment.status,
    marketRegime: marketEnvironment.regime,
    marketRegimeBenchmarkSymbol: marketEnvironment.benchmarkSymbol,
    marketRegimeAsOf: marketEnvironment.asOf,
    marketRegimeSourceUrl: marketEnvironment.sourceUrl,
    marketRegimeFailure: marketEnvironment.failure,
    fundamentalsStatus: companyEvidenceRefresh?.fundamentals.status ?? "unavailable",
    fundamentalsReportPeriod: companyEvidenceRefresh?.fundamentals.reportPeriod ?? null,
    fundamentalsSourceUrl: companyEvidenceRefresh?.fundamentals.sourceUrl || null,
    fundamentalCoverage: summarizeFundamentalCoverage(companyEvidenceRefresh?.fundamentals),
    disclosureStatus: companyEvidenceRefresh?.disclosures.status ?? "unchecked",
    disclosureCheckedAt: companyEvidenceRefresh?.disclosures.checkedAt ?? null,
    disclosureCount: companyEvidenceRefresh?.disclosures.totalCount ?? 0,
    disclosureCriticalCount: companyEvidenceRefresh?.disclosures.items.filter((item) => item.isCritical).length ?? 0,
    disclosureExtractedCount: companyEvidenceRefresh?.disclosures.items.filter((item) => item.isCritical && item.contentStatus !== "metadata_only").length ?? 0,
    disclosureSources: (companyEvidenceRefresh?.disclosures.items ?? []).filter((item) => item.isCritical).slice(0, 8).map((item) => ({
      id: item.id,
      title: item.title,
      publishedAt: item.publishedAt,
      url: item.sourceUrl,
      contentStatus: item.contentStatus,
      extractionMethod: item.contentExtraction?.method ?? null,
      extractionCoverage: item.contentExtraction?.coverage ?? null,
      totalPages: item.contentExtraction?.totalPages ?? null,
      ocrPages: item.contentExtraction?.ocrPages ?? 0,
      extractorVersion: item.contentExtraction?.extractorVersion ?? null,
      extractionFailure: item.extractionFailure,
      isCritical: item.isCritical
    })),
    companyEvidenceFailures: companyEvidenceRefresh?.failures ?? [],
    webSearchStatus: supplementalNews.status
  };
  const userCapital = focusGroup?.capital ? Number(focusGroup.capital) : null;
  const portfolioRiskStartedAt = Date.now();
  let portfolioRiskFailure: string | null = null;
  const portfolioRiskContext = await loadPortfolioRiskContext(userId).catch((error) => {
    portfolioRiskFailure = error instanceof Error ? error.message : "组合风险预算读取失败";
    return null;
  });
  timings.portfolioRiskDurationMs = Date.now() - portfolioRiskStartedAt;
  Object.assign(dataScope, {
    portfolioRiskStatus: portfolioRiskContext?.riskBudget.status ?? "not_evaluated",
    portfolioAvailableRiskAmount: portfolioRiskContext?.riskBudget.availableRiskAmount ?? null,
    portfolioRiskFailure
  });
  const evidencePackage = buildAnalysisEvidencePackage({
    symbol: canonicalSymbol,
    quote,
    quoteStatus: quoteStatus.status,
    quoteSource: quoteStatus.source,
    history,
    indicators,
    userContext,
    userCapital,
    portfolioRiskContext,
    relevantNews,
    analyzedNews: recentNews,
    lastNewsFetch: effectiveNewsEvidenceRefresh?.completedAt ?? focusGroup?.lastNewsFetch ?? null,
    newsEvidenceRefresh: effectiveNewsEvidenceRefresh,
    newsEventTimeline,
    fundamentals: companyEvidenceRefresh?.fundamentals,
    disclosures: companyEvidenceRefresh?.disclosures,
    marketEnvironment,
    analysisAsOf
  });
  const contextHash = createAnalysisContextHash({
    symbol: canonicalSymbol,
    quote,
    indicators,
    importantNewsIds: highImpactNewsIds,
    evidence: evidencePackage,
    userCapital,
    userMemory: memory || "",
    userContext: {
      isHolding: watchlistItem?.isHolding ?? null,
      holdingPrice: toNumber(watchlistItem?.holdingPrice),
      holdingShares: toNumber(watchlistItem?.holdingShares),
      targetPrice: toNumber(watchlistItem?.targetPrice),
      stopLoss: toNumber(watchlistItem?.stopLoss),
      positionOpenedAt: watchlistItem?.positionOpenedAt?.toISOString() ?? null,
      timeHorizon: watchlistItem?.timeHorizon ?? null,
      riskLevel: watchlistItem?.riskLevel ?? null
    }
  });
  const aiInput = {
    symbol: canonicalSymbol,
    quote,
    indicators,
    historySummary,
    userContext,
    userCapital,
    portfolioRiskContext,
    userMemory: memory || "",
    analysisAsOf,
    dataScope,
    tradingFeeRule: {
      rate: 0.0005,
      minimumFeeBase: 10000,
      minimumFee: 5,
      lotSize: 100,
      description: "买入和卖出手续费均按成交金额的万分之五估算；若成交金额不足 10000 元，按 10000 元计费，即最低手续费 5 元。A 股/ETF 买卖均按 100 股/份整数手执行。"
    },
    recentNews,
    webSearchResults,
    evidencePackage
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
    take: 50
  });
}

async function hasImportantAlertTriggered(userId: string, symbol: string) {
  const recent = await prisma.alert.findFirst({
    where: {
      userId,
      symbol: { in: stockSymbolVariants(symbol) },
      triggeredAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) }
    },
    select: { id: true }
  });
  return Boolean(recent);
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

function normalizeWebSearchResults(items: Array<{ title?: string; url?: string; source?: string; publishedAt?: string; summary?: string; rawContent?: string }>) {
  return items
    .map((item) => ({
      title: item.title?.trim() ?? "",
      url: item.url ?? null,
      source: item.source ?? null,
      publishedAt: item.publishedAt ?? null,
      summary: truncateText(item.summary || item.rawContent || "", numberEnv("AI_WEB_SEARCH_SUMMARY_MAX_CHARS", 220))
    }))
    .filter((item) => item.title);
}

async function logAiUsage(input: {
  userId: string;
  symbol?: string;
  jobType: string;
  inputHash?: string | null;
  cacheHit: boolean;
  reason: string;
  model?: string;
  modelTier?: AiModelTier;
  routingReason?: string;
  usage?: AiProviderTokenUsage | null;
  promptTokens?: number;
  completionTokens?: number;
}) {
  const config = await getAiConfig();
  const promptTokens = input.promptTokens ?? null;
  const completionTokens = input.completionTokens ?? null;
  await prisma.aiUsageLog.create({
    data: {
      userId: input.userId,
      symbol: input.symbol ?? null,
      jobType: input.jobType,
      provider: config.baseUrl.includes("deepseek.com") ? "deepseek" : "openai-compatible",
      model: input.model ?? config.standardModel,
      inputHash: input.inputHash ?? null,
      promptTokens,
      completionTokens,
      promptCacheHitTokens: input.usage?.cacheHitTokens ?? null,
      promptCacheMissTokens: input.usage?.cacheMissTokens ?? null,
      modelTier: input.modelTier ?? null,
      routingReason: input.routingReason ?? null,
      estimatedCost: input.cacheHit ? "0" : estimateAiCost({ config, tier: input.modelTier ?? "standard", promptTokens, completionTokens }),
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

function uniqueSymbols(symbols: string[]) {
  return [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
}
