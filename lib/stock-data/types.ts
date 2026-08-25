import type { Candle, CompanyProfile, NewsItem, Quote } from "@/lib/types";

export type HistoryOptions = {
  forceRefresh?: boolean;
  adjustment?: "forward" | "none";
};

export type ValuationPriceHistoryEvidence = {
  schemaVersion: "valuation-price-history-v1";
  status: "available" | "unavailable";
  provider: string;
  sourceUrl: string;
  fetchedAt: string;
  adjustment: "none";
  candles: Candle[];
  failure: string | null;
};

export type HistoricalValuationReportSource = {
  periodEnd: string;
  publishedAt: string;
  effectiveFrom: string;
  epsTtm: number | null;
  bookValuePerShare: number | null;
  disclosureId: string;
  title: string;
  url: string;
};

export type HistoricalValuationEvidence = {
  schemaVersion: "historical-valuation-v1";
  algorithmVersion: "publication-gated-current-series-v1";
  status: "available" | "partial" | "unavailable";
  asOf: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  priceProvider: string;
  priceSourceUrl: string;
  priceAdjustment: "none";
  priceSeriesHash: string | null;
  priceSeriesFresh: boolean;
  priceStalenessDays: number | null;
  reportSourceCount: number;
  minimumTradingDays: number;
  peSampleSize: number;
  pbSampleSize: number;
  pePercentile: number | null;
  pbPercentile: number | null;
  compositePercentile: number | null;
  reportSources: HistoricalValuationReportSource[];
  missingReason: string | null;
};

export type FinancialPeriodEvidence = {
  periodEnd: string;
  periodType: "quarter" | "annual";
  currency: "CNY";
  unit: "CNY_10K";
  revenue: number | null;
  parentNetIncome: number | null;
  adjustedParentNetIncome: number | null;
  operatingCashFlow: number | null;
  capitalExpenditure: number | null;
  freeCashFlow: number | null;
  eps: number | null;
  bookValuePerShare: number | null;
  roePct: number | null;
  debtToAssetsPct: number | null;
  grossMarginPct: number | null;
  netMarginPct: number | null;
  revenueGrowthPct: number | null;
  netIncomeGrowthPct: number | null;
};

export type AdjustedNetIncomeDisclosureFact = {
  schemaVersion: "adjusted-net-income-fact-v1";
  parserVersion: "cninfo-periodic-table-v1";
  periodEnd: string;
  periodKind: "q1" | "half_year" | "q3" | "annual";
  currency: "CNY";
  sourceUnit: "CNY" | "CNY_1K" | "CNY_10K" | "CNY_1M";
  cumulativeValueCny10k: number;
  priorComparableValueCny10k: number | null;
  reportedParentNetIncomeCny10k: number;
  rawCurrentValue: string;
  rawPriorComparableValue: string | null;
};

export type AdjustedNetIncomeSource = AdjustedNetIncomeDisclosureFact & {
  sourceDisclosureId: string;
  sourceTitle: string;
  sourceUrl: string;
  publishedAt: string;
  contentHash: string;
};

export type FundamentalEvidence = {
  schemaVersion: "fundamental-evidence-v2";
  status: "available" | "partial" | "unavailable";
  provider: string;
  sourceUrl: string;
  fetchedAt: string;
  reportPeriod: string | null;
  annualPeriods: FinancialPeriodEvidence[];
  quarterlyPeriods: FinancialPeriodEvidence[];
  adjustedNetIncomeSources: AdjustedNetIncomeSource[];
  valuation: {
    asOf: string | null;
    price: number | null;
    epsTtm: number | null;
    peTtm: number | null;
    bookValuePerShare: number | null;
    pb: number | null;
    historicalPercentile: number | null;
    historicalEvidence?: HistoricalValuationEvidence | null;
  };
  metrics: Record<string, number | string | null>;
  missingFields: string[];
  conflictingFields: string[];
  failures: string[];
  missingReason: string | null;
};

export type DisclosureEvidenceItem = {
  id: string;
  symbol: string;
  companyName: string | null;
  title: string;
  publishedAt: string;
  category: "periodic_report" | "earnings" | "regulatory" | "litigation" | "capital_action" | "major_contract" | "risk_notice" | "other";
  source: string;
  sourceUrl: string;
  contentStatus: "metadata_only" | "extracted" | "analyzed";
  contentHash: string | null;
  contentExcerpt: string | null;
  extractedCharacters: number;
  extractionFailure: string | null;
  isCritical: boolean;
  isFundamentalSource: boolean;
  adjustedNetIncomeFact: AdjustedNetIncomeDisclosureFact | null;
};

export type DisclosureEvidence = {
  schemaVersion: "disclosure-evidence-v2";
  status: "checked" | "partial" | "unchecked";
  provider: string;
  queryUrl: string;
  checkedAt: string | null;
  windowFrom: string | null;
  windowTo: string | null;
  latestPublishedAt: string | null;
  totalCount: number;
  criticalUnreadCount: number;
  items: DisclosureEvidenceItem[];
  failures: string[];
};

export type CompanyEvidenceOptions = {
  forceRefresh?: boolean;
  price?: number | null;
  priceAsOf?: string | null;
};

export interface StockDataProvider {
  getQuote(symbol: string): Promise<Quote>;
  getHistory(symbol: string, range: string, interval: string, options?: HistoryOptions): Promise<Candle[]>;
  getValuationPriceHistory?(symbol: string, options?: HistoryOptions): Promise<ValuationPriceHistoryEvidence>;
  getCompanyProfile?(symbol: string): Promise<CompanyProfile>;
  getFundamentals?(symbol: string, options?: CompanyEvidenceOptions): Promise<FundamentalEvidence>;
  getDisclosures?(symbol: string, options?: CompanyEvidenceOptions): Promise<DisclosureEvidence>;
  getNews?(symbol: string): Promise<NewsItem[]>;
}

export type { Candle, CompanyProfile, NewsItem, Quote };
