import type { FundamentalEvidence } from "@/lib/stock-data/types";
import { isPeerValuationFresh } from "@/lib/stock-data/peerValuationEvidence";

export type FundamentalCashFlowQualityStatus = "available" | "partial" | "not_meaningful" | "unavailable";

export type FundamentalCoverageSummary = {
  annualPeriodCount: number;
  standaloneQuarterCount: number;
  freeCashFlowTtmCny10k: number | null;
  operatingCashFlowToParentNetIncomeTtm: number | null;
  freeCashFlowToParentNetIncomeTtm: number | null;
  freeCashFlowMarginTtmPct: number | null;
  cashFlowQualityStatus: FundamentalCashFlowQualityStatus;
  adjustedNetIncomeStatus: "complete" | "partial" | "unavailable";
  adjustedNetIncomeAvailable: boolean;
  adjustedNetIncomeTtmCny10k: number | null;
  adjustedAnnualPeriodCount: number;
  adjustedStandaloneQuarterCount: number;
  adjustedNetIncomeSources: Array<{
    periodEnd: string;
    title: string;
    url: string;
    publishedAt: string;
    contentHash: string;
  }>;
  historicalValuationAvailable: boolean;
  historicalValuationStatus: "available" | "partial" | "unavailable";
  peerValuationAvailable: boolean;
  peerValuationStatus: "available" | "partial" | "unavailable" | "conflicted";
  peerValuationFresh: boolean;
  peerValuationAsOf: string | null;
  peerValuationIndustry: string | null;
  peerValuationSourceUrl: string | null;
  peerValuationClassificationSourceUrl: string | null;
  peerValuationContentHash: string | null;
  peerValuationMissingReason: string | null;
  peerValuationSampleSize: number;
  peerPeTtm: number | null;
  peerPeTtmMedian: number | null;
  peerPeTtmPercentile: number | null;
  peerPeTtmPremiumDiscountPct: number | null;
  peerPbMrq: number | null;
  peerPbMrqMedian: number | null;
  peerPbMrqPercentile: number | null;
  peerPbMrqPremiumDiscountPct: number | null;
  peerValuationComparables: Array<{
    symbol: string;
    name: string;
    peTtm: number | null;
    pbMrq: number | null;
  }>;
  peTtm: number | null;
  pb: number | null;
  historicalPercentile: number | null;
  historicalPePercentile: number | null;
  historicalPbPercentile: number | null;
  historicalPeSampleSize: number;
  historicalPbSampleSize: number;
  historicalValuationWindowStart: string | null;
  historicalValuationWindowEnd: string | null;
  historicalValuationPriceProvider: string | null;
  historicalValuationPriceSourceUrl: string | null;
  historicalValuationPriceSeriesHash: string | null;
  historicalValuationPriceSeriesFresh: boolean;
  historicalValuationMissingReason: string | null;
  historicalValuationReportSources: Array<{
    periodEnd: string;
    publishedAt: string;
    effectiveFrom: string;
    title: string;
    url: string;
  }>;
  missingFields: string[];
};

export function summarizeFundamentalCoverage(evidence?: FundamentalEvidence | null): FundamentalCoverageSummary {
  const revenueTtm = metricNumber(evidence, "revenueTtmCny10k");
  const parentNetIncomeTtm = metricNumber(evidence, "parentNetIncomeTtmCny10k");
  const operatingCashFlowTtm = metricNumber(evidence, "operatingCashFlowTtmCny10k");
  const freeCashFlowTtm = metricNumber(evidence, "freeCashFlowTtmCny10k");
  const operatingCashFlowToParentNetIncomeTtm = ratioToPositiveDenominator(operatingCashFlowTtm, parentNetIncomeTtm);
  const freeCashFlowToParentNetIncomeTtm = ratioToPositiveDenominator(freeCashFlowTtm, parentNetIncomeTtm);
  const freeCashFlowMarginTtmPct = ratioToPositiveDenominator(freeCashFlowTtm, revenueTtm, 100);
  const cashFlowInputs = [operatingCashFlowTtm, freeCashFlowTtm];
  const ratioOutputs = [operatingCashFlowToParentNetIncomeTtm, freeCashFlowToParentNetIncomeTtm, freeCashFlowMarginTtmPct];

  let cashFlowQualityStatus: FundamentalCashFlowQualityStatus = "unavailable";
  if (cashFlowInputs.some((value) => value !== null) && parentNetIncomeTtm !== null && parentNetIncomeTtm <= 0) {
    cashFlowQualityStatus = "not_meaningful";
  } else if (ratioOutputs.every((value) => value !== null)) {
    cashFlowQualityStatus = "available";
  } else if (cashFlowInputs.some((value) => value !== null) || parentNetIncomeTtm !== null || revenueTtm !== null) {
    cashFlowQualityStatus = "partial";
  }

  const adjustedNetIncomeTtmCny10k = metricNumber(evidence, "adjustedParentNetIncomeTtmCny10k");
  const adjustedAnnualPeriodCount = evidence?.annualPeriods.filter((period) => typeof period.adjustedParentNetIncome === "number").length ?? 0;
  const adjustedStandaloneQuarterCount = evidence?.quarterlyPeriods.filter((period) => typeof period.adjustedParentNetIncome === "number").length ?? 0;
  const adjustedNetIncomeStatus = adjustedAnnualPeriodCount >= 5 && adjustedStandaloneQuarterCount >= 8
    ? "complete"
    : adjustedAnnualPeriodCount || adjustedStandaloneQuarterCount || adjustedNetIncomeTtmCny10k !== null
      ? "partial"
      : "unavailable";
  const historicalEvidence = evidence?.valuation.historicalEvidence ?? null;
  const historicalValuationStatus = historicalEvidence?.status
    ?? (finiteNumber(evidence?.valuation.historicalPercentile) !== null ? "available" : "unavailable");
  const peerEvidence = evidence?.valuation.peerEvidence ?? null;
  const peerValuationStatus = peerEvidence?.status ?? "unavailable";
  const peerValuationFresh = isPeerValuationFresh(peerEvidence);
  const peerValuationSampleSize = Math.max(peerEvidence?.peComparison?.sampleSize ?? 0, peerEvidence?.pbComparison?.sampleSize ?? 0);
  return {
    annualPeriodCount: evidence?.annualPeriods.length ?? 0,
    standaloneQuarterCount: evidence?.quarterlyPeriods.length ?? 0,
    freeCashFlowTtmCny10k: freeCashFlowTtm,
    operatingCashFlowToParentNetIncomeTtm,
    freeCashFlowToParentNetIncomeTtm,
    freeCashFlowMarginTtmPct,
    cashFlowQualityStatus,
    adjustedNetIncomeStatus,
    adjustedNetIncomeAvailable: adjustedNetIncomeStatus === "complete",
    adjustedNetIncomeTtmCny10k,
    adjustedAnnualPeriodCount,
    adjustedStandaloneQuarterCount,
    adjustedNetIncomeSources: (evidence?.adjustedNetIncomeSources ?? []).map((source) => ({
      periodEnd: source.periodEnd,
      title: source.sourceTitle,
      url: source.sourceUrl,
      publishedAt: source.publishedAt,
      contentHash: source.contentHash
    })),
    historicalValuationAvailable: historicalValuationStatus === "available",
    historicalValuationStatus,
    peerValuationAvailable: peerValuationStatus === "available" && peerValuationFresh,
    peerValuationStatus,
    peerValuationFresh,
    peerValuationAsOf: peerEvidence?.fetchedAt ?? null,
    peerValuationIndustry: peerEvidence?.industryName ?? null,
    peerValuationSourceUrl: peerEvidence?.sourceUrl ?? null,
    peerValuationClassificationSourceUrl: peerEvidence?.classificationSourceUrl ?? null,
    peerValuationContentHash: peerEvidence?.contentHash ?? null,
    peerValuationMissingReason: peerEvidence?.missingReason ?? null,
    peerValuationSampleSize,
    peerPeTtm: finiteNumber(peerEvidence?.targetPeTtm),
    peerPeTtmMedian: finiteNumber(peerEvidence?.peComparison?.sampleMedian),
    peerPeTtmPercentile: finiteNumber(peerEvidence?.peComparison?.percentile),
    peerPeTtmPremiumDiscountPct: finiteNumber(peerEvidence?.peComparison?.premiumDiscountPct),
    peerPbMrq: finiteNumber(peerEvidence?.targetPbMrq),
    peerPbMrqMedian: finiteNumber(peerEvidence?.pbComparison?.sampleMedian),
    peerPbMrqPercentile: finiteNumber(peerEvidence?.pbComparison?.percentile),
    peerPbMrqPremiumDiscountPct: finiteNumber(peerEvidence?.pbComparison?.premiumDiscountPct),
    peerValuationComparables: (peerEvidence?.comparables ?? []).map((peer) => ({
      symbol: peer.symbol,
      name: peer.name,
      peTtm: peer.peTtm,
      pbMrq: peer.pbMrq
    })),
    peTtm: finiteNumber(evidence?.valuation.peTtm),
    pb: finiteNumber(evidence?.valuation.pb),
    historicalPercentile: finiteNumber(evidence?.valuation.historicalPercentile),
    historicalPePercentile: finiteNumber(historicalEvidence?.pePercentile),
    historicalPbPercentile: finiteNumber(historicalEvidence?.pbPercentile),
    historicalPeSampleSize: historicalEvidence?.peSampleSize ?? 0,
    historicalPbSampleSize: historicalEvidence?.pbSampleSize ?? 0,
    historicalValuationWindowStart: historicalEvidence?.windowStart ?? null,
    historicalValuationWindowEnd: historicalEvidence?.windowEnd ?? null,
    historicalValuationPriceProvider: historicalEvidence?.priceProvider ?? null,
    historicalValuationPriceSourceUrl: historicalEvidence?.priceSourceUrl ?? null,
    historicalValuationPriceSeriesHash: historicalEvidence?.priceSeriesHash ?? null,
    historicalValuationPriceSeriesFresh: historicalEvidence?.priceSeriesFresh ?? false,
    historicalValuationMissingReason: historicalEvidence?.missingReason ?? null,
    historicalValuationReportSources: (historicalEvidence?.reportSources ?? []).map((source) => ({
      periodEnd: source.periodEnd,
      publishedAt: source.publishedAt,
      effectiveFrom: source.effectiveFrom,
      title: source.title,
      url: source.url
    })),
    missingFields: [...new Set(evidence?.missingFields ?? ["fundamentalSource"])]
  };
}

function metricNumber(evidence: FundamentalEvidence | null | undefined, key: string) {
  return finiteNumber(evidence?.metrics[key]);
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function ratioToPositiveDenominator(numerator: number | null, denominator: number | null, multiplier = 1) {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return round((numerator / denominator) * multiplier);
}

function round(value: number, digits = 4) {
  return Number(value.toFixed(digits));
}
