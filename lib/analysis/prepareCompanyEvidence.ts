import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getStockDataProvider } from "@/lib/stock-data";
import { mergeAdjustedNetIncomeEvidence } from "@/lib/stock-data/adjustedNetIncomeEvidence";
import { enrichDisclosureContent } from "@/lib/stock-data/disclosureContent";
import { mergeHistoricalValuationEvidence } from "@/lib/stock-data/historicalValuationEvidence";
import { mergePeerValuationEvidence } from "@/lib/stock-data/peerValuationEvidence";
import { stockSymbolVariants } from "@/lib/symbols";
import type { DisclosureEvidence, FundamentalEvidence, PeerValuationEvidence, Quote, ValuationPriceHistoryEvidence } from "@/lib/stock-data/types";

export type StockCompanyEvidenceRefresh = {
  schemaVersion: "company-evidence-refresh-v2";
  symbol: string;
  startedAt: string;
  completedAt: string;
  fundamentals: FundamentalEvidence;
  disclosures: DisclosureEvidence;
  failures: string[];
};

export async function prepareStockCompanyEvidence(input: {
  userId: string;
  symbol: string;
  quote: Quote;
  forceRefresh?: boolean;
}): Promise<StockCompanyEvidenceRefresh> {
  const provider = getStockDataProvider();
  const startedAt = new Date().toISOString();
  const previous = await getStoredStockCompanyEvidence(input.userId, input.symbol).catch(() => null);
  const options = {
    forceRefresh: input.forceRefresh,
    price: input.quote.price,
    priceAsOf: input.quote.timestamp
  };
  const [rawFundamentals, rawDisclosures, valuationPriceHistory, peerValuation] = await Promise.all([
    provider.getFundamentals
      ? provider.getFundamentals(input.symbol, options).catch((error) => unavailableFundamentals(errorMessage(error)))
      : Promise.resolve(unavailableFundamentals("当前股票数据提供器未实现财务与估值证据接口。")),
    provider.getDisclosures
      ? provider.getDisclosures(input.symbol, options).catch((error) => uncheckedDisclosures(errorMessage(error)))
      : Promise.resolve(uncheckedDisclosures("当前股票数据提供器未实现法定公告证据接口。")),
    provider.getValuationPriceHistory
      ? provider.getValuationPriceHistory(input.symbol, { forceRefresh: input.forceRefresh, adjustment: "none" })
          .catch((error) => unavailableValuationPriceHistory(errorMessage(error)))
      : Promise.resolve(unavailableValuationPriceHistory("当前股票数据提供器未实现未复权历史估值价格接口。")),
    provider.getPeerValuation
      ? provider.getPeerValuation(input.symbol, { forceRefresh: input.forceRefresh })
          .catch((error) => unavailablePeerValuation(input.symbol, errorMessage(error)))
      : Promise.resolve(unavailablePeerValuation(input.symbol, "当前股票数据提供器未实现同行估值证据接口。"))
  ]);
  const disclosures = await enrichDisclosureContent(rawDisclosures, previous?.disclosures).catch((error) => ({
    ...rawDisclosures,
    failures: uniqueStrings([...rawDisclosures.failures, `公告原文提取流程失败：${errorMessage(error)}`])
  }));
  const fundamentals = mergePeerValuationEvidence(
    mergeHistoricalValuationEvidence(
      mergeAdjustedNetIncomeEvidence(rawFundamentals, disclosures),
      disclosures,
      valuationPriceHistory
    ),
    peerValuation
  );
  const receipt: StockCompanyEvidenceRefresh = {
    schemaVersion: "company-evidence-refresh-v2",
    symbol: input.symbol.toUpperCase(),
    startedAt,
    completedAt: new Date().toISOString(),
    fundamentals,
    disclosures,
    failures: uniqueStrings([...fundamentals.failures, ...disclosures.failures])
  };

  try {
    await prisma.stockEvidenceState.upsert({
      where: { userId_symbol: { userId: input.userId, symbol: receipt.symbol } },
      update: {
        fundamentalsRefreshAt: new Date(fundamentals.fetchedAt),
        fundamentalsJson: toJson(fundamentals),
        disclosuresRefreshAt: disclosures.checkedAt ? new Date(disclosures.checkedAt) : new Date(receipt.completedAt),
        disclosuresJson: toJson(disclosures)
      },
      create: {
        userId: input.userId,
        symbol: receipt.symbol,
        fundamentalsRefreshAt: new Date(fundamentals.fetchedAt),
        fundamentalsJson: toJson(fundamentals),
        disclosuresRefreshAt: disclosures.checkedAt ? new Date(disclosures.checkedAt) : new Date(receipt.completedAt),
        disclosuresJson: toJson(disclosures)
      }
    });
  } catch (error) {
    receipt.failures = uniqueStrings([...receipt.failures, `公司证据状态保存失败：${errorMessage(error)}`]);
  }

  return receipt;
}

export async function getStoredStockCompanyEvidence(userId: string, symbol: string): Promise<StockCompanyEvidenceRefresh | null> {
  const row = await prisma.stockEvidenceState.findFirst({
    where: { userId, symbol: { in: stockSymbolVariants(symbol) } },
    orderBy: { updatedAt: "desc" }
  });
  const fundamentals = parseFundamentals(row?.fundamentalsJson);
  const disclosures = parseDisclosures(row?.disclosuresJson);
  if (!fundamentals || !disclosures) return null;
  const startedAt = [fundamentals.fetchedAt, disclosures.checkedAt].filter((value): value is string => Boolean(value)).sort()[0]
    ?? row?.updatedAt.toISOString()
    ?? new Date(0).toISOString();
  return {
    schemaVersion: "company-evidence-refresh-v2",
    symbol: row?.symbol ?? symbol.toUpperCase(),
    startedAt,
    completedAt: row?.updatedAt.toISOString() ?? startedAt,
    fundamentals,
    disclosures,
    failures: uniqueStrings([...fundamentals.failures, ...disclosures.failures])
  };
}

function parseFundamentals(value: unknown): FundamentalEvidence | null {
  if (!isRecord(value) || !["fundamental-evidence-v1", "fundamental-evidence-v2"].includes(String(value.schemaVersion))) return null;
  if (!Array.isArray(value.annualPeriods) || !Array.isArray(value.quarterlyPeriods) || !isRecord(value.valuation)) return null;
  const parsed = value as unknown as FundamentalEvidence;
  return {
    ...parsed,
    schemaVersion: "fundamental-evidence-v2",
    annualPeriods: parsed.annualPeriods.map((period) => ({ ...period, adjustedParentNetIncome: period.adjustedParentNetIncome ?? null })),
    quarterlyPeriods: parsed.quarterlyPeriods.map((period) => ({ ...period, adjustedParentNetIncome: period.adjustedParentNetIncome ?? null })),
    adjustedNetIncomeSources: Array.isArray(parsed.adjustedNetIncomeSources) ? parsed.adjustedNetIncomeSources : [],
    valuation: {
      ...parsed.valuation,
      historicalEvidence: parsed.valuation.historicalEvidence ?? null,
      peerEvidence: parsed.valuation.peerEvidence ?? null
    }
  };
}

function parseDisclosures(value: unknown): DisclosureEvidence | null {
  if (!isRecord(value) || !["disclosure-evidence-v1", "disclosure-evidence-v2"].includes(String(value.schemaVersion)) || !Array.isArray(value.items)) return null;
  const parsed = value as unknown as DisclosureEvidence;
  return {
    ...parsed,
    schemaVersion: "disclosure-evidence-v2",
    items: parsed.items.map((item) => ({
      ...item,
      isFundamentalSource: item.isFundamentalSource ?? false,
      adjustedNetIncomeFact: item.adjustedNetIncomeFact ?? null
    }))
  };
}

function unavailableFundamentals(reason: string): FundamentalEvidence {
  return {
    schemaVersion: "fundamental-evidence-v2",
    status: "unavailable",
    provider: "not_configured",
    sourceUrl: "",
    fetchedAt: new Date().toISOString(),
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
    missingFields: ["fundamentalSource"],
    conflictingFields: [],
    failures: [reason],
    missingReason: reason
  };
}

function unavailableValuationPriceHistory(reason: string): ValuationPriceHistoryEvidence {
  return {
    schemaVersion: "valuation-price-history-v1",
    status: "unavailable",
    provider: "not_configured",
    sourceUrl: "",
    fetchedAt: new Date().toISOString(),
    adjustment: "none",
    candles: [],
    failure: reason
  };
}

function unavailablePeerValuation(symbol: string, reason: string): PeerValuationEvidence {
  const raw = symbol.trim().toUpperCase();
  const compact = raw.replace(/^SH|^SZ|^BJ/, "").replace(/\.(SH|SZ|BJ)$/, "");
  const exchange = raw.match(/^(SH|SZ|BJ)/)?.[1] ?? raw.match(/\.(SH|SZ|BJ)$/)?.[1] ?? (/^(5|6|9)/.test(compact) ? "SH" : "SZ");
  const targetSymbol = /^\d{6}$/.test(compact) ? `${compact}.${exchange}` : raw;
  const f10Code = /^\d{6}$/.test(compact) ? `${exchange}${compact}` : raw;
  return {
    schemaVersion: "peer-valuation-v1",
    algorithmVersion: "eastmoney-provider-ranked-positive-multiples-v1",
    status: "unavailable",
    provider: "EASTMONEY",
    sourceUrl: `https://emweb.securities.eastmoney.com/PC_HSF10/IndustryAnalysis/PageAjax?code=${encodeURIComponent(f10Code)}`,
    classificationSourceUrl: `https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/PageAjax?code=${encodeURIComponent(f10Code)}`,
    fetchedAt: new Date().toISOString(),
    maximumAgeHours: 24,
    industryName: null,
    classificationMethod: "EASTMONEY_EM2016",
    selectionMethod: "EASTMONEY_INDUSTRY_COMPARABLE_RANK",
    peBasis: "PE_TTM",
    pbBasis: "PB_MRQ",
    minimumSampleSize: 5,
    targetSymbol,
    targetName: null,
    targetPeTtm: null,
    targetPbMrq: null,
    financialReportPeriod: null,
    peComparison: null,
    pbComparison: null,
    comparables: [],
    crossCheck: {
      maximumDifferencePct: 15,
      peDifferencePct: null,
      pbDifferencePct: null,
      peMatched: null,
      pbMatched: null
    },
    contentHash: null,
    missingReason: reason
  };
}

function uncheckedDisclosures(reason: string): DisclosureEvidence {
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
    failures: [reason]
  };
}

function toJson(value: FundamentalEvidence | DisclosureEvidence) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
