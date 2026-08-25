import { createHash } from "node:crypto";

import type { ApiQuotaStatus } from "@/lib/apiQuota";
import type { QuoteStatus } from "@/lib/services/quoteService";
import type { PortfolioRiskContext } from "@/lib/analysis/portfolioRiskContext";
import { MARKET_DATA_REVISION } from "@/lib/stock-data/corporateActions";
import type { StockNewsEvidenceRefresh } from "@/lib/news/prepareStockNewsEvidence";
import { buildNewsEventTimeline, type NewsEventTimeline, type NewsTimelineArticle } from "@/lib/news/eventTimeline";
import type { DisclosureEvidence, FundamentalEvidence } from "@/lib/stock-data/types";
import type { Candle, IndicatorSnapshot, Quote } from "@/lib/types";

export const ANALYSIS_EVIDENCE_SCHEMA_VERSION = "1.9.0";
export const ANALYSIS_DECISION_POLICY_VERSION = "north-star-v1";
export const RECENT_CANDLE_LIMIT = 60;
export const MIN_DAILY_HISTORY_CANDLES = 120;

export type DecisionMode = "long_term" | "swing_trade" | "position_management";
export type DecisionStatus =
  | "insufficient_data"
  | "rejected"
  | "research_candidate"
  | "setup_wait"
  | "conditional_entry"
  | "manage_position"
  | "exit_risk";

export type DataQualityStatus = "complete" | "partial" | "insufficient" | "conflicted";

export type DataQualityReport = {
  status: DataQualityStatus;
  quoteFresh: boolean;
  klineFresh: boolean;
  latestDisclosureChecked: boolean;
  disclosuresFresh: boolean;
  criticalDisclosuresRead: boolean;
  fundamentalsAvailable: boolean;
  fundamentalsFresh: boolean;
  fundamentalsComplete: boolean;
  portfolioRiskEvaluated: boolean;
  newsRefreshCompleted: boolean;
  newsQuotaStatus: ApiQuotaStatus;
  criticalNewsAnalyzed: boolean;
  missingFields: string[];
  staleFields: string[];
  conflictingFields: string[];
  fallbacksUsed: string[];
  entryBlockers: string[];
};

export type MarketCandleEvidence = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  changePct: number | null;
  amplitudePct: number | null;
  gapPct: number | null;
  volumeRatio20: number | null;
};

export type DeterministicMarketFeatures = {
  featureVersion: string;
  return5dPct: number | null;
  return20dPct: number | null;
  return60dPct: number | null;
  realizedVolatility20dPct: number | null;
  averageTrueRange14: number | null;
  atr14Pct: number | null;
  volumeRatio20: number | null;
  maxDrawdown60dPct: number | null;
  pricePosition60dPct: number | null;
  latestGapPct: number | null;
};

export type AnalysisEvidencePackage = {
  schemaVersion: string;
  decisionPolicyVersion: string;
  symbol: string;
  decisionMode: DecisionMode;
  analysisAsOf: string;
  marketDataRevision: string;
  userContext: unknown;
  portfolioContext: {
    capital: number | null;
    risk: PortfolioRiskContext | null;
  };
  marketData: {
    quote: Quote;
    quoteStatus: QuoteStatus;
    quoteSource: string;
    historyRange: "1y";
    historyInterval: "1d";
    historyFrom: string | null;
    historyTo: string | null;
    historyCandles: number;
    recentCandles: MarketCandleEvidence[];
  };
  fundamentals: FundamentalEvidence;
  disclosures: DisclosureEvidence;
  news: {
    window: string;
    refreshStartedAt: string | null;
    refreshAt: string | null;
    refreshCompleted: boolean;
    quotaStatus: ApiQuotaStatus;
    cacheHitCount: number;
    tianapiCalls: number;
    tavilyCalls: number;
    sharedTopicReused: boolean;
    skippedQueryCount: number;
    sourceProviders: string[];
    fetchedCount: number;
    savedCount: number;
    filteredOutCount: number;
    relevantCount: number;
    highCount: number;
    mediumCount: number;
    analyzedCount: number;
    fallbackAnalysisCount: number;
    failedAnalysisCount: number;
    pendingCriticalCount: number;
    pendingRelevantCount: number;
    deadlineExceeded: boolean;
    webSearchUsed: boolean;
    failures: string[];
    items: unknown[];
    timeline: NewsEventTimeline;
  };
  deterministicFeatures: {
    indicators: IndicatorSnapshot;
    market: DeterministicMarketFeatures;
  };
  dataQuality: DataQualityReport;
  sourceManifest: Array<{
    kind: "quote" | "kline" | "news" | "fundamentals" | "valuation" | "peer_valuation" | "disclosure";
    provider: string;
    asOf: string | null;
    status: "available" | "partial" | "unavailable";
  }>;
  evidenceHash: string;
};

type EvidenceNewsItem = {
  id?: string;
  title?: string;
  url?: string | null;
  source?: string | null;
  publishedAt?: string | Date;
  importance?: string | null;
  analyses?: Array<{ aiSummary?: string | null; isFallback?: boolean; eventContextJson?: unknown; createdAt?: string | Date | null }>;
};

export function resolveDecisionMode(userContext: unknown): DecisionMode {
  const record = isRecord(userContext) ? userContext : {};
  if (record.isHolding === true || (record.isHolding !== false && (positiveNumber(record.holdingShares) !== null || positiveNumber(record.holdingPrice) !== null))) {
    return "position_management";
  }
  return record.timeHorizon === "long_term" ? "long_term" : "swing_trade";
}

export function buildAnalysisEvidencePackage(input: {
  symbol: string;
  quote: Quote;
  quoteStatus: QuoteStatus;
  quoteSource: string;
  history: Candle[];
  indicators: IndicatorSnapshot;
  userContext: unknown;
  userCapital: number | null;
  portfolioRiskContext?: PortfolioRiskContext | null;
  relevantNews: EvidenceNewsItem[];
  analyzedNews: unknown[];
  lastNewsFetch: Date | string | null;
  newsRefreshCompleted?: boolean;
  newsEvidenceRefresh?: StockNewsEvidenceRefresh | null;
  newsEventTimeline?: NewsEventTimeline;
  fundamentals?: AnalysisEvidencePackage["fundamentals"];
  disclosures?: AnalysisEvidencePackage["disclosures"];
  analysisAsOf?: string;
  now?: Date;
}): AnalysisEvidencePackage {
  const now = input.now ?? new Date();
  const analysisAsOf = input.analysisAsOf ?? now.toISOString();
  const decisionMode = resolveDecisionMode(input.userContext);
  const history = [...input.history].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const recentCandles = buildRecentCandleEvidence(history);
  const newsTimeline = input.newsEventTimeline ?? buildNewsEventTimeline({
    articles: input.relevantNews.filter(isTimelineNewsItem),
    candles: history,
    analysisAsOf
  });
  const refresh = input.newsEvidenceRefresh ?? null;
  const databaseAnalyzedCount = input.relevantNews.filter(
    (item) => Boolean(item.analyses?.[0]?.aiSummary) && !item.analyses?.[0]?.isFallback
  ).length;
  const databaseFallbackCount = input.relevantNews.filter((item) => Boolean(item.analyses?.[0]?.isFallback)).length;
  const databasePendingCriticalCount = input.relevantNews.filter(
    (item) => item.importance === "high" && (!item.analyses?.[0]?.aiSummary || item.analyses?.[0]?.isFallback)
  ).length;
  // 覆盖状态始终以当前数据库事实为准；持久化刷新回执只证明抓取过程，不能掩盖回执之后新出现的未精读新闻。
  const analyzedCount = databaseAnalyzedCount;
  const fallbackAnalysisCount = databaseFallbackCount;
  const failedAnalysisCount = refresh?.coverage.failedAnalysisCount ?? 0;
  const pendingCriticalCount = databasePendingCriticalCount;
  const pendingRelevantCount = Math.max(0, input.relevantNews.length - databaseAnalyzedCount);
  const newsRefreshCompleted = refresh
    ? refresh.refreshCompleted && isRecentTimestamp(refresh.completedAt, now, 24 * 60 * 60 * 1000)
    : input.newsRefreshCompleted ?? isRecentTimestamp(input.lastNewsFetch, now, 24 * 60 * 60 * 1000);
  const newsQuotaStatus = refresh?.fetch?.quotaStatus ?? "available";
  const quoteFresh = input.quoteStatus === "normal" || input.quoteStatus === "cached";
  const historyTo = history.at(-1)?.timestamp ?? null;
  const klineFresh = isRecentTimestamp(historyTo, now, 7 * 24 * 60 * 60 * 1000);
  const fundamentals = input.fundamentals ?? unavailableFundamentals();
  const disclosures = input.disclosures ?? uncheckedDisclosures();
  const disclosureOcrCount = disclosures.items.filter((item) => item.contentExtraction?.method === "ocr" || item.contentExtraction?.method === "hybrid_ocr").length;
  const fundamentalsAvailable = fundamentals.status !== "unavailable";
  const fundamentalsComplete = fundamentals.status === "available";
  const fundamentalsFresh = fundamentalsAvailable && isRecentTimestamp(fundamentals.fetchedAt, now, 7 * 24 * 60 * 60 * 1000);
  const disclosuresFresh = disclosures.status === "checked"
    && isRecentTimestamp(disclosures.checkedAt, now, 24 * 60 * 60 * 1000);
  const latestDisclosureChecked = disclosuresFresh;
  const criticalDisclosureUnread = disclosures.criticalUnreadCount > 0;
  const criticalDisclosuresRead = !criticalDisclosureUnread;
  const portfolioRiskEvaluated = Boolean(input.portfolioRiskContext);
  const portfolioRiskBlocked = input.portfolioRiskContext?.riskBudget.status === "blocked"
    || input.portfolioRiskContext?.riskBudget.status === "breached_stop";
  const missingFields = [
    ...fundamentals.missingFields,
    ...(!fundamentalsAvailable ? ["fundamentals"] : []),
    ...(!latestDisclosureChecked ? ["latestDisclosures"] : []),
    ...(criticalDisclosureUnread ? ["criticalDisclosureContent"] : []),
    ...(!portfolioRiskEvaluated ? ["portfolioRiskBudget"] : []),
    ...(!newsRefreshCompleted ? ["currentNewsRefresh"] : []),
    ...(newsQuotaStatus === "quota_exhausted" ? ["newsApiQuota"] : []),
    ...(pendingRelevantCount > 0 ? ["relevantNewsAnalysisCoverage"] : []),
    ...(newsTimeline.futureDatedArticleCount > 0 ? ["futureDatedNews"] : []),
    ...(newsTimeline.events.length > 0 && newsTimeline.explicitExpectationCount < newsTimeline.events.length ? ["newsExpectationBaseline"] : []),
    ...(history.length < MIN_DAILY_HISTORY_CANDLES ? ["minimum120DailyCandles"] : [])
  ];
  const staleFields = [
    ...(!quoteFresh ? ["quote"] : []),
    ...(!klineFresh ? ["dailyKline"] : []),
    ...(fundamentalsAvailable && !fundamentalsFresh ? ["fundamentalsFetch"] : []),
    ...(disclosures.status === "checked" && !disclosuresFresh ? ["disclosureCheck"] : [])
  ];
  const conflictingFields: string[] = [...fundamentals.conflictingFields];
  const criticalNewsAnalyzed = pendingCriticalCount === 0;
  const highExpectationUnclosedCount = newsTimeline.events.filter(
    (event) => event.importance === "high" && event.eventContext.expectation.status !== "explicit"
  ).length;
  const entryBlockers = uniqueStrings([
    ...(!quoteFresh ? ["行情不是最新可交易状态"] : []),
    ...(!klineFresh ? ["日 K 线未更新到最近交易阶段"] : []),
    ...(history.length < MIN_DAILY_HISTORY_CANDLES ? [`日 K 线不足 ${MIN_DAILY_HISTORY_CANDLES} 根`] : []),
    ...(!latestDisclosureChecked ? ["尚未核对最新法定公告"] : []),
    ...(criticalDisclosureUnread ? [`仍有 ${disclosures.criticalUnreadCount} 条关键公告仅有元数据，尚未阅读原文`] : []),
    ...(!fundamentalsAvailable ? ["缺少基本面风险过滤证据"] : []),
    ...(fundamentalsAvailable && !fundamentalsFresh ? ["基本面证据抓取时间已经过期"] : []),
    ...(decisionMode === "long_term" && !fundamentalsComplete ? ["长期模式的财务与估值证据尚不完整"] : []),
    ...(!portfolioRiskEvaluated ? ["尚未完成组合风险预算，不能生成执行仓位"] : []),
    ...(portfolioRiskBlocked ? [input.portfolioRiskContext?.riskBudget.reason ?? "组合风险预算禁止新增风险"] : []),
    ...(!newsRefreshCompleted ? ["本轮分析前未确认完成最新新闻刷新"] : []),
    ...(newsQuotaStatus === "quota_exhausted" ? ["新闻检索额度已用尽，当前新闻证据不完整，禁止新增仓位"] : []),
    ...(!criticalNewsAnalyzed ? ["仍有高影响新闻尚未完成可信 AI 精读"] : []),
    ...(newsTimeline.futureDatedArticleCount > 0
      ? [`有 ${newsTimeline.futureDatedArticleCount} 条新闻的发布时间晚于分析截止时间，已排除且禁止新增仓位`]
      : []),
    ...(decisionMode === "swing_trade" && highExpectationUnclosedCount > 0
      ? [`仍有 ${highExpectationUnclosedCount} 个高影响新闻事件缺少原文明示的事前预期基线，不能把普通利好或利空当作可交易预期差`]
      : []),
    ...(fallbackAnalysisCount > 0 ? ["相关新闻存在本地兜底精读，不能作为买入证据"] : [])
  ]);
  const status: DataQualityStatus = conflictingFields.length
    ? "conflicted"
    : entryBlockers.length
      ? "insufficient"
      : missingFields.length
        ? "partial"
        : "complete";
  const dataQuality: DataQualityReport = {
    status,
    quoteFresh,
    klineFresh,
    latestDisclosureChecked,
    disclosuresFresh,
    criticalDisclosuresRead,
    fundamentalsAvailable,
    fundamentalsFresh,
    fundamentalsComplete,
    portfolioRiskEvaluated,
    newsRefreshCompleted,
    newsQuotaStatus,
    criticalNewsAnalyzed,
    missingFields,
    staleFields,
    conflictingFields,
    fallbacksUsed: [
      ...(fallbackAnalysisCount > 0 ? [`newsAnalysisFallback:${fallbackAnalysisCount}`] : []),
      ...(disclosureOcrCount > 0 ? [`disclosureOCR:${disclosureOcrCount}`] : [])
    ],
    entryBlockers
  };
  const analysisDisclosures = compactDisclosureEvidence(disclosures);

  const packageWithoutHash = {
    schemaVersion: ANALYSIS_EVIDENCE_SCHEMA_VERSION,
    decisionPolicyVersion: ANALYSIS_DECISION_POLICY_VERSION,
    symbol: input.symbol.toUpperCase(),
    decisionMode,
    analysisAsOf,
    marketDataRevision: MARKET_DATA_REVISION,
    userContext: input.userContext,
    portfolioContext: { capital: input.userCapital, risk: input.portfolioRiskContext ?? null },
    marketData: {
      quote: input.quote,
      quoteStatus: input.quoteStatus,
      quoteSource: input.quoteSource,
      historyRange: "1y" as const,
      historyInterval: "1d" as const,
      historyFrom: history[0]?.timestamp ?? null,
      historyTo,
      historyCandles: history.length,
      recentCandles
    },
    fundamentals,
    disclosures: analysisDisclosures,
    news: {
      window: "最近 7 天",
      refreshStartedAt: refresh?.startedAt ?? null,
      refreshAt: refresh?.completedAt ?? normalizeTimestamp(input.lastNewsFetch),
      refreshCompleted: newsRefreshCompleted,
      quotaStatus: newsQuotaStatus,
      cacheHitCount: refresh?.fetch?.cacheHitCount ?? 0,
      tianapiCalls: refresh?.fetch?.tianapiCalls ?? 0,
      tavilyCalls: refresh?.fetch?.tavilyCalls ?? 0,
      sharedTopicReused: refresh?.fetch?.sharedTopicReused ?? false,
      skippedQueryCount: refresh?.fetch?.skippedQueryCount ?? 0,
      sourceProviders: refresh?.fetch?.sourceProviders ?? [],
      fetchedCount: refresh?.fetch?.fetched ?? 0,
      savedCount: refresh?.fetch?.saved ?? 0,
      filteredOutCount: refresh?.fetch?.filteredOut ?? 0,
      relevantCount: input.relevantNews.length,
      highCount: input.relevantNews.filter((item) => item.importance === "high").length,
      mediumCount: input.relevantNews.filter((item) => item.importance === "medium").length,
      analyzedCount,
      fallbackAnalysisCount,
      failedAnalysisCount,
      pendingCriticalCount,
      pendingRelevantCount,
      deadlineExceeded: refresh?.deadlineExceeded ?? false,
      webSearchUsed: refresh?.fetch?.webSearchUsed ?? false,
      failures: refresh?.failures ?? [],
      items: input.analyzedNews,
      timeline: newsTimeline
    },
    deterministicFeatures: {
      indicators: input.indicators,
      market: calculateDeterministicMarketFeatures(history)
    },
    dataQuality,
    sourceManifest: [
      {
        kind: "quote" as const,
        provider: input.quoteSource,
        asOf: input.quote.timestamp,
        status: quoteFresh ? "available" as const : "partial" as const
      },
      {
        kind: "kline" as const,
        provider: input.quoteSource,
        asOf: historyTo,
        status: klineFresh ? "available" as const : "partial" as const
      },
      {
        kind: "news" as const,
        provider: "database",
        asOf: refresh?.completedAt ?? normalizeTimestamp(input.lastNewsFetch),
        status: newsRefreshCompleted ? "available" as const : "partial" as const
      },
      {
        kind: "fundamentals" as const,
        provider: fundamentals.provider,
        asOf: fundamentals.reportPeriod,
        status: fundamentals.status
      },
      {
        kind: "valuation" as const,
        provider: fundamentals.valuation.historicalEvidence?.priceProvider ?? fundamentals.provider,
        asOf: fundamentals.valuation.historicalEvidence?.windowEnd ?? fundamentals.valuation.asOf,
        status: fundamentals.valuation.historicalEvidence?.status
          ?? (fundamentals.valuation.historicalPercentile !== null ? "available" as const : "unavailable" as const)
      },
      {
        kind: "peer_valuation" as const,
        provider: fundamentals.valuation.peerEvidence?.provider ?? "not_configured",
        asOf: fundamentals.valuation.peerEvidence?.fetchedAt ?? null,
        status: fundamentals.valuation.peerEvidence?.status === "available"
          ? "available" as const
          : fundamentals.valuation.peerEvidence?.status === "partial" || fundamentals.valuation.peerEvidence?.status === "conflicted"
            ? "partial" as const
            : "unavailable" as const
      },
      {
        kind: "disclosure" as const,
        provider: disclosures.provider,
        asOf: disclosures.checkedAt,
        status: disclosures.status === "checked" ? "available" as const : disclosures.status === "partial" ? "partial" as const : "unavailable" as const
      }
    ]
  };

  return {
    ...packageWithoutHash,
    evidenceHash: createHash("sha256").update(JSON.stringify(packageWithoutHash)).digest("hex")
  };
}

export function compactDisclosureEvidence(disclosures: DisclosureEvidence): DisclosureEvidence {
  return {
    ...disclosures,
    items: disclosures.items.map((item) => item.isFundamentalSource && !item.isCritical
      ? { ...item, contentExcerpt: null }
      : item)
  };
}

export function buildRecentCandleEvidence(candles: Candle[], limit = RECENT_CANDLE_LIMIT): MarketCandleEvidence[] {
  const sorted = [...candles].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  return sorted.slice(-limit).map((candle, index, selected) => {
    const previous = selected[index - 1] ?? sorted[sorted.length - selected.length - 1];
    const priorVolumes = sorted
      .filter((item) => Date.parse(item.timestamp) < Date.parse(candle.timestamp))
      .slice(-20)
      .map((item) => item.volume);
    const averageVolume20 = average(priorVolumes);
    return {
      timestamp: candle.timestamp,
      open: round(candle.open, 4) ?? candle.open,
      high: round(candle.high, 4) ?? candle.high,
      low: round(candle.low, 4) ?? candle.low,
      close: round(candle.close, 4) ?? candle.close,
      volume: Math.round(candle.volume),
      changePct: previous?.close ? round((candle.close / previous.close - 1) * 100) : null,
      amplitudePct: previous?.close ? round(((candle.high - candle.low) / previous.close) * 100) : null,
      gapPct: previous?.close ? round((candle.open / previous.close - 1) * 100) : null,
      volumeRatio20: averageVolume20 ? round(candle.volume / averageVolume20) : null
    };
  });
}

export function calculateDeterministicMarketFeatures(candles: Candle[]): DeterministicMarketFeatures {
  const sorted = [...candles].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const closes = sorted.map((item) => item.close);
  const latest = sorted.at(-1);
  const window60 = sorted.slice(-60);
  const atr14 = averageTrueRange(sorted, 14);
  const volumeBaseline = average(sorted.slice(-21, -1).map((item) => item.volume));
  const rollingPeakDrawdowns = window60.map((item, index) => {
    const peak = Math.max(...window60.slice(0, index + 1).map((row) => row.close));
    return peak > 0 ? (item.close / peak - 1) * 100 : 0;
  });
  const low60 = window60.length ? Math.min(...window60.map((item) => item.low)) : null;
  const high60 = window60.length ? Math.max(...window60.map((item) => item.high)) : null;
  const previous = sorted.at(-2);

  return {
    featureVersion: "market-features-v1",
    return5dPct: trailingReturn(closes, 5),
    return20dPct: trailingReturn(closes, 20),
    return60dPct: trailingReturn(closes, 60),
    realizedVolatility20dPct: realizedVolatility(closes.slice(-21)),
    averageTrueRange14: round(atr14, 4),
    atr14Pct: latest?.close && atr14 !== null ? round((atr14 / latest.close) * 100) : null,
    volumeRatio20: latest && volumeBaseline ? round(latest.volume / volumeBaseline) : null,
    maxDrawdown60dPct: rollingPeakDrawdowns.length ? round(Math.min(...rollingPeakDrawdowns)) : null,
    pricePosition60dPct:
      latest && low60 !== null && high60 !== null && high60 > low60
        ? round(((latest.close - low60) / (high60 - low60)) * 100)
        : null,
    latestGapPct: latest && previous?.close ? round((latest.open / previous.close - 1) * 100) : null
  };
}

function trailingReturn(values: number[], periods: number) {
  if (values.length <= periods) return null;
  const base = values[values.length - periods - 1];
  const latest = values.at(-1);
  if (!base || latest === undefined) return null;
  return round((latest / base - 1) * 100);
}

function realizedVolatility(values: number[]) {
  if (values.length < 3) return null;
  const returns = values.slice(1).map((value, index) => Math.log(value / values[index])).filter(Number.isFinite);
  if (returns.length < 2) return null;
  const mean = average(returns) ?? 0;
  const variance = returns.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / (returns.length - 1);
  return round(Math.sqrt(variance) * Math.sqrt(252) * 100);
}

function averageTrueRange(candles: Candle[], period: number) {
  if (candles.length < period + 1) return null;
  const selected = candles.slice(-(period + 1));
  const ranges = selected.slice(1).map((candle, index) => {
    const previousClose = selected[index].close;
    return Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
  });
  return average(ranges);
}

function isRecentTimestamp(value: Date | string | null | undefined, now: Date, maxAgeMs: number) {
  const normalized = normalizeTimestamp(value);
  if (!normalized) return false;
  const time = Date.parse(normalized);
  const age = now.getTime() - time;
  return Number.isFinite(age) && age >= -60_000 && age <= maxAgeMs;
}

function normalizeTimestamp(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function average(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function isTimelineNewsItem(item: EvidenceNewsItem): item is EvidenceNewsItem & NewsTimelineArticle {
  return typeof item.id === "string"
    && typeof item.title === "string"
    && (typeof item.publishedAt === "string" || item.publishedAt instanceof Date);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function unavailableFundamentals(): FundamentalEvidence {
  const reason = "当前股票数据源尚未接入版本化财务与估值证据。";
  return {
    schemaVersion: "fundamental-evidence-v2",
    status: "unavailable",
    provider: "not_configured",
    sourceUrl: "",
    fetchedAt: new Date(0).toISOString(),
    reportPeriod: null,
    annualPeriods: [],
    quarterlyPeriods: [],
    adjustedNetIncomeSources: [],
    valuation: {
      asOf: null,
      price: null,
      epsTtm: null,
      peTtm: null,
      bookValuePerShare: null,
      pb: null,
      historicalPercentile: null,
      historicalEvidence: null,
      peerEvidence: null
    },
    metrics: {},
    missingFields: ["fundamentals"],
    conflictingFields: [],
    failures: [reason],
    missingReason: reason
  };
}

function uncheckedDisclosures(): DisclosureEvidence {
  return {
    schemaVersion: "disclosure-evidence-v2",
    status: "unchecked",
    provider: "not_configured",
    queryUrl: "",
    checkedAt: null,
    windowFrom: null,
    windowTo: null,
    latestPublishedAt: null,
    totalCount: 0,
    criticalUnreadCount: 0,
    items: [],
    failures: ["当前股票数据源尚未接入法定公告证据。"]
  };
}
