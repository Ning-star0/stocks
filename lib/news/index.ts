import { logApiUsage } from "@/lib/apiUsage";
import { FinnhubNewsProvider } from "@/lib/news/finnhub";
import { MockNewsProvider } from "@/lib/news/mock";
import { TavilyNewsProvider } from "@/lib/news/tavily";
import { TianApiNewsProvider } from "@/lib/news/tianapi";
import { createNewsRequestContext, type NewsProvider, type NewsRequestContext } from "@/lib/news/NewsProvider";

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

  async searchCompanyNews(symbol: string, from: string, to: string, context: NewsRequestContext = createNewsRequestContext({ symbol })) {
    try {
      const results = await this.primary.searchCompanyNews(symbol, from, to, context);
      if (results.length) return results;
      await recordFallback(context, "company", "主新闻源无结果，启用备用搜索");
    } catch (error) {
      await recordFallback(context, "company", errorMessage(error));
    }
    try {
      const results = await this.fallback.searchCompanyNews(symbol, from, to, context);
      if (!results.length) await recordFallback(context, "company", "主新闻源与备用搜索均无结果");
      return results;
    } catch (error) {
      await recordFallback(context, "company", errorMessage(error), "failed");
      return [];
    }
  }

  async searchTopicNews(keywords: string[], from: string, to: string, context: NewsRequestContext = createNewsRequestContext()) {
    try {
      const results = await this.primary.searchTopicNews(keywords, from, to, context);
      if (results.length) return results;
      await recordFallback(context, "topic", "主新闻源无结果，启用备用搜索");
    } catch (error) {
      await recordFallback(context, "topic", errorMessage(error));
    }
    try {
      const results = await this.fallback.searchTopicNews(keywords, from, to, context);
      if (!results.length) await recordFallback(context, "topic", "主新闻源与备用搜索均无结果");
      return results;
    } catch (error) {
      await recordFallback(context, "topic", errorMessage(error), "failed");
      return [];
    }
  }
}

async function recordFallback(
  context: NewsRequestContext,
  requestKind: "company" | "topic",
  message: string,
  status: "success" | "failed" = "success"
) {
  context.events.push({ provider: "news_router", apiName: "fallback", status: "fallback", requestKind, message });
  await logApiUsage({
    userId: context.userId,
    provider: "news_router",
    apiName: "fallback",
    status,
    metadata: { symbol: context.symbol, requestBatchId: context.requestBatchId, requestKind, message }
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}
