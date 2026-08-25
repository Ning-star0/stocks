export type Trend = "bullish" | "neutral" | "bearish";
export type NewsSentiment = "positive" | "neutral" | "negative";
export type StockNewsSentiment = NewsSentiment | "mixed";
export type ImpactLevel = "low" | "medium" | "high";
export type DecisionMode = "long_term" | "swing_trade" | "position_management";
export type DecisionStatus =
  | "insufficient_data"
  | "rejected"
  | "research_candidate"
  | "setup_wait"
  | "conditional_entry"
  | "manage_position"
  | "exit_risk";

export interface Quote {
  symbol: string;
  name?: string;
  currency?: string;
  price: number;
  open: number;
  high: number;
  low: number;
  close: number;
  previousClose: number;
  change: number;
  changePercent: number;
  volume: number;
  timestamp: string;
}

export interface Candle {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: string;
}

export interface CompanyProfile {
  symbol: string;
  name: string;
  exchange?: string;
  sector?: string;
  industry?: string;
}

export interface NewsItem {
  title: string;
  url?: string;
  source?: string;
  publishedAt?: string;
  summary?: string;
  rawContent?: string;
  symbols?: string[];
  sectors?: string[];
}

export interface NewsAnalysisResult {
  summary: string;
  sentiment: NewsSentiment;
  impactLevel: ImpactLevel;
  affectedSymbols: string[];
  affectedSectors: string[];
  riskNotes: string[];
  whyItMatters: string;
  confidence: number;
  isFallback: boolean;
  fallbackReason: string | null;
}

export interface IndicatorSnapshot {
  symbol: string;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema20: number | null;
  bollingerUpper: number | null;
  bollingerMiddle: number | null;
  bollingerLower: number | null;
  timestamp: string;
}

export interface HoldAdvice {
  action: string;
  reason: string;
  stopLoss: string;
  takeProfit: string;
  positionManagement: string;
  keyMonitorPoints: string;
  invalidIf: string;
}

export interface EntryAdvice {
  action: string;
  reason: string;
  entryZone: string;
  timing: string;
  triggerCondition: string;
  firstPositionSize: string;
  stopLoss: string;
  takeProfit: string;
  invalidIf: string;
}

export interface AnalysisTradePlanLeg {
  status: "conditional" | "watch" | "blocked" | "not_applicable";
  action: "buy" | "add" | "reduce" | "sell" | "watch" | "avoid";
  triggerPrice: number | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  shares: number | null;
  amount: number | null;
  estimatedFee: number | null;
  totalCost?: number | null;
  netProceeds?: number | null;
  maxLossAmount?: number | null;
  riskRewardRatio?: number | null;
  estimatedExitFee?: number | null;
  roundTripFees?: number | null;
  feeDragPct?: number | null;
  breakEvenPrice?: number | null;
  breakEvenMovePct?: number | null;
  grossExpectedProfit?: number | null;
  netExpectedProfit?: number | null;
  netMaxLossAmount?: number | null;
  netRiskRewardRatio?: number | null;
  expectedValueStatus?: "not_calibrated" | "positive" | "non_positive";
  calibratedWinProbability?: number | null;
  expectedValue?: number | null;
  validationSampleSize?: number | null;
  sellRatioPct?: number | null;
  estimatedPnl?: number | null;
  reason: string;
  constraints: string[];
}

export interface AnalysisTradePlan {
  entry: AnalysisTradePlanLeg;
  exit: AnalysisTradePlanLeg;
  feeRule: {
    rate: number;
    minimumFeeBase: number;
    minimumFee: number;
    lotSize: number;
    description: string;
  };
}

export interface AiAnalysisResult {
  evidenceSchemaVersion?: string;
  decisionMode?: DecisionMode;
  decisionStatus?: DecisionStatus;
  trend: Trend;
  confidence: number;
  summary: string;
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
    newsRefreshFailures?: string[];
    fundamentalsStatus?: string;
    fundamentalsReportPeriod?: string | null;
    fundamentalsSourceUrl?: string | null;
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
  isFallback?: boolean;
  fallbackReason?: string;
  dataQuality?: {
    status: "complete" | "partial" | "insufficient" | "conflicted";
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
    newsQuotaStatus?: "available" | "quota_low" | "quota_exhausted";
    criticalNewsAnalyzed: boolean;
    missingFields: string[];
    staleFields: string[];
    conflictingFields: string[];
    fallbacksUsed: string[];
    entryBlockers: string[];
    newsCoverage?: NewsEvidenceCoverageSummary;
  };
  supportingEvidence?: string[];
  opposingEvidence?: string[];
  missingEvidence?: string[];
  keyLevels: {
    support: number[];
    resistance: number[];
  };
  riskFactors: string[];
  newsSummary: string;
  newsSentiment: StockNewsSentiment;
  webSearchSummary?: string;
  newsReferences?: Array<{
    title: string;
    source?: string | null;
    publishedAt?: string | null;
    url?: string | null;
    sentiment?: string | null;
    impactLevel?: string | null;
  }>;
  webSearchResults?: Array<{
    title: string;
    source?: string | null;
    publishedAt?: string | null;
    url?: string | null;
    summary?: string | null;
  }>;
  catalystEvents: string[];
  macroRisks: string[];
  sectorRisks: string[];
  holdAdvice?: HoldAdvice | null;
  entryAdvice?: EntryAdvice | null;
  tradePlan?: AnalysisTradePlan;
  possibleActions: Array<{
    action: "hold" | "watch" | "reduce" | "consider_entry" | "avoid";
    reason: string;
    timing?: string;
    triggerCondition?: string;
    entryZone?: string;
    stopLossPlan?: string;
    takeProfitPlan?: string;
    positionSizing?: string;
    followUpCheck?: string;
    invalidIf: string;
  }>;
  disclaimer: string;
}

export interface NewsEvidenceCoverageSummary {
  fetchedCount: number;
  savedCount: number;
  filteredOutCount: number;
  relevantCount: number;
  highCount: number;
  mediumCount: number;
  verifiedAnalyzedCount: number;
  fallbackAnalysisCount: number;
  failedAnalysisCount: number;
  pendingCriticalCount: number;
  pendingRelevantCount: number;
  deadlineExceeded: boolean;
  webSearchUsed: boolean;
  quotaStatus?: "available" | "quota_low" | "quota_exhausted";
  cacheHitCount?: number;
  tianapiCalls?: number;
  tavilyCalls?: number;
  sharedTopicReused?: boolean;
  skippedQueryCount?: number;
  sourceProviders?: string[];
}

export interface DisclosureSourceSummary {
  id: string;
  title: string;
  publishedAt: string;
  url: string;
  contentStatus: "metadata_only" | "extracted" | "analyzed";
  isCritical: boolean;
}
