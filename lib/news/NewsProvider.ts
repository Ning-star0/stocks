import type { NewsItem } from "@/lib/types";

export interface NewsProvider {
  searchCompanyNews(symbol: string, from: string, to: string): Promise<NewsItem[]>;
  searchTopicNews(keywords: string[], from: string, to: string): Promise<NewsItem[]>;
}

