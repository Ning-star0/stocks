import type { Candle, CompanyProfile, NewsItem, Quote } from "@/lib/types";

export type HistoryOptions = {
  forceRefresh?: boolean;
};

export interface StockDataProvider {
  getQuote(symbol: string): Promise<Quote>;
  getHistory(symbol: string, range: string, interval: string, options?: HistoryOptions): Promise<Candle[]>;
  getCompanyProfile?(symbol: string): Promise<CompanyProfile>;
  getNews?(symbol: string): Promise<NewsItem[]>;
}

export type { Candle, CompanyProfile, NewsItem, Quote };
