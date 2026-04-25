export type Trend = "bullish" | "neutral" | "bearish";
export type NewsSentiment = "positive" | "neutral" | "negative";
export type StockNewsSentiment = NewsSentiment | "mixed";
export type ImpactLevel = "low" | "medium" | "high";

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

export interface AiAnalysisResult {
  trend: Trend;
  confidence: number;
  summary: string;
  isFallback?: boolean;
  fallbackReason?: string;
  keyLevels: {
    support: number[];
    resistance: number[];
  };
  riskFactors: string[];
  newsSummary: string;
  newsSentiment: StockNewsSentiment;
  catalystEvents: string[];
  macroRisks: string[];
  sectorRisks: string[];
  possibleActions: Array<{
    action: "hold" | "watch" | "reduce" | "consider_entry" | "avoid";
    reason: string;
    invalidIf: string;
  }>;
  disclaimer: string;
}
