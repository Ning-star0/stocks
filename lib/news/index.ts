import { FinnhubNewsProvider } from "@/lib/news/finnhub";
import { MockNewsProvider } from "@/lib/news/mock";
import type { NewsProvider } from "@/lib/news/NewsProvider";
import { TianApiNewsProvider } from "@/lib/news/tianapi";

let provider: NewsProvider | null = null;

export function getNewsProvider(): NewsProvider {
  if (provider) return provider;

  const providerName = process.env.NEWS_PROVIDER?.toLowerCase() ?? process.env.STOCK_NEWS_PROVIDER?.toLowerCase() ?? "mock";
  if (providerName === "finnhub") provider = new FinnhubNewsProvider();
  else if (providerName === "tianapi") provider = new TianApiNewsProvider();
  else provider = new MockNewsProvider();
  return provider;
}

export type { NewsProvider };
