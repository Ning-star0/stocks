import type { TradePerformanceSummary } from "@/lib/trades/performance";
import type { PortfolioRiskBudget } from "@/lib/trading/riskBudget";

export type TradeExecutionRecord = {
  id: string;
  symbol: string;
  name?: string | null;
  side: "buy" | "sell" | string;
  price: number;
  shares: number;
  amount: number;
  fee: number;
  netCashChange: number;
  realizedPnl: number | null;
  executedAt: string;
  note?: string | null;
};

export type TradeInstrument = {
  symbol: string;
  name: string | null;
  price: number | null;
  isHolding: boolean;
  holdingShares: number | null;
};

export type TradePortfolioSnapshot = {
  capital: number;
  investedCost: number;
  availableCash: number;
  currentMarketValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalAssets: number;
  totalReturnPct: number | null;
  portfolioValuationStatus: string;
  portfolioSnapshotAt: string;
};

export type TradesApiResponse = {
  executions: TradeExecutionRecord[];
  instruments: TradeInstrument[];
  portfolio: TradePortfolioSnapshot;
  performance: TradePerformanceSummary;
  riskBudget: PortfolioRiskBudget;
};
