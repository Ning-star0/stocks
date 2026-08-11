import type { TradePerformanceSummary } from "@/lib/trades/performance";
import type { PortfolioRiskBudget } from "@/lib/trading/riskBudget";
import type { StrategyBacktestComparison, StrategyBacktestPortfolioSummary } from "@/lib/strategy/backtest";

export type ResearchForecastBias = "bullish" | "neutral" | "bearish";

export type ResearchSymbolForecast = {
  symbol: string;
  name: string | null;
  bias: ResearchForecastBias;
  upProbability: number;
  sidewaysProbability: number;
  downProbability: number;
  confidence: number;
  expectedLow: number | null;
  expectedBase: number | null;
  expectedHigh: number | null;
  triggerPrice: number | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  rationale: string;
  catalysts: string[];
  risks: string[];
  invalidIf: string;
};

export type ResearchForecast = {
  status: "ai" | "fallback";
  model: string;
  generatedAt: string;
  horizonTradingDays: number;
  marketView: string;
  riskNotes: string[];
  symbols: ResearchSymbolForecast[];
  fallbackReason: string | null;
  disclaimer: string;
};

export type ResearchCandle = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  changePct: number | null;
  amplitudePct: number | null;
};

export type ResearchSymbolData = {
  symbol: string;
  name: string | null;
  quote: Record<string, unknown> | null;
  position: Record<string, unknown> | null;
  indicators: Record<string, unknown> | null;
  historySummary: Record<string, unknown>;
  candles: ResearchCandle[];
  historyError: string | null;
  latestAnalysis: Record<string, unknown> | null;
  news: ResearchNewsItem[];
  executions: ResearchExecution[];
};

export type ResearchNewsItem = {
  title: string;
  source: string | null;
  publishedAt: string;
  url: string | null;
  summary: string | null;
  rawContent: string | null;
  sentiment: string | null;
  importance: string | null;
  symbols: string[];
  sectors: string[];
  analysis: Record<string, unknown> | null;
};

export type ResearchExecution = {
  symbol: string;
  side: string;
  price: number;
  shares: number;
  amount: number;
  fee: number;
  realizedPnl: number | null;
  executedAt: string;
  note: string | null;
};

export type ChatGptResearchBundle = {
  schemaVersion: 1;
  generatedAt: string;
  title: string;
  range: string;
  interval: string;
  newsDays: number;
  requestedSymbols: string[];
  portfolio: Record<string, unknown>;
  performance: TradePerformanceSummary;
  riskBudget: PortfolioRiskBudget;
  latestDecision: Record<string, unknown> | null;
  symbols: ResearchSymbolData[];
  strategyBacktests: StrategyBacktestComparison[];
  strategyBacktestPortfolio: StrategyBacktestPortfolioSummary | null;
  forecast: ResearchForecast | null;
  chatgptTask: string;
  disclaimer: string;
};

export type ResearchExportFile = {
  name: string;
  format: "markdown" | "json";
  size: number;
  createdAt: string;
  downloadUrl: string;
};

export type ResearchExportOptions = {
  instruments: Array<{
    symbol: string;
    name: string | null;
    isHolding: boolean;
    isFocused: boolean;
  }>;
  defaults: {
    symbols: string[];
    range: string;
    interval: string;
    newsDays: number;
    includeForecast: boolean;
  };
  files: ResearchExportFile[];
  storageReady: boolean;
};

export type ResearchExportResult = {
  generatedAt: string;
  symbols: Array<{ symbol: string; name: string | null; candles: number; news: number; historyError: string | null }>;
  forecast: ResearchForecast | null;
  strategyBacktests: Array<{
    symbol: string;
    recommendedPreset: string;
    closedTrades: number;
    netReturnPct: number;
    maxDrawdownPct: number;
  }>;
  strategyBacktestPortfolio: StrategyBacktestPortfolioSummary | null;
  files: ResearchExportFile[];
};
