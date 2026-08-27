import { createHash } from "node:crypto";

import { macdState, movingAverageState, rsiState } from "@/lib/analysis/contextHash";
import type { AnalyzeStockInput } from "@/lib/ai/stockAnalysisTypes";
import type { IndicatorSnapshot, Quote } from "@/lib/types";

export type ShouldRunStockAnalysisInput = {
  forceRefresh?: boolean;
  latestAnalysis?: {
    createdAt: Date | string;
    inputJson?: unknown;
    outputJson?: unknown;
  } | null;
  currentQuote: Quote;
  currentIndicators: IndicatorSnapshot;
  highImpactNewsIds: string[];
  previousHighImpactNewsIds: string[];
  userContextHashChanged: boolean;
  materialEvidenceChanged?: boolean;
  importantAlertTriggered?: boolean;
};

export function shouldRunStockAnalysis(input: ShouldRunStockAnalysisInput) {
  if (input.forceRefresh) return result(true, "force_refresh", false);
  if (!input.latestAnalysis) return result(true, "no_historical_analysis", false);
  if (isFallbackAnalysis(input.latestAnalysis.outputJson)) return result(true, "previous_analysis_was_fallback", true);

  const latestCreatedAt = new Date(input.latestAnalysis.createdAt);
  if (Date.now() - latestCreatedAt.getTime() > 6 * 60 * 60 * 1000) return result(true, "analysis_older_than_6h", true);

  const previous = extractPreviousState(input.latestAnalysis.inputJson);
  if (!previous) return result(true, "previous_context_unavailable", true);

  const priceChange = Math.abs((input.currentQuote.price - previous.price) / previous.price) * 100;
  if (priceChange > 3) return result(true, "price_changed_more_than_3_percent", true);

  const currentRsiState = rsiState(input.currentIndicators.rsi14);
  if (currentRsiState !== previous.rsiState) return result(true, "rsi_state_changed", true);

  const currentMacdState = macdState(input.currentIndicators.macd, input.currentIndicators.macdSignal);
  if (currentMacdState !== previous.macdState) return result(true, "macd_state_changed", true);

  const currentMa = movingAverageState(input.currentQuote.price, input.currentIndicators);
  if (currentMa.vsSma50 !== previous.maState?.vsSma50 || currentMa.vsSma200 !== previous.maState?.vsSma200) {
    return result(true, "price_crossed_sma50_or_sma200", true);
  }

  const previousNews = new Set(input.previousHighImpactNewsIds);
  if (input.highImpactNewsIds.some((id) => !previousNews.has(id))) return result(true, "new_high_impact_news", true);

  if (input.materialEvidenceChanged) return result(true, "material_evidence_changed", true);
  if (input.userContextHashChanged) return result(true, "user_context_changed", true);
  if (input.importantAlertTriggered) return result(true, "important_alert_triggered", true);

  return result(false, "context_unchanged", true);
}

export function extractPreviousHighImpactNewsIds(inputJson: unknown) {
  const value = inputJson as { highImpactNewsIds?: unknown } | null;
  return Array.isArray(value?.highImpactNewsIds)
    ? value.highImpactNewsIds.filter((item): item is string => typeof item === "string")
    : [];
}

export function hasDecisionContextChanged(previousInput: unknown, currentInput: AnalyzeStockInput) {
  return digest(decisionContextProjection(previousInput)) !== digest(decisionContextProjection(currentInput));
}

export function hasMaterialEvidenceChanged(previousInput: unknown, currentInput: AnalyzeStockInput) {
  return digest(materialEvidenceProjection(previousInput)) !== digest(materialEvidenceProjection(currentInput));
}

function decisionContextProjection(input: unknown) {
  const value = isRecord(input) ? input : {};
  const userContext = isRecord(value.userContext) ? value.userContext : {};
  const portfolio = isRecord(value.portfolioRiskContext) ? value.portfolioRiskContext : null;
  const riskBudget = portfolio && isRecord(portfolio.riskBudget) ? portfolio.riskBudget : null;
  return {
    userContext: {
      isHolding: userContext.isHolding ?? null,
      holdingPrice: userContext.holdingPrice ?? null,
      holdingShares: userContext.holdingShares ?? null,
      targetPrice: userContext.targetPrice ?? null,
      stopLoss: userContext.stopLoss ?? null,
      positionOpenedAt: userContext.positionOpenedAt ?? null,
      timeHorizon: userContext.timeHorizon ?? null,
      riskLevel: userContext.riskLevel ?? null
    },
    userCapital: value.userCapital ?? null,
    userMemory: value.userMemory ?? "",
    portfolioRisk: portfolio ? {
      schemaVersion: portfolio.schemaVersion ?? null,
      capital: portfolio.capital ?? null,
      availableCash: portfolio.availableCash ?? null,
      totalAssets: portfolio.totalAssets ?? null,
      portfolioValuationStatus: portfolio.portfolioValuationStatus ?? null,
      riskBudget
    } : null
  };
}

function materialEvidenceProjection(input: unknown) {
  const value = isRecord(input) ? input : {};
  const evidence = isRecord(value.evidencePackage) ? value.evidencePackage : null;
  if (!evidence) return null;
  const fundamentals = isRecord(evidence.fundamentals) ? evidence.fundamentals : {};
  const disclosures = isRecord(evidence.disclosures) ? evidence.disclosures : {};
  const news = isRecord(evidence.news) ? evidence.news : {};
  const marketEnvironment = isRecord(evidence.marketEnvironment) ? evidence.marketEnvironment : {};

  return {
    schemaVersion: evidence.schemaVersion ?? null,
    decisionPolicyVersion: evidence.decisionPolicyVersion ?? null,
    marketDataRevision: evidence.marketDataRevision ?? null,
    instrument: evidence.instrument ?? null,
    etfEvidence: omitVolatileTimestamps(evidence.etfEvidence),
    marketEnvironment: omitVolatileTimestamps(marketEnvironment),
    fundamentals: omitVolatileTimestamps(fundamentals),
    disclosures: omitVolatileTimestamps(disclosures),
    news: {
      window: news.window ?? null,
      refreshCompleted: news.refreshCompleted ?? null,
      quotaStatus: news.quotaStatus ?? null,
      sourceProviders: news.sourceProviders ?? [],
      relevantCount: news.relevantCount ?? null,
      highCount: news.highCount ?? null,
      mediumCount: news.mediumCount ?? null,
      analyzedCount: news.analyzedCount ?? null,
      fallbackAnalysisCount: news.fallbackAnalysisCount ?? null,
      failedAnalysisCount: news.failedAnalysisCount ?? null,
      pendingCriticalCount: news.pendingCriticalCount ?? null,
      pendingRelevantCount: news.pendingRelevantCount ?? null,
      deadlineExceeded: news.deadlineExceeded ?? null,
      failures: news.failures ?? [],
      items: news.items ?? [],
      timeline: omitVolatileTimestamps(news.timeline)
    },
    dataQuality: evidence.dataQuality ?? null,
    sourceManifest: Array.isArray(evidence.sourceManifest)
      ? evidence.sourceManifest.map((item) => {
          const record = isRecord(item) ? item : {};
          return { kind: record.kind ?? null, provider: record.provider ?? null, status: record.status ?? null };
        })
      : []
  };
}

function omitVolatileTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitVolatileTimestamps);
  if (!isRecord(value)) return value;
  const volatileKeys = new Set([
    "analysisAsOf",
    "asOf",
    "checkedAt",
    "completedAt",
    "fetchedAt",
    "generatedAt",
    "refreshAt",
    "refreshStartedAt",
    "startedAt",
    "updatedAt"
  ]);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !volatileKeys.has(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, omitVolatileTimestamps(child)])
  );
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFallbackAnalysis(outputJson: unknown) {
  const output = outputJson as { isFallback?: boolean } | null;
  return Boolean(output?.isFallback);
}

function result(shouldRun: boolean, reason: string, staleAnalysisAllowed: boolean) {
  return { shouldRun, reason, staleAnalysisAllowed };
}

function extractPreviousState(inputJson: unknown) {
  const value = inputJson as {
    quote?: { price?: number };
    indicators?: IndicatorSnapshot;
    highImpactNewsIds?: string[];
  } | null;
  if (!value?.quote?.price || !value.indicators) return null;
  return {
    price: value.quote.price,
    rsiState: rsiState(value.indicators.rsi14),
    macdState: macdState(value.indicators.macd, value.indicators.macdSignal),
    maState: movingAverageState(value.quote.price, value.indicators),
    highImpactNewsIds: value.highImpactNewsIds ?? []
  };
}
