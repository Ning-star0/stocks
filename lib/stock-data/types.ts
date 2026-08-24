import type { Candle, CompanyProfile, NewsItem, Quote } from "@/lib/types";

export type HistoryOptions = {
  forceRefresh?: boolean;
};

export type FinancialPeriodEvidence = {
  periodEnd: string;
  periodType: "quarter" | "annual";
  currency: "CNY";
  unit: "CNY_10K";
  revenue: number | null;
  parentNetIncome: number | null;
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

export type FundamentalEvidence = {
  schemaVersion: "fundamental-evidence-v1";
  status: "available" | "partial" | "unavailable";
  provider: string;
  sourceUrl: string;
  fetchedAt: string;
  reportPeriod: string | null;
  annualPeriods: FinancialPeriodEvidence[];
  quarterlyPeriods: FinancialPeriodEvidence[];
  valuation: {
    asOf: string | null;
    price: number | null;
    epsTtm: number | null;
    peTtm: number | null;
    bookValuePerShare: number | null;
    pb: number | null;
    historicalPercentile: number | null;
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
};

export type DisclosureEvidence = {
  schemaVersion: "disclosure-evidence-v1";
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
  getCompanyProfile?(symbol: string): Promise<CompanyProfile>;
  getFundamentals?(symbol: string, options?: CompanyEvidenceOptions): Promise<FundamentalEvidence>;
  getDisclosures?(symbol: string, options?: CompanyEvidenceOptions): Promise<DisclosureEvidence>;
  getNews?(symbol: string): Promise<NewsItem[]>;
}

export type { Candle, CompanyProfile, NewsItem, Quote };
