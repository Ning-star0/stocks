import type { IndicatorSnapshot } from "@/lib/types";

export type QuantAction = "buy" | "add" | "hold" | "watch" | "reduce" | "sell" | "avoid";

export type QuantMarketRegime = "risk_on" | "neutral" | "risk_off";
export type QuantSectorBias = "bullish" | "neutral" | "bearish" | "overheated" | "uncertain";

export type QuantStrategyContext = {
  marketRegime: QuantMarketRegime;
  buyThresholdDelta: number;
  sellThresholdDelta: number;
  maxPositionPct: number;
  allowAdd: boolean;
  avoidChasing: boolean;
  notes: string[];
  sectorBiases?: Record<string, QuantSectorBias>;
};

export type QuantSignal = {
  action: QuantAction;
  trendScore: number;
  momentumScore: number;
  riskScore: number;
  buyScore: number;
  sellScore: number;
  confidence: number;
  volumeRatio: number | null;
  supportDistancePct: number | null;
  resistanceDistancePct: number | null;
  stopDistancePct: number | null;
  takeProfitDistancePct: number | null;
  riskRewardRatio: number | null;
  holdingReturnPct: number | null;
  suggestedBuyCapitalPct: number;
  suggestedSellRatioPct: number;
  suggestedSellShares: number;
  adjustedBuyThreshold: number;
  adjustedAddThreshold: number;
  adjustedReduceThreshold: number;
  adjustedSellThreshold: number;
  holdingDays: number | null;
  newPositionProtection: boolean;
  marketRegime: QuantMarketRegime;
  sectorBias: QuantSectorBias;
  entryZone: string;
  stopLoss: string;
  takeProfit: string;
  entryPlan: string;
  exitPlan: string;
  tradeConstraints: string[];
  reasons: string[];
  risks: string[];
};

export type QuantInput = {
  price: number | null;
  symbol?: string | null;
  name?: string | null;
  sectorKey?: string | null;
  changePct?: number | null;
  indicators?: Partial<IndicatorSnapshot> | null;
  historySummary?: {
    averageVolume?: number | null;
    recentVolume?: number | null;
    high?: number | null;
    low?: number | null;
    changePercent?: number | null;
  } | null;
  keyLevels?: {
    support?: number[];
    resistance?: number[];
  } | null;
  isHolding?: boolean | null;
  holdingPrice?: number | null;
  holdingShares?: number | null;
  positionOpenedAt?: Date | string | null;
  targetPrice?: number | null;
  stopLoss?: number | null;
  strategyContext?: QuantStrategyContext | null;
};
