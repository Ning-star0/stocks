import type { PortfolioRiskBudget } from "@/lib/trading/riskBudget";

export type FocusData = {
  name: string;
  symbols: string[];
  capital: number | null;
  newsFetchTime: string;
  analysisTimes: string[];
  lastNewsFetch: string | null;
  lastAnalysis: string | null;
};

export type StockItem = {
  id: string;
  symbol: string;
  name?: string;
  note?: string | null;
  isHolding?: boolean | null;
  holdingPrice?: number | null;
  holdingShares?: number | null;
  positionOpenedAt?: string | null;
  quote?: {
    price?: number | null;
    changePct?: number | null;
  } | null;
  latestAnalysis?: {
    outputJson?: {
      trend?: string;
      confidence?: number;
      riskFactors?: unknown;
    } | null;
  } | null;
};

export type WatchlistApiItem = {
  id: string;
  symbol: string;
  note?: string | null;
  isHolding?: boolean | null;
  holdingPrice?: number | null;
  holdingShares?: number | null;
  positionOpenedAt?: string | null;
  quote?: {
    name?: string | null;
    price?: number | null;
    changePct?: number | null;
  } | null;
  latestAnalysis?: StockItem["latestAnalysis"];
};

export type WatchlistResponse = {
  watchlists?: Array<{ items?: WatchlistApiItem[] }>;
  items?: WatchlistApiItem[];
};

export type FocusDecision = {
  decisionId?: string;
  summary: string;
  recommendedAction: "buy" | "sell" | "mixed" | "wait";
  capital: number;
  investedCost?: number;
  availableCash?: number;
  currentMarketValue?: number;
  unrealizedPnl?: number;
  realizedPnl?: number;
  totalAssets?: number;
  portfolioValuationStatus?: "live" | "stale" | "partial_fallback" | "cost_fallback" | "empty";
  portfolioSnapshotAt?: string;
  totalBudgetToUse: number;
  totalEstimatedFee: number;
  totalEstimatedRoundTripFee?: number;
  totalExpectedNetProfit?: number;
  riskBudget?: PortfolioRiskBudget;
  strategyHealthSummary?: {
    total: number;
    allowed: number;
    reduced: number;
    paused: number;
    generatedAt: string | null;
  };
  strategyHealthGates?: Array<{
    symbol: string;
    name?: string | null;
    capital: number;
    strategyHealth: "healthy" | "watch" | "pause" | "insufficient";
    entryPermission: "allow" | "reduce_size" | "pause";
    recommendedPreset: "current" | "balanced" | "strict";
    validationReturnPct: number | null;
    validationMaxDrawdownPct: number | null;
    validationClosedTrades: number;
    reason: string;
    generatedAt: string;
    validUntil?: string;
    policyVersion?: string;
    marketDataRevision?: string;
  }>;
  plannedRiskAmount?: number;
  riskAfterPlanAmount?: number;
  riskAfterPlanPct?: number;
  availableRiskAfterPlan?: number;
  totalEstimatedCost: number;
  totalSellAmount?: number;
  totalSellEstimatedFee?: number;
  totalSellNetProceeds?: number;
  cashReserve: number;
  fallbackReason?: string | null;
  fromCache?: boolean;
  stale?: boolean;
  generatedAt?: string;
  persistedAt?: string;
  scheduledFor?: string | null;
  source?: string;
  notification?: {
    skipped?: boolean;
    reason?: string;
    sentAt?: string;
    provider?: string;
    error?: string;
    kind?: "trade_plan" | "near_miss" | string;
  } | null;
  nearMisses?: Array<{
    symbol: string;
    name?: string | null;
    side: "buy" | "sell";
    price: number | null;
    score: number;
    threshold: number;
    scoreGap: number;
    entryPermission: "allow" | "reduce_size" | "pause" | null;
    blockers: string[];
  }>;
  feedback?: {
    feedbackAction: string;
    note?: string | null;
    executedPrice?: number | null;
    executedShares?: number | null;
    tradeSymbol?: string | null;
    tradeSide?: "buy" | "sell" | string | null;
    positionSyncedAt?: string | null;
    executedAt?: string | null;
    position?: {
      symbol: string;
      isHolding: boolean;
      holdingPrice: number | null;
      holdingShares: number | null;
      positionOpenedAt: string | null;
    } | null;
    updatedAt?: string;
  } | null;
  dataScope?: {
    latestQuoteTime?: string | null;
    latestHistoryTo?: string | null;
    latestAnalysisGeneratedAt?: string | null;
    quoteTimes?: Array<{ symbol: string; quoteTime: string | null; status: string }>;
    historyTimes?: Array<{ symbol: string; historyTo: string | null; historyRange: string | null; historyInterval: string | null; historyCandles: number | null }>;
  };
  orders: Array<{
    symbol: string;
    name?: string | null;
    action: "buy" | "add" | "watch" | "avoid";
    amount: number;
    shares: number;
    planType?: "pullback" | "breakout" | "support" | "trend_follow" | "add_on_strength" | "risk_rebalance";
    triggerPrice?: number | null;
    stopLossPrice?: number | null;
    takeProfitPrice?: number | null;
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
    riskBudgetAmount?: number | null;
    riskUsagePct?: number | null;
    portfolioRiskAfterOrder?: number | null;
    priority?: number | null;
    entryCondition?: string | null;
    executionWindow?: string | null;
    positionImpact?: string | null;
    estimatedPrice: number | null;
    estimatedFee: number;
    totalCost: number;
    reason: string;
    riskControl: string;
    invalidIf: string;
  }>;
  sellOrders?: Array<{
    symbol: string;
    name?: string | null;
    action: "sell" | "reduce" | "watch" | "avoid";
    amount: number;
    shares: number;
    triggerPrice?: number | null;
    stopLossPrice?: number | null;
    takeProfitPrice?: number | null;
    sellRatioPct?: number | null;
    priority?: number | null;
    exitCondition?: string | null;
    executionWindow?: string | null;
    positionImpact?: string | null;
    estimatedPrice: number | null;
    estimatedFee: number;
    netProceeds: number;
    estimatedPnl?: number | null;
    reason: string;
    riskControl: string;
    invalidIf: string;
  }>;
  ranking: Array<{ symbol: string; rank: number; view: string; reason: string }>;
  disclaimer: string;
};

export type TradeOption = {
  key: string;
  symbol: string;
  name?: string | null;
  side: "buy" | "sell";
  label: string;
  price?: number | null;
  shares?: number | null;
  amount?: number | null;
  triggerPrice?: number | null;
  stopLossPrice?: number | null;
  takeProfitPrice?: number | null;
  priority?: number | null;
  planType?: FocusDecision["orders"][number]["planType"];
  riskRewardRatio?: number | null;
  maxLossAmount?: number | null;
  roundTripFees?: number | null;
  feeDragPct?: number | null;
  breakEvenPrice?: number | null;
  breakEvenMovePct?: number | null;
  netExpectedProfit?: number | null;
  netMaxLossAmount?: number | null;
  netRiskRewardRatio?: number | null;
  riskBudgetAmount?: number | null;
  riskUsagePct?: number | null;
  portfolioRiskAfterOrder?: number | null;
  sellRatioPct?: number | null;
  entryCondition?: string | null;
  exitCondition?: string | null;
  executionWindow?: string | null;
  positionImpact?: string | null;
};

export type AnalysisRunResponse = {
  summary: {
    nextRunAt: string | null;
    todayRunCount: number;
    runningCount: number;
    latestRunId: string | null;
    latestRunType: string | null;
    latestStatus: string;
    latestStartedAt: string | null;
    latestFinishedAt: string | null;
    latestDurationMs: number | null;
    successCount: number;
    failedCount: number;
    totalSymbols: number;
    fallbackCount: number;
    latestFallbackUsed: boolean;
    latestErrorSummary: string | null;
    latestMetrics: RunMetrics;
    concurrency?: {
      runningRuns: number;
      runningItems: number;
      jobWorkerLimit: number;
      focusStockAnalysisLimit: number;
      quoteRequestLimit: number;
    };
  };
  runs: AnalysisRunItem[];
};

export type RunMetrics = {
  totalItemDurationMs: number;
  aiDurationMs: number;
  quoteDurationMs: number;
  newsDurationMs: number;
  averageItemDurationMs: number | null;
  runningItems: number;
};

export type AnalysisRunItem = {
  id: string;
  runType: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  totalSymbols: number;
  successCount: number;
  failedCount: number;
  fallbackUsed: boolean;
  errorSummary: string | null;
  metrics: RunMetrics;
  items: Array<{
    id: string;
    symbol: string;
    stockName: string | null;
    status: string;
    aiStatus: string | null;
    quoteStatus: string | null;
    newsStatus: string | null;
    errorMessage: string | null;
    durationMs: number | null;
    aiDurationMs: number | null;
    quoteDurationMs: number | null;
    newsDurationMs: number | null;
    fallbackUsed: boolean;
  }>;
};

export type DecisionHistoryRecord = {
  id: string;
  symbol: string;
  stockName: string | null;
  decisionTime: string;
  source: string;
  strategyDirection: string;
  action: string;
  riskLevel: string | null;
  confidence: number | null;
  summary: string;
  keyReasons: unknown;
  fallbackUsed: boolean;
  changeSummary: string | null;
  change?: {
    status: "first" | "continued" | "changed";
    summary: string;
    actionChange: string | null;
    strategyChange: string | null;
    riskChange: string | null;
    confidenceChange: string | null;
    reasons: string[];
  };
};
