import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { buildAnalysisTradePlan } from "@/lib/ai/analyzeStock";
import type { AnalyzeStockInput } from "@/lib/ai/stockAnalysisTypes";
import { createAnalysisContextHash } from "@/lib/analysis/contextHash";
import { buildAnalysisEvidencePackage, type AnalysisEvidencePackage } from "@/lib/analysis/evidence";
import { getStoredStockCompanyEvidence } from "@/lib/analysis/prepareCompanyEvidence";
import { findReusableAnalysisByContextHash } from "@/lib/analysis/reusableAnalysis";
import { disconnectRedisClient } from "@/lib/cache/redis";
import { getMemoryContent, updateMemory } from "@/lib/memory";
import { parseNewsEventContext } from "@/lib/news/eventTimeline";
import { loadStoredIndustryClassifications } from "@/lib/news/industryClassification";
import { getStoredStockNewsEvidenceRefresh, type StockNewsEvidenceRefresh } from "@/lib/news/prepareStockNewsEvidence";
import { saveNewsAnalysis } from "@/lib/news/store";
import { prisma } from "@/lib/prisma";
import type { DisclosureEvidence, FundamentalEvidence } from "@/lib/stock-data/types";
import type { Candle, IndicatorSnapshot, NewsAnalysisResult, Quote } from "@/lib/types";
import { buildPortfolioRiskBudget } from "@/lib/trading/riskBudget";

const runDbTests = process.env.RUN_DB_E2E_TESTS === "true";
const now = new Date("2026-08-25T00:30:00+08:00");
const symbol = "600000.SH";
const candles = buildCandles(130, new Date("2026-08-24T15:00:00+08:00"));
const quote: Quote = {
  symbol,
  name: "数据库固定样本银行",
  currency: "CNY",
  price: 12,
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
  symbol,
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
  timestamp: quote.timestamp
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

test.after(async () => {
  disconnectRedisClient();
  await prisma.$disconnect();
});

test("persisted analysis reuse is isolated by user and invalidated by memory context", {
  skip: !runDbTests
}, async () => {
  const users = await createTestUsers("reuse");
  try {
    await updateMemory(users.first.id, "偏好低回撤，单笔风险不超过总资产 1%。");
    const evidence = completeEvidence();
    const initialMemory = await getMemoryContent(users.first.id);
    const initialHash = contextHash(evidence, initialMemory);
    const trusted = await prisma.aiAnalysis.create({
      data: {
        userId: users.first.id,
        symbol,
        inputJson: { contextHash: initialHash },
        outputJson: { decisionStatus: "setup_wait", isFallback: false }
      }
    });
    const otherUsersTrusted = await prisma.aiAnalysis.create({
      data: {
        userId: users.second.id,
        symbol,
        inputJson: { contextHash: initialHash },
        outputJson: { decisionStatus: "research_candidate", isFallback: false }
      }
    });

    assert.equal((await findReusableAnalysisByContextHash(users.first.id, "600000", initialHash))?.id, trusted.id);
    assert.equal((await findReusableAnalysisByContextHash(users.second.id, symbol, initialHash))?.id, otherUsersTrusted.id);

    await updateMemory(users.first.id, "只允许长期持有，不能接受超过 3% 的回撤。");
    const changedHash = contextHash(evidence, await getMemoryContent(users.first.id));
    assert.notEqual(changedHash, initialHash);
    assert.equal(await findReusableAnalysisByContextHash(users.first.id, symbol, changedHash), null);

    await prisma.aiAnalysis.create({
      data: {
        userId: users.first.id,
        symbol,
        inputJson: { contextHash: changedHash },
        outputJson: { decisionStatus: "insufficient_data", isFallback: true }
      }
    });
    assert.equal(await findReusableAnalysisByContextHash(users.first.id, symbol, changedHash), null);
  } finally {
    await cleanupUsers(users.ids);
  }
});

test("persisted incomplete evidence stays user-scoped and blocks conditional entry", {
  skip: !runDbTests
}, async () => {
  const users = await createTestUsers("evidence");
  const fundamentals = unavailableFundamentals();
  const disclosures = unreadCriticalDisclosure();
  const news = exhaustedNewsReceipt();
  try {
    await prisma.stockEvidenceState.create({
      data: {
        userId: users.first.id,
        symbol,
        newsRefreshAt: new Date(news.completedAt),
        newsRefreshJson: toJson(news),
        fundamentalsRefreshAt: new Date(fundamentals.fetchedAt),
        fundamentalsJson: toJson(fundamentals),
        disclosuresRefreshAt: new Date(disclosures.checkedAt!),
        disclosuresJson: toJson(disclosures)
      }
    });

    const storedNews = await getStoredStockNewsEvidenceRefresh(users.first.id, "600000");
    const storedCompany = await getStoredStockCompanyEvidence(users.first.id, "600000");
    assert.ok(storedNews);
    assert.ok(storedCompany);
    assert.equal(await getStoredStockNewsEvidenceRefresh(users.second.id, symbol), null);
    assert.equal(await getStoredStockCompanyEvidence(users.second.id, symbol), null);

    const evidence = buildAnalysisEvidencePackage({
      symbol,
      quote,
      quoteStatus: "normal",
      quoteSource: "db-e2e-fixture",
      history: candles,
      indicators,
      userContext: { isHolding: false, timeHorizon: "swing_trade" },
      userCapital: 100_000,
      portfolioRiskContext,
      relevantNews: [{ importance: "high", analyses: [] }],
      analyzedNews: [],
      lastNewsFetch: storedNews!.completedAt,
      newsEvidenceRefresh: storedNews,
      fundamentals: storedCompany!.fundamentals,
      disclosures: storedCompany!.disclosures,
      now
    });
    assert.equal(evidence.dataQuality.status, "insufficient");
    assert.equal(evidence.dataQuality.newsQuotaStatus, "quota_exhausted");
    assert.equal(evidence.dataQuality.fundamentalsAvailable, false);
    assert.equal(evidence.dataQuality.criticalDisclosuresRead, false);
    assert.ok(evidence.dataQuality.missingFields.includes("fundamentals"));
    assert.ok(evidence.dataQuality.missingFields.includes("criticalDisclosureContent"));
    assert.ok(evidence.dataQuality.entryBlockers.some((item) => item.includes("新闻检索额度已用尽")));
    assert.ok(evidence.dataQuality.entryBlockers.some((item) => item.includes("基本面风险过滤")));
    assert.ok(evidence.dataQuality.entryBlockers.some((item) => item.includes("关键公告仅有元数据")));

    const plan = buildAnalysisTradePlan(analysisCandidate(), analysisInput(evidence));
    assert.equal(plan.entry.status, "blocked");
    assert.equal(plan.entry.action, "avoid");
    assert.ok(plan.entry.constraints.some((item) => item.includes("证据硬门控")));
    assert.ok(candles.every((item) => Date.parse(item.timestamp) <= now.getTime()));
  } finally {
    await cleanupUsers(users.ids);
  }
});

test("persisted industry classification is fresh and user scoped", {
  skip: !runDbTests
}, async () => {
  const users = await createTestUsers("industry-classification");
  const fundamentals = availableFundamentals();
  fundamentals.valuation.peerEvidence = peerIndustryEvidence();
  try {
    await prisma.stockEvidenceState.create({
      data: {
        userId: users.first.id,
        symbol,
        fundamentalsRefreshAt: new Date(fundamentals.fetchedAt),
        fundamentalsJson: toJson(fundamentals)
      }
    });

    const first = await loadStoredIndustryClassifications({ userId: users.first.id, symbols: ["600000"], asOf: now });
    const second = await loadStoredIndustryClassifications({ userId: users.second.id, symbols: [symbol], asOf: now });
    assert.equal(first.get("600000")?.status, "verified");
    assert.equal(first.get("600000")?.industryName, "银行");
    assert.equal(second.get(symbol)?.status, "missing");
  } finally {
    await cleanupUsers(users.ids);
  }
});

test("structured news expectation evidence persists through the database migration", {
  skip: !runDbTests
}, async () => {
  const unique = randomUUID();
  const item = await prisma.newsItem.create({
    data: {
      title: `数据库新闻事件固定样本 ${unique}`,
      titleHash: unique.replaceAll("-", ""),
      url: `https://example.test/news/${unique}`,
      source: "数据库固定样本",
      publishedAt: new Date("2026-08-20T08:00:00.000Z"),
      rawContent: "市场此前一致预期收入增长10%，公司公告实际收入增长20%。",
      summary: null,
      symbols: [symbol],
      sectors: ["银行"],
      sentiment: null,
      importance: "high"
    }
  });
  const analysis: NewsAnalysisResult = {
    summary: "公司实际收入增长高于原文给出的事前预期。",
    sentiment: "positive",
    impactLevel: "high",
    affectedSymbols: [symbol],
    affectedSectors: ["银行"],
    riskNotes: ["仍需正式财报验证"],
    whyItMatters: "该事件具备可追溯的事前预期和实际结果。",
    confidence: 0.8,
    eventContext: {
      schemaVersion: "news-event-context-v1",
      eventOccurredAt: "2026-08-20T07:30:00.000Z",
      informationStage: "first_report",
      originalSource: { status: "current_source", name: "数据库固定样本", url: item.url },
      expectation: {
        status: "explicit",
        baseline: "市场一致预期收入增长10%",
        actual: "实际收入增长20%",
        gapDirection: "positive",
        evidence: "市场此前一致预期收入增长10%，公司公告实际收入增长20%。"
      },
      expectedImpactHorizon: "quarters",
      falsifiers: ["正式财报不支持当前数据"]
    },
    isFallback: false,
    fallbackReason: null
  };

  try {
    const saved = await saveNewsAnalysis(item.id, analysis);
    const reloaded = await prisma.newsAnalysis.findUnique({ where: { id: saved.id } });
    assert.deepEqual(parseNewsEventContext(reloaded?.eventContextJson), analysis.eventContext);
  } finally {
    await prisma.newsItem.delete({ where: { id: item.id } });
  }
});

function completeEvidence() {
  return buildAnalysisEvidencePackage({
    symbol,
    quote,
    quoteStatus: "normal",
    quoteSource: "db-e2e-fixture",
    history: candles,
    indicators,
    userContext: { isHolding: false, timeHorizon: "swing_trade" },
    userCapital: 100_000,
    portfolioRiskContext,
    relevantNews: [{ importance: "high", analyses: [{ aiSummary: "已完成可信精读", isFallback: false }] }],
    analyzedNews: [{ id: "news-fixture", title: "数据库固定样本新闻" }],
    lastNewsFetch: "2026-08-24T23:30:00+08:00",
    newsRefreshCompleted: true,
    fundamentals: availableFundamentals(),
    disclosures: checkedDisclosures(),
    now
  });
}

function contextHash(evidence: AnalysisEvidencePackage, memory: string) {
  return createAnalysisContextHash({
    symbol,
    quote,
    indicators,
    importantNewsIds: ["news-fixture"],
    evidence,
    userCapital: 100_000,
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

function analysisInput(evidence: AnalysisEvidencePackage): AnalyzeStockInput {
  return {
    symbol,
    quote,
    indicators,
    historySummary: {},
    userContext: { isHolding: false, targetPrice: 14, stopLoss: 11, timeHorizon: "swing_trade" },
    userCapital: 100_000,
    portfolioRiskContext,
    evidencePackage: evidence
  };
}

function analysisCandidate() {
  return {
    trend: "bullish" as const,
    confidence: 0.7,
    keyLevels: { support: [11], resistance: [14] },
    holdAdvice: null,
    entryAdvice: {
      action: "条件入场",
      reason: "量价确认后小仓执行。",
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

function availableFundamentals(): FundamentalEvidence {
  return {
    schemaVersion: "fundamental-evidence-v2",
    status: "available",
    provider: "db-e2e-fixture",
    sourceUrl: "https://example.test/fundamentals",
    fetchedAt: "2026-08-24T23:32:00+08:00",
    reportPeriod: "2026-06-30",
    annualPeriods: [],
    quarterlyPeriods: [],
    adjustedNetIncomeSources: [],
    valuation: {
      asOf: quote.timestamp,
      price: quote.price,
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
  };
}

function peerIndustryEvidence(): NonNullable<FundamentalEvidence["valuation"]["peerEvidence"]> {
  return {
    schemaVersion: "peer-valuation-v1",
    algorithmVersion: "eastmoney-provider-ranked-positive-multiples-v1",
    status: "partial",
    provider: "EASTMONEY",
    sourceUrl: "https://datacenter-web.eastmoney.com/api/data/v1/get",
    classificationSourceUrl: "https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/PageAjax?code=SH600000",
    fetchedAt: "2026-08-24T23:32:00+08:00",
    maximumAgeHours: 24,
    industryName: "银行",
    classificationMethod: "EASTMONEY_EM2016",
    selectionMethod: "EASTMONEY_INDUSTRY_COMPARABLE_RANK",
    peBasis: "PE_TTM",
    pbBasis: "PB_MRQ",
    minimumSampleSize: 5,
    targetSymbol: symbol,
    targetName: quote.name ?? null,
    targetPeTtm: 10,
    targetPbMrq: 2,
    financialReportPeriod: "2026-06-30",
    peComparison: null,
    pbComparison: null,
    comparables: [],
    crossCheck: {
      maximumDifferencePct: 15,
      peDifferencePct: 0,
      pbDifferencePct: 0,
      peMatched: true,
      pbMatched: true
    },
    contentHash: "a".repeat(64),
    missingReason: "固定样本只验证行业分类复用。"
  };
}

function unavailableFundamentals(): FundamentalEvidence {
  return {
    ...availableFundamentals(),
    status: "unavailable",
    sourceUrl: "",
    reportPeriod: null,
    annualPeriods: [],
    quarterlyPeriods: [],
    valuation: {
      asOf: null,
      price: null,
      epsTtm: null,
      peTtm: null,
      bookValuePerShare: null,
      pb: null,
      historicalPercentile: null
    },
    metrics: {},
    missingFields: ["fundamentalSource"],
    failures: ["固定样本模拟基本面来源不可用"],
    missingReason: "固定样本模拟基本面来源不可用"
  };
}

function checkedDisclosures(): DisclosureEvidence {
  return {
    schemaVersion: "disclosure-evidence-v2",
    status: "checked",
    provider: "db-e2e-fixture",
    queryUrl: "https://example.test/disclosures",
    checkedAt: "2026-08-24T23:35:00+08:00",
    windowFrom: "2026-02-25",
    windowTo: "2026-08-24",
    latestPublishedAt: "2026-08-20T18:00:00+08:00",
    totalCount: 1,
    criticalUnreadCount: 0,
    items: [{
      id: "notice-fixture",
      symbol,
      companyName: quote.name ?? null,
      title: "半年度报告",
      publishedAt: "2026-08-20T18:00:00+08:00",
      category: "periodic_report",
      source: "db-e2e-fixture",
      sourceUrl: "https://example.test/disclosures/notice-fixture",
      contentStatus: "analyzed",
      contentHash: "db-e2e-fixture-hash",
      contentExcerpt: "公告原文已提取。",
      extractedCharacters: 8,
      extractionFailure: null,
      isCritical: true,
      isFundamentalSource: true,
      adjustedNetIncomeFact: null
    }],
    failures: []
  };
}

function unreadCriticalDisclosure(): DisclosureEvidence {
  const disclosures = checkedDisclosures();
  return {
    ...disclosures,
    criticalUnreadCount: 1,
    items: disclosures.items.map((item) => ({
      ...item,
      contentStatus: "metadata_only" as const,
      contentHash: null,
      contentExcerpt: null,
      extractedCharacters: 0,
      extractionFailure: "固定样本模拟公告原文不可读"
    }))
  };
}

function exhaustedNewsReceipt(): StockNewsEvidenceRefresh {
  return {
    schemaVersion: "news-evidence-refresh-v4",
    symbol,
    startedAt: "2026-08-24T23:20:00+08:00",
    completedAt: "2026-08-24T23:30:00+08:00",
    refreshCompleted: false,
    deadlineExceeded: false,
    fetch: {
      schemaVersion: "news-fetch-v4",
      symbol,
      completed: false,
      fetched: 0,
      saved: 0,
      filteredOut: 0,
      queuedAnalysis: 0,
      webSearchUsed: false,
      companySearchCompleted: false,
      topicSearchCompleted: false,
      quotaStatus: "quota_exhausted",
      quotaEvents: [{
        provider: "tianapi",
        apiName: "news",
        status: "quota_exhausted",
        requestKind: "company",
        message: "固定样本模拟额度耗尽"
      }],
      cacheHitCount: 0,
      tianapiCalls: 0,
      tavilyCalls: 0,
      sharedTopicKey: "sector-topic-v1:banking",
      sharedTopicSource: "alias_map_v1",
      sharedTopicReused: false,
      industryClassification: {
        schemaVersion: "news-industry-classification-v1",
        status: "missing",
        symbol,
        industryName: null,
        provider: null,
        classificationMethod: null,
        classificationSourceUrl: null,
        fetchedAt: null,
        validUntil: null,
        maximumAgeHours: 24,
        sourceEvidenceHash: null,
        evidenceHash: null,
        missingReason: "固定样本模拟行业分类缺失"
      },
      skippedQueryCount: 1,
      sourceProviders: [],
      failures: ["固定样本模拟额度耗尽"]
    },
    coverage: {
      relevantCount: 1,
      highCount: 1,
      mediumCount: 0,
      verifiedAnalyzedCount: 0,
      fallbackAnalysisCount: 0,
      failedAnalysisCount: 0,
      pendingCriticalCount: 1,
      pendingRelevantCount: 1
    },
    analyzedNowCount: 0,
    reusedVerifiedCount: 0,
    failures: ["固定样本模拟额度耗尽"]
  };
}

function buildCandles(count: number, end: Date): Candle[] {
  const start = new Date(end);
  start.setDate(start.getDate() - count + 1);
  return Array.from({ length: count }, (_, index) => {
    const timestamp = new Date(start);
    timestamp.setDate(start.getDate() + index);
    const base = 10 + index * 0.015;
    return {
      symbol,
      open: Number((base - 0.03).toFixed(4)),
      high: Number((base + 0.1).toFixed(4)),
      low: Number((base - 0.1).toFixed(4)),
      close: Number(base.toFixed(4)),
      volume: 1_000_000 + index * 5_000,
      timestamp: timestamp.toISOString()
    };
  });
}

async function createTestUsers(label: string) {
  const suffix = `${Date.now()}-${randomUUID()}`;
  const [first, second] = await Promise.all([
    prisma.user.create({ data: { email: `${label}-first-${suffix}@db-e2e.invalid` } }),
    prisma.user.create({ data: { email: `${label}-second-${suffix}@db-e2e.invalid` } })
  ]);
  return { first, second, ids: [first.id, second.id] };
}

async function cleanupUsers(ids: string[]) {
  await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch(() => null);
}

function toJson(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}
