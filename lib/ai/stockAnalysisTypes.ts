import type { AnalysisEvidencePackage } from "@/lib/analysis/evidence";
import type { DisclosureSourceSummary, NewsEventTimelineSummary, NewsEvidenceCoverageSummary } from "@/lib/types";
import type { PortfolioRiskContext } from "@/lib/analysis/portfolioRiskContext";
import type { FundamentalCoverageSummary } from "@/lib/analysis/fundamentalCoverage";

export type AnalyzeStockInput = {
  symbol: string;
  quote: unknown;
  indicators: unknown;
  historySummary: unknown;
  userContext: unknown;
  // 用户在 /memory 页面维护的长期交易习惯，AI 分析时作为背景参考
  userMemory?: string;
  // 用户在 /focus 填的总本金，用于计算具体买入股数和仓位
  userCapital?: number | null;
  portfolioRiskContext?: PortfolioRiskContext | null;
  analysisAsOf?: string;
  dataScope?: {
    quoteTime?: string | null;
    historyRange?: string;
    historyInterval?: string;
    historyFrom?: string | null;
    historyTo?: string | null;
    historyCandles?: number;
    newsWindow?: string;
    newsCount?: number;
    newsCoverage?: NewsEvidenceCoverageSummary | null;
    newsTimeline?: NewsEventTimelineSummary | null;
    newsRefreshFailures?: string[];
    marketRegimeStatus?: string;
    marketRegime?: string;
    marketRegimeBenchmarkSymbol?: string;
    marketRegimeAsOf?: string | null;
    marketRegimeSourceUrl?: string;
    marketRegimeFailure?: string | null;
    fundamentalsStatus?: string;
    fundamentalsReportPeriod?: string | null;
    fundamentalsSourceUrl?: string | null;
    fundamentalCoverage?: FundamentalCoverageSummary | null;
    disclosureStatus?: string;
    disclosureCheckedAt?: string | null;
    disclosureCount?: number;
    disclosureCriticalCount?: number;
    disclosureExtractedCount?: number;
    disclosureSources?: DisclosureSourceSummary[];
    companyEvidenceFailures?: string[];
    portfolioRiskStatus?: string;
    portfolioAvailableRiskAmount?: number | null;
    portfolioRiskFailure?: string | null;
    webSearchStatus?: string;
  };
  tradingFeeRule?: {
    rate: number;
    minimumFeeBase: number;
    minimumFee: number;
    lotSize: number;
    description: string;
  };
  recentNews?: unknown;
  webSearchResults?: unknown;
  evidencePackage?: AnalysisEvidencePackage;
};
