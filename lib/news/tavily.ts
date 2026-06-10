import { AppError } from "@/lib/errors";
import { readProviderJsonResponse } from "@/lib/httpJson";
import type { NewsProvider } from "@/lib/news/NewsProvider";
import type { NewsItem } from "@/lib/types";

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
  published_date?: string;
  source?: string;
};

type TavilyResponse = {
  results?: TavilyResult[];
  error?: string;
};

export class TavilyNewsProvider implements NewsProvider {
  private readonly baseUrl = "https://api.tavily.com/search";

  async searchCompanyNews(symbol: string, from: string, to: string): Promise<NewsItem[]> {
    const key = requireTavilyKey();
    const normalized = symbol.toUpperCase();
    const compact = normalized.replace(/\.(SH|SZ|BJ|HK)$/i, "");
    const fromDate = from.slice(0, 10);
    const toDate = to.slice(0, 10);

    const queries = [
      `${compact} stock news ${fromDate} ${toDate}`,
      `${compact} 股票 公告 业绩 新闻`
    ];

    const rows: TavilyResult[] = [];
    for (const query of queries) {
      const results = await this.search(key, query, "news");
      rows.push(...results);
      if (rows.length >= 8) break;
    }

    return rows.map((row) => ({
      title: row.title ?? "未命名新闻",
      url: row.url,
      source: row.source ?? "Tavily",
      publishedAt: parseDate(row.published_date).toISOString(),
      summary: (row.content ?? "").slice(0, 500),
      rawContent: row.content,
      symbols: [normalized],
      sectors: []
    }));
  }

  async searchTopicNews(keywords: string[], from: string, to: string): Promise<NewsItem[]> {
    const key = requireTavilyKey();
    const cleanKeywords = keywords.map((k) => k.trim()).filter(Boolean);
    if (!cleanKeywords.length) return [];

    const query = cleanKeywords.slice(0, 5).join(" ");
    const fromDate = from.slice(0, 10);
    const toDate = to.slice(0, 10);

    const rows = await this.search(key, `${query} news ${fromDate} ${toDate}`, "news");

    return rows
      .filter((row) => {
        const text = `${row.title ?? ""} ${row.content ?? ""}`.toLowerCase();
        return cleanKeywords.some((kw) => text.includes(kw.toLowerCase()));
      })
      .map((row) => ({
        title: row.title ?? "未命名新闻",
        url: row.url,
        source: row.source ?? "Tavily",
        publishedAt: parseDate(row.published_date).toISOString(),
        summary: (row.content ?? "").slice(0, 500),
        rawContent: row.content,
        symbols: [],
        sectors: cleanKeywords
      }));
  }

  private async search(key: string, query: string, topic: string): Promise<TavilyResult[]> {
    const url = new URL(this.baseUrl);
    const body = JSON.stringify({
      query,
      topic: topic === "news" ? "news" : "general",
      search_depth: "basic",
      max_results: 8,
      include_answer: false,
      include_raw_content: false,
      days: 7
    });

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body,
      cache: "no-store"
    });

    if (response.status === 429) {
      throw new AppError("RATE_LIMIT", "Tavily 搜索触发限流。");
    }
    if (!response.ok) {
      throw new AppError("DATA_PROVIDER_ERROR", `Tavily 搜索失败：HTTP ${response.status}`);
    }

    const payload = await readProviderJsonResponse<TavilyResponse>(response, "Tavily 搜索");
    return payload.results ?? [];
  }
}

function requireTavilyKey(): string {
  const key = (process.env.TAVILY_API_KEY ?? "").trim().replace(/^["']|["']$/g, "");
  if (!key || key.toLowerCase().includes("change_me")) {
    throw new AppError("DATA_PROVIDER_ERROR", "Tavily API key 未配置。");
  }
  return key;
}

function parseDate(value?: string): Date {
  if (!value) return new Date();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}
