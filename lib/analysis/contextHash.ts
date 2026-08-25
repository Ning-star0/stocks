import { createHash } from "node:crypto";

import type { AnalysisEvidencePackage } from "@/lib/analysis/evidence";
import type { IndicatorSnapshot, Quote } from "@/lib/types";

export const ANALYSIS_CACHE_NAMESPACE = "ai_analysis:v11";

export type AnalysisContextHashInput = {
  symbol: string;
  quote: Pick<Quote, "price">;
  indicators: Pick<IndicatorSnapshot, "rsi14" | "macd" | "macdSignal" | "sma20" | "sma50" | "sma200">;
  importantNewsIds: string[];
  evidence: AnalysisEvidencePackage;
  userCapital?: number | null;
  userMemory?: string;
  userContext: {
    isHolding?: boolean | null;
    holdingPrice?: number | null;
    holdingShares?: number | null;
    targetPrice?: number | null;
    stopLoss?: number | null;
    positionOpenedAt?: string | null;
    timeHorizon?: string | null;
    riskLevel?: string | null;
  };
};

export function createAnalysisContextHash(input: AnalysisContextHashInput) {
  const stableContext = {
    analysisPromptVersion: 11,
    evidenceSchemaVersion: input.evidence.schemaVersion,
    decisionPolicyVersion: input.evidence.decisionPolicyVersion,
    marketDataRevision: input.evidence.marketDataRevision,
    symbol: input.symbol.toUpperCase(),
    decisionMode: input.evidence.decisionMode,
    priceBucket: priceBucket(input.quote.price),
    trendState: trendState(input.quote.price, input.indicators),
    rsiState: rsiState(input.indicators.rsi14),
    macdState: macdState(input.indicators.macd, input.indicators.macdSignal),
    movingAverageState: movingAverageState(input.quote.price, input.indicators),
    recentHistoryDigest: createHash("sha256").update(JSON.stringify(input.evidence.marketData.recentCandles)).digest("hex"),
    latestHistoryAt: input.evidence.marketData.historyTo,
    fundamentalsState: {
      schemaVersion: input.evidence.fundamentals.schemaVersion,
      status: input.evidence.fundamentals.status,
      provider: input.evidence.fundamentals.provider,
      fetchedAt: input.evidence.fundamentals.fetchedAt,
      reportPeriod: input.evidence.fundamentals.reportPeriod,
      periodsDigest: createHash("sha256").update(JSON.stringify({
        annual: input.evidence.fundamentals.annualPeriods,
        quarterly: input.evidence.fundamentals.quarterlyPeriods
      })).digest("hex"),
      valuation: input.evidence.fundamentals.valuation,
      metrics: input.evidence.fundamentals.metrics,
      adjustedNetIncomeSources: input.evidence.fundamentals.adjustedNetIncomeSources.map((source) => ({
        periodEnd: source.periodEnd,
        sourceDisclosureId: source.sourceDisclosureId,
        contentHash: source.contentHash,
        parserVersion: source.parserVersion
      })),
      missingFields: input.evidence.fundamentals.missingFields,
      conflictingFields: input.evidence.fundamentals.conflictingFields
    },
    disclosureState: {
      schemaVersion: input.evidence.disclosures.schemaVersion,
      status: input.evidence.disclosures.status,
      provider: input.evidence.disclosures.provider,
      checkedAt: input.evidence.disclosures.checkedAt,
      latestPublishedAt: input.evidence.disclosures.latestPublishedAt,
      totalCount: input.evidence.disclosures.totalCount,
      criticalUnreadCount: input.evidence.disclosures.criticalUnreadCount,
      itemDigest: createHash("sha256").update(JSON.stringify(input.evidence.disclosures.items.map((item) => ({
        id: item.id,
        contentStatus: item.contentStatus,
        contentHash: item.contentHash,
        extractionFailure: item.extractionFailure
      })).sort((a, b) => a.id.localeCompare(b.id)))).digest("hex")
    },
    importantNewsIds: [...new Set(input.importantNewsIds)].sort(),
    newsState: {
      refreshStartedAt: input.evidence.news.refreshStartedAt,
      refreshAt: input.evidence.news.refreshAt,
      refreshCompleted: input.evidence.news.refreshCompleted,
      quotaStatus: input.evidence.news.quotaStatus,
      sourceProviders: [...input.evidence.news.sourceProviders].sort(),
      fetchedCount: input.evidence.news.fetchedCount,
      savedCount: input.evidence.news.savedCount,
      relevantCount: input.evidence.news.relevantCount,
      analyzedCount: input.evidence.news.analyzedCount,
      fallbackAnalysisCount: input.evidence.news.fallbackAnalysisCount,
      failedAnalysisCount: input.evidence.news.failedAnalysisCount,
      pendingCriticalCount: input.evidence.news.pendingCriticalCount,
      pendingRelevantCount: input.evidence.news.pendingRelevantCount,
      deadlineExceeded: input.evidence.news.deadlineExceeded,
      itemsDigest: createHash("sha256").update(JSON.stringify(input.evidence.news.items)).digest("hex")
    },
    dataQuality: {
      status: input.evidence.dataQuality.status,
      entryBlockers: input.evidence.dataQuality.entryBlockers
    },
    portfolioRiskState: input.evidence.portfolioContext.risk ? {
      schemaVersion: input.evidence.portfolioContext.risk.schemaVersion,
      capital: input.evidence.portfolioContext.risk.capital,
      availableCash: input.evidence.portfolioContext.risk.availableCash,
      totalAssets: input.evidence.portfolioContext.risk.totalAssets,
      portfolioValuationStatus: input.evidence.portfolioContext.risk.portfolioValuationStatus,
      riskBudget: input.evidence.portfolioContext.risk.riskBudget
    } : null,
    userCapital: input.userCapital ?? null,
    userMemoryHash: createHash("sha256").update(input.userMemory ?? "").digest("hex"),
    userContext: {
      isHolding: input.userContext.isHolding ?? null,
      holdingPrice: input.userContext.holdingPrice ?? null,
      holdingShares: input.userContext.holdingShares ?? null,
      targetPrice: input.userContext.targetPrice ?? null,
      stopLoss: input.userContext.stopLoss ?? null,
      positionOpenedAt: input.userContext.positionOpenedAt ?? null,
      timeHorizon: input.userContext.timeHorizon ?? null,
      riskLevel: input.userContext.riskLevel ?? null
    }
  };

  return createHash("sha256").update(JSON.stringify(stableContext)).digest("hex");
}

export function createAnalysisCacheKey(userId: string, symbol: string, contextHash: string) {
  return `${ANALYSIS_CACHE_NAMESPACE}:${userId}:${symbol.toUpperCase()}:${contextHash}`;
}

export function priceBucket(price: number) {
  if (!Number.isFinite(price) || price <= 0) return 0;
  return Math.round(Math.log(price) / Math.log(1.01));
}

export function rsiState(rsi: number | null | undefined) {
  if (rsi === null || rsi === undefined) return "unknown";
  if (rsi >= 70) return "overbought";
  if (rsi <= 30) return "oversold";
  return "normal";
}

export function macdState(macd: number | null | undefined, signal: number | null | undefined) {
  if (macd === null || macd === undefined || signal === null || signal === undefined) return "neutral";
  if (macd > signal) return "bullish";
  if (macd < signal) return "bearish";
  return "neutral";
}

export function movingAverageState(
  price: number,
  indicators: Pick<IndicatorSnapshot, "sma20" | "sma50" | "sma200">
) {
  return {
    vsSma20: compare(price, indicators.sma20),
    vsSma50: compare(price, indicators.sma50),
    vsSma200: compare(price, indicators.sma200),
    sma20vs50: compare(indicators.sma20, indicators.sma50),
    sma50vs200: compare(indicators.sma50, indicators.sma200)
  };
}

function trendState(price: number, indicators: Pick<IndicatorSnapshot, "sma20" | "sma50" | "sma200">) {
  const state = movingAverageState(price, indicators);
  if (state.vsSma20 === "above" && state.vsSma50 === "above" && state.sma50vs200 === "above") return "bullish";
  if (state.vsSma20 === "below" && state.vsSma50 === "below" && state.sma50vs200 === "below") return "bearish";
  return "neutral";
}

function compare(a: number | null | undefined, b: number | null | undefined) {
  if (a === null || a === undefined || b === null || b === undefined) return "unknown";
  if (a > b) return "above";
  if (a < b) return "below";
  return "equal";
}
