import assert from "node:assert/strict";
import test from "node:test";

import {
  ANALYSIS_EVIDENCE_SCHEMA_VERSION,
  buildAnalysisEvidencePackage,
  calculateDeterministicMarketFeatures,
  compactDisclosureEvidence,
  resolveDecisionMode
} from "@/lib/analysis/evidence";
import { createAnalysisCacheKey, createAnalysisContextHash } from "@/lib/analysis/contextHash";
import { buildAnalysisTradePlan } from "@/lib/ai/analyzeStock";
import { decisionModeInstructions } from "@/lib/ai/stockAnalysisPrompt";
import type { AnalyzeStockInput } from "@/lib/ai/stockAnalysisTypes";
import type { StockNewsEvidenceRefresh } from "@/lib/news/prepareStockNewsEvidence";
import type { Candle, IndicatorSnapshot, Quote } from "@/lib/types";
import { buildPortfolioRiskBudget } from "@/lib/trading/riskBudget";

const now = new Date("2026-08-25T00:30:00+08:00");
const candles = buildCandles(130, new Date("2026-08-24T15:00:00+08:00"));
const quote: Quote = {
  symbol: "600000.SH",
  name: "测试银行",
  currency: "CNY",
  price: candles.at(-1)?.close ?? 12,
  open: 11.9,
  high: 12.2,
  low: 11.8,
  close: 12,
  previousClose: 11.9,
  change: 0.1,
  changePercent: 0.84,
  volume: 2_000_000,
  timestamp: "2026-08-24T15:00:00+08:00"
};
const indicators: IndicatorSnapshot = {
  symbol: quote.symbol,
  rsi14: 58,
  macd: 0.2,
  macdSignal: 0.1,
  sma20: 11.7,
  sma50: 11.2,
  sma200: null,
  ema20: 11.75,
  bollingerUpper: 12.8,
  bollingerMiddle: 11.7,
  bollingerLower: 10.6,
  timestamp: candles.at(-1)?.timestamp ?? quote.timestamp
};
const portfolioRiskContext = {
  schemaVersion: "portfolio-risk-context-v1" as const,
  calculatedAt: "2026-08-24T23:40:00+08:00",
  capital: 100_000,
  availableCash: 100_000,
  totalAssets: 100_000,
  portfolioValuationStatus: "empty",
  riskBudget: buildPortfolioRiskBudget({ capital: 100_000, totalAssets: 100_000, positions: [] })
};

test("evidence package carries 60 recent candles and deterministic market features", () => {
  const evidence = completeEvidence();

  assert.equal(evidence.schemaVersion, ANALYSIS_EVIDENCE_SCHEMA_VERSION);
  assert.equal(evidence.marketData.historyCandles, 130);
  assert.equal(evidence.marketData.recentCandles.length, 60);
  assert.equal(evidence.dataQuality.status, "complete");
  assert.equal(evidence.dataQuality.entryBlockers.length, 0);
  assert.ok(evidence.deterministicFeatures.market.return20dPct !== null);
  assert.ok(evidence.deterministicFeatures.market.averageTrueRange14 !== null);
  assert.equal(evidence.sourceManifest.find((source) => source.kind === "valuation")?.status, "available");
  assert.match(evidence.evidenceHash, /^[a-f0-9]{64}$/);
});

test("missing disclosure and current news refresh become deterministic entry blockers", () => {
  const evidence = buildAnalysisEvidencePackage({
    symbol: quote.symbol,
    quote,
    quoteStatus: "normal",
    quoteSource: "fixture",
    history: candles,
    indicators,
    userContext: { isHolding: false, timeHorizon: "swing_trade" },
    userCapital: 100_000,
    portfolioRiskContext,
    relevantNews: [{ importance: "high", analyses: [] }],
    analyzedNews: [],
    lastNewsFetch: null,
    now
  });

  assert.equal(evidence.dataQuality.status, "insufficient");
  assert.ok(evidence.dataQuality.entryBlockers.includes("尚未核对最新法定公告"));
  assert.ok(evidence.dataQuality.entryBlockers.includes("本轮分析前未确认完成最新新闻刷新"));
  assert.ok(evidence.dataQuality.entryBlockers.includes("仍有高影响新闻尚未完成可信 AI 精读"));

  const plan = buildAnalysisTradePlan(analysisFixture(), analyzeInput(evidence));
  assert.equal(plan.entry.status, "blocked");
  assert.equal(plan.entry.action, "avoid");
  assert.ok(plan.entry.constraints.some((item) => item.includes("证据硬门控")));
});

test("decision mode separates long-term, swing and position management", () => {
  assert.equal(resolveDecisionMode({ isHolding: true, timeHorizon: "long_term" }), "position_management");
  assert.equal(resolveDecisionMode({ isHolding: false, timeHorizon: "long_term" }), "long_term");
  assert.equal(resolveDecisionMode({ isHolding: false, timeHorizon: "swing_trade" }), "swing_trade");
  assert.equal(resolveDecisionMode({ isHolding: false, holdingPrice: 10, timeHorizon: "long_term" }), "long_term");
  assert.match(decisionModeInstructions("long_term"), /5 年年度与 8 个独立季度/);
  assert.match(decisionModeInstructions("swing_trade"), /近期 5\/20\/60 日量价/);
  assert.match(decisionModeInstructions("position_management"), /持仓成本/);
});

test("context hash changes with capital, memory and recent K-line evidence", () => {
  const evidence = completeEvidence();
  const base = contextHash(evidence, 100_000, "偏好低回撤");
  assert.notEqual(base, contextHash(evidence, 200_000, "偏好低回撤"));
  assert.notEqual(base, contextHash(evidence, 100_000, "可承受较高波动"));

  const changedCandles = candles.map((item, index) => index === candles.length - 1 ? { ...item, close: item.close + 0.2 } : item);
  const changedEvidence = buildAnalysisEvidencePackage({
    ...completeEvidenceInput(),
    history: changedCandles
  });
  assert.notEqual(base, contextHash(changedEvidence, 100_000, "偏好低回撤"));
});

test("context hash ignores snapshot generation time but changes with disclosure content", () => {
  const base = completeEvidence();
  const later = buildAnalysisEvidencePackage({
    ...completeEvidenceInput(),
    portfolioRiskContext: { ...portfolioRiskContext, calculatedAt: "2026-08-25T03:00:00+08:00" },
    analysisAsOf: "2026-08-25T03:00:00+08:00",
    now: new Date("2026-08-25T03:00:00+08:00")
  });
  assert.notEqual(base.evidenceHash, later.evidenceHash);
  assert.equal(contextHash(base, 100_000, "偏好低回撤"), contextHash(later, 100_000, "偏好低回撤"));

  const input = completeEvidenceInput();
  const changedDisclosure = buildAnalysisEvidencePackage({
    ...input,
    disclosures: {
      ...input.disclosures,
      items: input.disclosures.items.map((item) => ({ ...item, contentHash: "revised-filing-hash" }))
    }
  });
  assert.notEqual(contextHash(base, 100_000, "偏好低回撤"), contextHash(changedDisclosure, 100_000, "偏好低回撤"));
});

test("context hash changes when derived fundamental metrics change", () => {
  const base = completeEvidence();
  const input = completeEvidenceInput();
  const changedMetrics = buildAnalysisEvidencePackage({
    ...input,
    fundamentals: {
      ...input.fundamentals,
      metrics: { ...input.fundamentals.metrics, freeCashFlowMarginTtmPct: 12.5 }
    }
  });

  assert.notEqual(contextHash(base, 100_000, "偏好低回撤"), contextHash(changedMetrics, 100_000, "偏好低回撤"));
});

test("context hash changes when the historical valuation price series changes", () => {
  const input = completeEvidenceInput();
  const first = buildAnalysisEvidencePackage({
    ...input,
    fundamentals: {
      ...input.fundamentals,
      valuation: {
        ...input.fundamentals.valuation,
        historicalEvidence: historicalValuationFixture("price-series-a")
      }
    }
  });
  const second = buildAnalysisEvidencePackage({
    ...input,
    fundamentals: {
      ...input.fundamentals,
      valuation: {
        ...input.fundamentals.valuation,
        historicalEvidence: historicalValuationFixture("price-series-b")
      }
    }
  });

  assert.notEqual(contextHash(first, 100_000, "偏好低回撤"), contextHash(second, 100_000, "偏好低回撤"));
});

test("context hash changes when the peer valuation evidence changes", () => {
  const input = completeEvidenceInput();
  const first = buildAnalysisEvidencePackage({
    ...input,
    fundamentals: {
      ...input.fundamentals,
      valuation: { ...input.fundamentals.valuation, peerEvidence: peerValuationFixture("peer-hash-a") }
    }
  });
  const second = buildAnalysisEvidencePackage({
    ...input,
    fundamentals: {
      ...input.fundamentals,
      valuation: { ...input.fundamentals.valuation, peerEvidence: peerValuationFixture("peer-hash-b") }
    }
  });

  assert.notEqual(contextHash(first, 100_000, "偏好低回撤"), contextHash(second, 100_000, "偏好低回撤"));
});

test("context hash changes when an adjusted-profit source document changes", () => {
  const input = completeEvidenceInput();
  const source = {
    schemaVersion: "adjusted-net-income-fact-v1" as const,
    parserVersion: "cninfo-periodic-table-v1" as const,
    periodEnd: "2026-06-30",
    periodKind: "half_year" as const,
    currency: "CNY" as const,
    sourceUnit: "CNY" as const,
    cumulativeValueCny10k: 95,
    priorComparableValueCny10k: 90,
    reportedParentNetIncomeCny10k: 100,
    rawCurrentValue: "950000",
    rawPriorComparableValue: "900000",
    sourceDisclosureId: "report-2026-h1",
    sourceTitle: "2026年半年度报告",
    sourceUrl: "https://static.cninfo.com.cn/finalpage/2026-08-20/report.PDF",
    publishedAt: "2026-08-20T00:00:00.000Z",
    contentHash: "first-content-hash"
  };
  const first = buildAnalysisEvidencePackage({
    ...input,
    fundamentals: { ...input.fundamentals, adjustedNetIncomeSources: [source] }
  });
  const revised = buildAnalysisEvidencePackage({
    ...input,
    fundamentals: { ...input.fundamentals, adjustedNetIncomeSources: [{ ...source, contentHash: "revised-content-hash" }] }
  });

  assert.notEqual(contextHash(first, 100_000, "偏好低回撤"), contextHash(revised, 100_000, "偏好低回撤"));
});

test("OCR disclosure fallback is visible and changes the context hash even when text hash is unchanged", () => {
  const input = completeEvidenceInput();
  const embedded = buildAnalysisEvidencePackage({
    ...input,
    disclosures: {
      ...input.disclosures,
      items: input.disclosures.items.map((item) => ({
        ...item,
        contentExtraction: disclosureExtractionFixture("embedded_text")
      }))
    }
  });
  const ocr = buildAnalysisEvidencePackage({
    ...input,
    disclosures: {
      ...input.disclosures,
      items: input.disclosures.items.map((item) => ({
        ...item,
        contentExtraction: disclosureExtractionFixture("ocr")
      }))
    }
  });

  assert.ok(ocr.dataQuality.fallbacksUsed.includes("disclosureOCR:1"));
  assert.notEqual(contextHash(embedded, 100_000, "偏好低回撤"), contextHash(ocr, 100_000, "偏好低回撤"));
});

test("analysis cache keys are isolated by user", () => {
  const hash = "a".repeat(64);
  assert.notEqual(
    createAnalysisCacheKey("user-a", quote.symbol, hash),
    createAnalysisCacheKey("user-b", quote.symbol, hash)
  );
});

test("deterministic features never use candles after the provided cutoff", () => {
  const before = calculateDeterministicMarketFeatures(candles.slice(0, -1));
  const after = calculateDeterministicMarketFeatures(candles);
  assert.notDeepEqual(before, after);
  assert.equal(before.return5dPct, calculateDeterministicMarketFeatures(candles.slice(0, -1)).return5dPct);
});

test("a persisted news receipt expires and cannot keep the refresh gate open indefinitely", () => {
  const evidence = buildAnalysisEvidencePackage({
    ...completeEvidenceInput(),
    newsRefreshCompleted: undefined,
    newsEvidenceRefresh: newsReceipt({
      completedAt: "2026-08-22T00:00:00+08:00"
    })
  });

  assert.equal(evidence.dataQuality.newsRefreshCompleted, false);
  assert.ok(evidence.dataQuality.entryBlockers.includes("本轮分析前未确认完成最新新闻刷新"));
});

test("fallback news analysis is visible and blocks conditional entry", () => {
  const evidence = buildAnalysisEvidencePackage({
    ...completeEvidenceInput(),
    relevantNews: [{ importance: "high", analyses: [{ aiSummary: "本地兜底摘要", isFallback: true }] }],
    newsEvidenceRefresh: newsReceipt({
      coverage: {
        relevantCount: 1,
        highCount: 1,
        mediumCount: 0,
        verifiedAnalyzedCount: 0,
        fallbackAnalysisCount: 1,
        failedAnalysisCount: 0,
        pendingCriticalCount: 1,
        pendingRelevantCount: 1
      }
    })
  });

  assert.equal(evidence.dataQuality.status, "insufficient");
  assert.deepEqual(evidence.dataQuality.fallbacksUsed, ["newsAnalysisFallback:1"]);
  assert.ok(evidence.dataQuality.entryBlockers.includes("相关新闻存在本地兜底精读，不能作为买入证据"));
});

test("exhausted news quota is explicit and blocks new positions", () => {
  const evidence = buildAnalysisEvidencePackage({
    ...completeEvidenceInput(),
    newsEvidenceRefresh: newsReceipt({
      refreshCompleted: false,
      fetch: {
        ...newsReceipt().fetch!,
        completed: false,
        quotaStatus: "quota_exhausted",
        quotaEvents: [{
          provider: "tianapi",
          apiName: "news",
          status: "quota_exhausted",
          requestKind: "company",
          message: "今日额度已用完"
        }]
      }
    })
  });

  assert.equal(evidence.news.quotaStatus, "quota_exhausted");
  assert.equal(evidence.dataQuality.newsQuotaStatus, "quota_exhausted");
  assert.ok(evidence.dataQuality.missingFields.includes("newsApiQuota"));
  assert.ok(evidence.dataQuality.entryBlockers.some((item) => item.includes("禁止新增仓位")));
});

test("long-term entry stays blocked when adjusted profit and valuation comparisons are missing", () => {
  const input = completeEvidenceInput();
  const evidence = buildAnalysisEvidencePackage({
    ...input,
    userContext: { isHolding: false, timeHorizon: "long_term" },
    fundamentals: {
      ...input.fundamentals,
      status: "partial" as const,
      missingFields: ["adjustedNetIncome", "valuationHistoricalPercentile", "peerValuation"],
      missingReason: "尚缺长期决策口径"
    }
  });

  assert.equal(evidence.decisionMode, "long_term");
  assert.equal(evidence.dataQuality.status, "insufficient");
  assert.ok(evidence.dataQuality.entryBlockers.includes("长期模式的财务与估值证据尚不完整"));
  assert.equal(buildAnalysisTradePlan(analysisFixture(), analyzeInput(evidence)).entry.status, "blocked");
});

function completeEvidence() {
  return buildAnalysisEvidencePackage(completeEvidenceInput());
}

function completeEvidenceInput() {
  return {
    symbol: quote.symbol,
    quote,
    quoteStatus: "normal" as const,
    quoteSource: "fixture",
    history: candles,
    indicators,
    userContext: { isHolding: false, timeHorizon: "swing_trade" },
    userCapital: 100_000,
    portfolioRiskContext,
    relevantNews: [{ importance: "high", analyses: [{ aiSummary: "测试新闻已完成精读" }] }],
    analyzedNews: [{ title: "测试新闻", summary: "测试新闻已完成精读" }],
    lastNewsFetch: "2026-08-24T23:30:00+08:00",
    newsRefreshCompleted: true,
    fundamentals: {
      schemaVersion: "fundamental-evidence-v2" as const,
      status: "available" as const,
      provider: "fixture",
      sourceUrl: "https://example.test/fundamentals",
      fetchedAt: "2026-08-24T23:32:00+08:00",
      reportPeriod: "2026-06-30",
      annualPeriods: [],
      quarterlyPeriods: [],
      adjustedNetIncomeSources: [],
      valuation: {
        asOf: "2026-08-24T15:00:00+08:00",
        price: 12,
        epsTtm: 1.2,
        peTtm: 10,
        bookValuePerShare: 6,
        pb: 2,
        historicalPercentile: 35
      },
      metrics: { roe: 10.5 },
      missingFields: [],
      conflictingFields: [],
      failures: [],
      missingReason: null
    },
    disclosures: {
      schemaVersion: "disclosure-evidence-v2" as const,
      status: "checked" as const,
      provider: "fixture",
      queryUrl: "https://example.test/disclosures",
      checkedAt: "2026-08-24T23:35:00+08:00",
      windowFrom: "2026-02-25",
      windowTo: "2026-08-24",
      latestPublishedAt: "2026-08-20T18:00:00+08:00",
      totalCount: 1,
      criticalUnreadCount: 0,
      items: [{
        id: "notice-1",
        symbol: quote.symbol,
        companyName: "测试银行",
        title: "半年度报告",
        publishedAt: "2026-08-20T18:00:00+08:00",
        category: "periodic_report" as const,
        source: "fixture",
        sourceUrl: "https://example.test/disclosures/notice-1",
        contentStatus: "analyzed" as const,
        contentHash: "fixture-hash",
        contentExcerpt: "公告原文已经完成提取和分析。",
        extractedCharacters: 16,
        extractionFailure: null,
        isCritical: true,
        isFundamentalSource: true,
        adjustedNetIncomeFact: null
      }],
      failures: []
    },
    now
  };
}

function contextHash(evidence: ReturnType<typeof completeEvidence>, capital: number, memory: string) {
  return createAnalysisContextHash({
    symbol: quote.symbol,
    quote,
    indicators,
    importantNewsIds: ["news-1"],
    evidence,
    userCapital: capital,
    userMemory: memory,
    userContext: {
      isHolding: false,
      holdingPrice: null,
      holdingShares: null,
      targetPrice: 14,
      stopLoss: 11,
      positionOpenedAt: null,
      timeHorizon: "swing_trade",
      riskLevel: "medium"
    }
  });
}

function historicalValuationFixture(priceSeriesHash: string) {
  return {
    schemaVersion: "historical-valuation-v1" as const,
    algorithmVersion: "publication-gated-current-series-v1" as const,
    status: "available" as const,
    asOf: "2026-08-24T15:00:00+08:00",
    windowStart: "2021-08-24",
    windowEnd: "2026-08-24",
    priceProvider: "fixture",
    priceSourceUrl: "https://example.test/raw-history",
    priceAdjustment: "none" as const,
    priceSeriesHash,
    priceSeriesFresh: true,
    priceStalenessDays: 0,
    reportSourceCount: 8,
    minimumTradingDays: 252,
    peSampleSize: 800,
    pbSampleSize: 800,
    pePercentile: 35,
    pbPercentile: 40,
    compositePercentile: 37.5,
    reportSources: [],
    missingReason: null
  };
}

function peerValuationFixture(contentHash: string) {
  return {
    schemaVersion: "peer-valuation-v1" as const,
    algorithmVersion: "eastmoney-provider-ranked-positive-multiples-v1" as const,
    status: "available" as const,
    provider: "EASTMONEY" as const,
    sourceUrl: "https://example.test/peer",
    classificationSourceUrl: "https://example.test/classification",
    fetchedAt: "2026-08-24T15:00:00+08:00",
    maximumAgeHours: 24,
    industryName: "测试行业",
    classificationMethod: "EASTMONEY_EM2016" as const,
    selectionMethod: "EASTMONEY_INDUSTRY_COMPARABLE_RANK" as const,
    peBasis: "PE_TTM" as const,
    pbBasis: "PB_MRQ" as const,
    minimumSampleSize: 5,
    targetSymbol: "600000.SH",
    targetName: "测试公司",
    targetPeTtm: 10,
    targetPbMrq: 2,
    financialReportPeriod: "2025-12-31",
    peComparison: { target: 10, sampleMedian: 12, providerIndustryMedian: 11, percentile: 20, premiumDiscountPct: -16.67, sampleSize: 5 },
    pbComparison: { target: 2, sampleMedian: 2.2, providerIndustryMedian: 2.1, percentile: 40, premiumDiscountPct: -9.09, sampleSize: 5 },
    comparables: [],
    crossCheck: { maximumDifferencePct: 15, peDifferencePct: 1, pbDifferencePct: 1, peMatched: true, pbMatched: true },
    contentHash,
    missingReason: null
  };
}

function disclosureExtractionFixture(method: "embedded_text" | "ocr") {
  return {
    schemaVersion: "disclosure-content-extraction-v1" as const,
    extractorVersion: "pdfparse-tesseract-v1",
    method,
    coverage: "full_document" as const,
    totalPages: 2,
    extractedPages: 2,
    ocrPages: method === "ocr" ? 2 : 0,
    ocrEngine: method === "ocr" ? "fixture-tesseract" : null,
    ocrLanguages: method === "ocr" ? ["chi_sim", "eng"] : []
  };
}

test("metadata-only critical disclosures block entry until original content is read", () => {
  const input = completeEvidenceInput();
  const evidence = buildAnalysisEvidencePackage({
    ...input,
    disclosures: {
      ...input.disclosures,
      criticalUnreadCount: 1,
      items: input.disclosures.items.map((item) => ({ ...item, contentStatus: "metadata_only" as const }))
    }
  });

  assert.equal(evidence.dataQuality.status, "insufficient");
  assert.equal(evidence.dataQuality.criticalDisclosuresRead, false);
  assert.ok(evidence.dataQuality.entryBlockers.some((item) => item.includes("关键公告仅有元数据")));
});

test("historical fundamental reports keep hashes and facts without duplicating long excerpts into the AI context", () => {
  const disclosures = completeEvidenceInput().disclosures;
  const compacted = compactDisclosureEvidence({
    ...disclosures,
    items: [{
      ...disclosures.items[0],
      id: "historical-report",
      isCritical: false,
      isFundamentalSource: true,
      contentExcerpt: "历史报告原文".repeat(2_000),
      adjustedNetIncomeFact: {
        schemaVersion: "adjusted-net-income-fact-v1",
        parserVersion: "cninfo-periodic-table-v1",
        periodEnd: "2025-12-31",
        periodKind: "annual",
        currency: "CNY",
        sourceUnit: "CNY_10K",
        cumulativeValueCny10k: 95,
        priorComparableValueCny10k: 90,
        reportedParentNetIncomeCny10k: 100,
        rawCurrentValue: "95",
        rawPriorComparableValue: "90"
      }
    }]
  });

  assert.equal(compacted.items[0].contentExcerpt, null);
  assert.equal(compacted.items[0].contentHash, disclosures.items[0].contentHash);
  assert.equal(compacted.items[0].adjustedNetIncomeFact?.cumulativeValueCny10k, 95);
});

test("entry plan cannot invent percentage stops or targets when levels are missing", () => {
  const evidence = completeEvidence();
  const input = analyzeInput(evidence);
  input.userContext = { isHolding: false, timeHorizon: "swing_trade" };
  const analysis = { ...analysisFixture(), keyLevels: { support: [], resistance: [] } };
  const plan = buildAnalysisTradePlan(analysis, input);

  assert.equal(plan.entry.status, "blocked");
  assert.equal(plan.entry.stopLossPrice, null);
  assert.equal(plan.entry.takeProfitPrice, null);
  assert.ok(plan.entry.constraints.some((item) => item.includes("有效止损")));
  assert.ok(plan.entry.constraints.some((item) => item.includes("净风险收益比")));
  assert.equal(plan.entry.expectedValueStatus, "not_calibrated");
  assert.equal(plan.entry.expectedValue, null);
});

test("entry shares are fitted to the portfolio risk budget", () => {
  const evidence = completeEvidence();
  const plan = buildAnalysisTradePlan(analysisFixture(), analyzeInput(evidence));

  assert.equal(plan.entry.status, "conditional");
  assert.ok((plan.entry.netMaxLossAmount ?? Number.POSITIVE_INFINITY) <= portfolioRiskContext.riskBudget.singleTradeRiskLimitAmount);
  assert.ok((plan.entry.totalCost ?? Number.POSITIVE_INFINITY) <= portfolioRiskContext.availableCash);
});

test("a breached existing stop blocks new portfolio risk", () => {
  const input = completeEvidenceInput();
  const breachedContext = {
    ...portfolioRiskContext,
    riskBudget: buildPortfolioRiskBudget({
      capital: 100_000,
      totalAssets: 100_000,
      positions: [{ symbol: "000001.SZ", shares: 1_000, currentPrice: 10, stopLossPrice: 11 }]
    })
  };
  const evidence = buildAnalysisEvidencePackage({ ...input, portfolioRiskContext: breachedContext });

  assert.equal(evidence.dataQuality.status, "insufficient");
  assert.ok(evidence.dataQuality.entryBlockers.some((item) => item.includes("跌破止损")));
});

function analysisFixture() {
  return {
    trend: "bullish" as const,
    confidence: 0.7,
    keyLevels: { support: [11], resistance: [14] },
    holdAdvice: null,
    entryAdvice: {
      action: "条件入场",
      reason: "趋势和量价条件满足后考虑小仓执行。",
      entryZone: "11.8-12.0",
      timing: "收盘确认",
      triggerCondition: "量价确认",
      firstPositionSize: "5%",
      stopLoss: "11",
      takeProfit: "14",
      invalidIf: "跌破 11"
    }
  };
}

function analyzeInput(evidence: ReturnType<typeof completeEvidence>): AnalyzeStockInput {
  return {
    symbol: quote.symbol,
    quote,
    indicators,
    historySummary: {},
    userContext: { isHolding: false, targetPrice: 14, stopLoss: 11, timeHorizon: "swing_trade" },
    userCapital: 100_000,
    portfolioRiskContext,
    evidencePackage: evidence
  };
}

function newsReceipt(overrides: Partial<StockNewsEvidenceRefresh> = {}): StockNewsEvidenceRefresh {
  return {
    schemaVersion: "news-evidence-refresh-v3",
    symbol: quote.symbol,
    startedAt: "2026-08-24T23:20:00+08:00",
    completedAt: "2026-08-24T23:30:00+08:00",
    refreshCompleted: true,
    deadlineExceeded: false,
    fetch: {
      schemaVersion: "news-fetch-v3",
      symbol: quote.symbol,
      completed: true,
      fetched: 1,
      saved: 1,
      filteredOut: 0,
      queuedAnalysis: 1,
      webSearchUsed: false,
      companySearchCompleted: true,
      topicSearchCompleted: true,
      quotaStatus: "available",
      quotaEvents: [],
      cacheHitCount: 0,
      tianapiCalls: 2,
      tavilyCalls: 0,
      sharedTopicKey: "sector-topic-v1:banking",
      sharedTopicReused: false,
      skippedQueryCount: 0,
      sourceProviders: ["tianapi"],
      failures: []
    },
    coverage: {
      relevantCount: 1,
      highCount: 1,
      mediumCount: 0,
      verifiedAnalyzedCount: 1,
      fallbackAnalysisCount: 0,
      failedAnalysisCount: 0,
      pendingCriticalCount: 0,
      pendingRelevantCount: 0
    },
    analyzedNowCount: 1,
    reusedVerifiedCount: 0,
    failures: [],
    ...overrides
  };
}

function buildCandles(count: number, end: Date): Candle[] {
  const start = new Date(end);
  start.setDate(start.getDate() - count + 1);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const base = 10 + index * 0.015;
    return {
      symbol: "600000.SH",
      open: Number((base - 0.03).toFixed(4)),
      high: Number((base + 0.1).toFixed(4)),
      low: Number((base - 0.1).toFixed(4)),
      close: Number(base.toFixed(4)),
      volume: 1_000_000 + index * 5_000,
      timestamp: date.toISOString()
    };
  });
}
