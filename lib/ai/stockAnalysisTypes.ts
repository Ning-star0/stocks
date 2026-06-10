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
};
