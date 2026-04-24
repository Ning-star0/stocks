import type { Candle, CompanyProfile, NewsItem, Quote } from "@/lib/types";

export interface StockDataProvider {
  getQuote(symbol: string): Promise<Quote>;
  getHistory(symbol: string, range: string, interval: string): Promise<Candle[]>;
  getCompanyProfile?(symbol: string): Promise<CompanyProfile>;
  getNews?(symbol: string): Promise<NewsItem[]>;
}

export type { Candle, CompanyProfile, NewsItem, Quote };

