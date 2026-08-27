import type { QuantSignal, QuantStrategyContext } from "@/lib/quant/strategy";
import type { TradePerformanceSummary } from "@/lib/trades/performance";
import type { PortfolioRiskBudget } from "@/lib/trading/riskBudget";
import type { StrategyHealthGate } from "@/lib/strategy/gate";
import type { AiAnalysisResult } from "@/lib/types";

export type DecisionBlockerCategory = "data" | "calibration" | "market" | "quant" | "risk" | "execution" | "analysis";

export type DecisionBlocker = {
  code: string;
  category: DecisionBlockerCategory;
  message: string;
};

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
  latestAnalysis?: Partial<Pick<
    AiAnalysisResult,
    | "trend"
    | "confidence"
    | "summary"
    | "newsSummary"
    | "newsSentiment"
    | "newsReferences"
    | "sectorRisks"
    | "holdAdvice"
    | "entryAdvice"
    | "riskFactors"
    | "decisionStatus"
    | "dataQuality"
    | "tradePlan"
    | "isFallback"
    | "dataScope"
  >> | null;
  quantSignal?: QuantSignal | null;
  tradeFeedback?: CandidateTradeFeedback | null;
  strategyHealth?: StrategyHealthGate | null;
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

export type DecisionNearMiss = {
  symbol: string;
  name: string | null;
  side: "buy" | "sell";
  price: number | null;
  score: number;
  threshold: number;
  scoreGap: number;
  entryPermission: "allow" | "reduce_size" | "pause" | null;
  blockers: string[];
  blockerDetails: DecisionBlocker[];
};

export type DecisionWaitReason = {
  category: DecisionBlockerCategory;
  candidateCount: number;
  codes: string[];
  message: string;
};

export type DecisionShadowPlan = {
  symbol: string;
  name: string | null;
  action: "buy" | "add";
  triggerPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  shares: number;
  amount: number;
  totalCost: number;
  roundTripFees: number | null;
  netMaxLossAmount: number;
  netRiskRewardRatio: number;
  expectedValueStatus: "not_calibrated";
  blockers: string[];
};

export type DecisionInput = {
  capital: number;
  investedCost: number;
  availableCash: number;
  currentMarketValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalAssets: number;
  tradePerformance: TradePerformanceSummary;
  riskBudget: PortfolioRiskBudget;
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
