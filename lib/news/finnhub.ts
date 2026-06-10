import { logApiUsage } from "@/lib/apiUsage";
import { AppError } from "@/lib/errors";
import { readProviderJsonResponse } from "@/lib/httpJson";
import type { NewsProvider } from "@/lib/news/NewsProvider";
import type { NewsItem } from "@/lib/types";

type FinnhubCompanyNews = {
  category?: string;
  datetime?: number;
  headline?: string;
  id?: number;
  image?: string;
  related?: string;
  source?: string;
  summary?: string;
  url?: string;
};

function requireFinnhubKey() {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new AppError("DATA_PROVIDER_ERROR", "使用 finnhub 新闻源需要配置 FINNHUB_API_KEY。");
  return key;
}

export class FinnhubNewsProvider implements NewsProvider {
  private readonly baseUrl = "https://finnhub.io/api/v1";

  async searchCompanyNews(symbol: string, from: string, to: string): Promise<NewsItem[]> {
    const key = requireFinnhubKey();
    const fromDate = from.slice(0, 10);
    const toDate = to.slice(0, 10);
    const url = `${this.baseUrl}/company-news?symbol=${encodeURIComponent(symbol)}&from=${fromDate}&to=${toDate}&token=${key}`;
    const response = await fetch(url, { next: { revalidate: 300 } });
    if (response.status === 429) {
      await logApiUsage({ provider: "finnhub", apiName: "news", status: "failed", metadata: { status: response.status, symbol } });
      throw new AppError("RATE_LIMIT", "Finnhub 新闻接口触发限流。");
    }
    if (!response.ok) {
      await logApiUsage({ provider: "finnhub", apiName: "news", status: "failed", metadata: { status: response.status, symbol } });
      throw new AppError("DATA_PROVIDER_ERROR", `Finnhub 新闻请求失败：${response.status}`);
    }
    const rows = await readProviderJsonResponse<FinnhubCompanyNews[]>(response, "Finnhub 公司新闻");
    await logApiUsage({ provider: "finnhub", apiName: "news", status: "success", metadata: { symbol, count: rows.length } });
    return rows.map((row) => normalizeFinnhubNews(row, [symbol.toUpperCase()]));
  }

  async searchTopicNews(keywords: string[], from: string, to: string): Promise<NewsItem[]> {
    const key = requireFinnhubKey();
    const category = encodeURIComponent("general");
    const url = `${this.baseUrl}/news?category=${category}&token=${key}`;
    const response = await fetch(url, { next: { revalidate: 300 } });
    if (response.status === 429) {
      await logApiUsage({ provider: "finnhub", apiName: "news", status: "failed", metadata: { status: response.status, category } });
      throw new AppError("RATE_LIMIT", "Finnhub 新闻接口触发限流。");
    }
    if (!response.ok) {
      await logApiUsage({ provider: "finnhub", apiName: "news", status: "failed", metadata: { status: response.status, category } });
      throw new AppError("DATA_PROVIDER_ERROR", `Finnhub 主题新闻请求失败：${response.status}`);
    }
    const rows = await readProviderJsonResponse<FinnhubCompanyNews[]>(response, "Finnhub 主题新闻");
    await logApiUsage({ provider: "finnhub", apiName: "news", status: "success", metadata: { category, count: rows.length } });
    const lowerKeywords = keywords.map((keyword) => keyword.toLowerCase());
    const fromTime = new Date(from).getTime();
    const toTime = new Date(to).getTime();

    return rows
      .map((row) => normalizeFinnhubNews(row, [], keywords))
      .filter((item) => {
        const published = item.publishedAt ? new Date(item.publishedAt).getTime() : 0;
        const text = `${item.title} ${item.summary ?? ""} ${item.rawContent ?? ""}`.toLowerCase();
        return published >= fromTime && published <= toTime && lowerKeywords.some((keyword) => text.includes(keyword));
      });
  }
}

function normalizeFinnhubNews(row: FinnhubCompanyNews, symbols: string[], sectors: string[] = []): NewsItem {
  return {
    title: row.headline ?? "未命名市场新闻",
    url: row.url,
    source: row.source,
    publishedAt: row.datetime ? new Date(row.datetime * 1000).toISOString() : new Date().toISOString(),
    rawContent: row.summary,
    summary: row.summary,
    symbols,
    sectors
  };
}
