import { FinnhubNewsProvider } from "@/lib/news/finnhub";
import { MockNewsProvider } from "@/lib/news/mock";
import type { NewsProvider } from "@/lib/news/NewsProvider";

let provider: NewsProvider | null = null;

export function getNewsProvider(): NewsProvider {
  if (provider) return provider;

  const providerName = process.env.NEWS_PROVIDER?.toLowerCase() ?? process.env.STOCK_NEWS_PROVIDER?.toLowerCase() ?? "mock";
  provider = providerName === "finnhub" ? new FinnhubNewsProvider() : new MockNewsProvider();
  return provider;
}

export type { NewsProvider };

