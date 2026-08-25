import { createHash } from "node:crypto";

import { logApiCacheHit, reserveApiQuota, settleApiQuota } from "@/lib/apiQuota";
import { rememberWithStatus } from "@/lib/cache";
import { AppError } from "@/lib/errors";
import { readProviderJsonResponse } from "@/lib/httpJson";
import { resolveNewsCacheTtl } from "@/lib/news/cachePolicy";
import {
  consumeNewsRequestBudget,
  createNewsRequestContext,
  type NewsProvider,
  type NewsProviderEvent,
  type NewsRequestContext
} from "@/lib/news/NewsProvider";
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

  async searchCompanyNews(symbol: string, from: string, to: string, context = createNewsRequestContext({ symbol })): Promise<NewsItem[]> {
    const key = requireTavilyKey();
    const normalized = symbol.toUpperCase();
    const compact = normalized.replace(/\.(SH|SZ|BJ|HK)$/i, "");
    const fromDate = from.slice(0, 10);
    const toDate = to.slice(0, 10);

    const query = `${compact} 股票 公告 业绩 新闻 ${fromDate} ${toDate}`;
    const rows = await this.search(key, query, "news", context, "company", resolveNewsCacheTtl("company"));

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

  async searchTopicNews(keywords: string[], from: string, to: string, context = createNewsRequestContext()): Promise<NewsItem[]> {
    const key = requireTavilyKey();
    const cleanKeywords = keywords.map((k) => k.trim()).filter(Boolean);
    if (!cleanKeywords.length) return [];

    const query = cleanKeywords.slice(0, 5).join(" ");
    const fromDate = from.slice(0, 10);
    const toDate = to.slice(0, 10);

    const rows = await this.search(
      key,
      `${query} news ${fromDate} ${toDate}`,
      "news",
      context,
      "topic",
      resolveNewsCacheTtl("topic")
    );

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

  private async search(
    key: string,
    query: string,
    topic: string,
    context: NewsRequestContext,
    requestKind: NewsProviderEvent["requestKind"],
    ttlSeconds: number
  ): Promise<TavilyResult[]> {
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

    const cacheKey = `news:tavily:v2:${createHash("sha256").update(body).digest("hex").slice(0, 24)}`;
    const result = await rememberWithStatus(cacheKey, ttlSeconds, async () => {
      consumeNewsRequestBudget(context, "tavily", requestKind);
      let reservation;
      try {
        reservation = await reserveApiQuota(usageInput(context, requestKind, { queryHash: cacheKey.slice(-24) }));
      } catch (error) {
        context.events.push({ provider: "tavily", apiName: "web_search", status: "quota_exhausted", requestKind, message: errorMessage(error) });
        throw error;
      }

      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "X-Project-ID": normalizeProjectId(process.env.TAVILY_PROJECT_ID)
          },
          body,
          cache: "no-store"
        });
      } catch (error) {
        await settleApiQuota(reservation, "failed", { error: errorMessage(error) });
        context.events.push({ provider: "tavily", apiName: "web_search", status: "failed", requestKind, message: errorMessage(error) });
        throw error;
      }

      if (response.status === 429) {
        await settleApiQuota(reservation, "failed", { httpStatus: response.status });
        context.events.push({ provider: "tavily", apiName: "web_search", status: "failed", requestKind, message: "HTTP 429" });
        throw new AppError("RATE_LIMIT", "Tavily 搜索触发限流。");
      }
      if (!response.ok) {
        await settleApiQuota(reservation, "failed", { httpStatus: response.status });
        context.events.push({ provider: "tavily", apiName: "web_search", status: "failed", requestKind, message: `HTTP ${response.status}` });
        throw new AppError("DATA_PROVIDER_ERROR", `Tavily 搜索失败：HTTP ${response.status}`);
      }

      let payload: TavilyResponse;
      try {
        payload = await readProviderJsonResponse<TavilyResponse>(response, "Tavily 搜索");
      } catch (error) {
        await settleApiQuota(reservation, "failed", { error: errorMessage(error) });
        context.events.push({ provider: "tavily", apiName: "web_search", status: "failed", requestKind, message: errorMessage(error) });
        throw error;
      }
      await settleApiQuota(reservation, "success", { count: payload.results?.length ?? 0 });
      if (reservation.status === "quota_low") {
        context.events.push({ provider: "tavily", apiName: "web_search", status: "quota_low", requestKind });
      }
      context.events.push({ provider: "tavily", apiName: "web_search", status: "success", requestKind });
      return payload.results ?? [];
    }, { bypassCache: requestKind === "company" && context.forceCriticalRefresh });
    if (result.source !== "fresh") {
      context.events.push({ provider: "tavily", apiName: "web_search", status: "cache_hit", requestKind });
      await logApiCacheHit(usageInput(context, requestKind, { cacheSource: result.source }));
    }
    return result.value;
  }
}

function usageInput(context: NewsRequestContext, requestKind: NewsProviderEvent["requestKind"], metadata: Record<string, unknown> = {}) {
  return {
    userId: context.userId,
    provider: "tavily",
    apiName: "web_search",
    priority: context.priority,
    symbol: context.symbol,
    requestBatchId: context.requestBatchId,
    requestKind,
    metadata
  };
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

function normalizeProjectId(value?: string) {
  return String(value ?? "stocks").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "stocks";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}
