import type { FundamentalEvidence } from "@/lib/stock-data/types";

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
  peerValuationAvailable: boolean;
  peTtm: number | null;
  pb: number | null;
  historicalPercentile: number | null;
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

  const peerSampleSize = metricNumber(evidence, "peerValuationSampleSize");
  const adjustedNetIncomeTtmCny10k = metricNumber(evidence, "adjustedParentNetIncomeTtmCny10k");
  const adjustedAnnualPeriodCount = evidence?.annualPeriods.filter((period) => typeof period.adjustedParentNetIncome === "number").length ?? 0;
  const adjustedStandaloneQuarterCount = evidence?.quarterlyPeriods.filter((period) => typeof period.adjustedParentNetIncome === "number").length ?? 0;
  const adjustedNetIncomeStatus = adjustedAnnualPeriodCount >= 5 && adjustedStandaloneQuarterCount >= 8
    ? "complete"
    : adjustedAnnualPeriodCount || adjustedStandaloneQuarterCount || adjustedNetIncomeTtmCny10k !== null
      ? "partial"
      : "unavailable";
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
    historicalValuationAvailable: finiteNumber(evidence?.valuation.historicalPercentile) !== null,
    peerValuationAvailable: peerSampleSize !== null && peerSampleSize > 0,
    peTtm: finiteNumber(evidence?.valuation.peTtm),
    pb: finiteNumber(evidence?.valuation.pb),
    historicalPercentile: finiteNumber(evidence?.valuation.historicalPercentile),
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
