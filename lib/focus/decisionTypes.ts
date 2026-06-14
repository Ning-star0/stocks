import type { QuantSignal, QuantStrategyContext } from "@/lib/quant/strategy";

export type Candidate = {
  symbol: string;
  name?: string | null;
  sectorKey?: string | null;
  price: number | null;
  changePct: number | null;
  quoteTime?: string | null;
  analysisGeneratedAt?: string | null;
  analysisDataScope?: {
    quoteTime?: string | null;
    historyTo?: string | null;
    historyRange?: string | null;
    historyInterval?: string | null;
    historyCandles?: number | null;
  } | null;
  status: string;
  note?: string | null;
  riskLevel?: string;
  isHolding?: boolean;
  holdingPrice?: number | null;
  holdingShares?: number | null;
  currentCostBasis?: number | null;
  positionOpenedAt?: Date | null;
  targetPrice?: number | null;
  stopLoss?: number | null;
  latestAnalysis?: {
    trend?: string;
    confidence?: number;
    summary?: string;
    newsSummary?: string;
    newsSentiment?: string;
    newsReferences?: unknown;
    sectorRisks?: unknown;
    holdAdvice?: unknown;
    entryAdvice?: unknown;
    riskFactors?: unknown;
  } | null;
  quantSignal?: QuantSignal | null;
  tradeFeedback?: CandidateTradeFeedback | null;
};

export type CandidateTradeFeedback = {
  lastFeedbackAt: string | null;
  lastBuyAt: string | null;
  lastSellAt: string | null;
  lastSkippedBuyAt: string | null;
  recentLossSellAt: string | null;
  recentLossPnl: number | null;
  buyBlockedUntil: string | null;
  addBlockedUntil: string | null;
  notes: string[];
};

export type DecisionInput = {
  capital: number;
  investedCost: number;
  availableCash: number;
  currentMarketValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalAssets: number;
  marketContext: QuantStrategyContext;
  candidates: Candidate[];
  dataScope: {
    latestQuoteTime: string | null;
    latestHistoryTo: string | null;
    latestAnalysisGeneratedAt: string | null;
    quoteTimes: Array<{ symbol: string; quoteTime: string | null; status: string }>;
    historyTimes: Array<{ symbol: string; historyTo: string | null; historyRange: string | null; historyInterval: string | null; historyCandles: number | null }>;
  };
};

export type GenerateFocusDecisionOptions = {
  userId: string;
  forceRefresh?: boolean;
  source?: "manual" | "scheduled";
  scheduledFor?: Date | string | null;
  runId?: string | null;
  createRunItems?: boolean;
};
