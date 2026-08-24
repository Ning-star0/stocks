import type { AiAnalysisResult } from "@/lib/types";

export type QuoteWithStatus = {
  symbol: string;
  name?: string | null;
  price: number | null;
  changePct: number | null;
  volume: number | null;
  currency: "USD" | "CNY" | "HKD";
  updatedAt: string | null;
  source: string;
  status: "normal" | "cached" | "stale" | "unavailable" | "error";
  error?: string;
  isMock: boolean;
};

export type LatestAnalysisSummary = {
  id: string;
  createdAt: string;
  outputJson: AiAnalysisResult;
} | null;

export type WatchlistItem = {
  id: string;
  symbol: string;
  market: string;
  note?: string | null;
  isHolding?: boolean | null;
  holdingPrice?: number | null;
  positionOpenedAt?: string | null;
  timeHorizon: string;
  riskLevel: string;
};

export type MarketIndexItem = {
  symbol: string;
  name: string;
  quote: QuoteWithStatus | null;
};

export type DashboardResponse = {
  dataSource?: { quoteProvider: string; isMock: boolean };
  quotes: Record<string, QuoteWithStatus>;
  marketIndices?: MarketIndexItem[];
  latestAnalyses: Record<string, LatestAnalysisSummary>;
  watchlists: Array<{
    id: string;
    name: string;
    items: WatchlistItem[];
  }>;
};

export type RiskBucket = "high" | "medium" | "low";
export type ActionCategory = "entry" | "wait" | "watch" | "avoid" | "insufficient" | "none";
export type SortKey = "default" | "changeDesc" | "changeAsc" | "riskFirst" | "focusFirst";

export type StrategyView = {
  label: string;
  tone: "watch" | "wait" | "avoid" | "bullish" | "bearish" | "neutral";
};

export type WatchlistRowModel = {
  item: WatchlistItem;
  quote?: QuoteWithStatus;
  latest: LatestAnalysisSummary;
  name: string;
  symbol: string;
  strategy: StrategyView;
  action: StrategyView;
  actionCategory: ActionCategory;
  riskBucket: RiskBucket;
  isHolding: boolean;
  hasAnalysis: boolean;
  tags: string[];
  isFocus: boolean;
  isWatch: boolean;
  searchText: string;
  index: number;
};
