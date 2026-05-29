import { FinnhubNewsProvider } from "@/lib/news/finnhub";
import { MockNewsProvider } from "@/lib/news/mock";
import { TavilyNewsProvider } from "@/lib/news/tavily";
import { TianApiNewsProvider } from "@/lib/news/tianapi";
import type { NewsProvider } from "@/lib/news/NewsProvider";

let cachedProvider: NewsProvider | null = null;

export function getNewsProvider(): NewsProvider {
  if (cachedProvider) return cachedProvider;

  const providerName = process.env.NEWS_PROVIDER?.toLowerCase() ?? process.env.STOCK_NEWS_PROVIDER?.toLowerCase() ?? "mock";

  let primary: NewsProvider;
  if (providerName === "finnhub") primary = new FinnhubNewsProvider();
  else if (providerName === "tianapi") primary = new TianApiNewsProvider();
  else primary = new MockNewsProvider();

  const fallback = hasTavilyKey() ? new TavilyNewsProvider() : null;

  cachedProvider = fallback ? new FallbackNewsProvider(primary, fallback) : primary;
  return cachedProvider;
}

function hasTavilyKey(): boolean {
  const key = (process.env.TAVILY_API_KEY ?? "").trim().replace(/^["']|["']$/g, "");
  return Boolean(key) && !key.toLowerCase().includes("change_me");
}

export type { NewsProvider };

class FallbackNewsProvider implements NewsProvider {
  constructor(
    private readonly primary: NewsProvider,
    private readonly fallback: NewsProvider
  ) {}

  async searchCompanyNews(symbol: string, from: string, to: string) {
    try {
      const results = await this.primary.searchCompanyNews(symbol, from, to);
      if (results.length) return results;
    } catch {
      // Primary failed, try fallback
    }
    try {
      return await this.fallback.searchCompanyNews(symbol, from, to);
    } catch {
      return [];
    }
  }

  async searchTopicNews(keywords: string[], from: string, to: string) {
    try {
      const results = await this.primary.searchTopicNews(keywords, from, to);
      if (results.length) return results;
    } catch {
      // Primary failed, try fallback
    }
    try {
      return await this.fallback.searchTopicNews(keywords, from, to);
    } catch {
      return [];
    }
  }
}
