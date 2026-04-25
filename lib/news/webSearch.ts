import { createHash } from "node:crypto";

import { remember } from "@/lib/cache";
import { AppError } from "@/lib/errors";
import { getNewsProvider } from "@/lib/news";
import { buildStockNewsKeywords, filterRelevantNewsForStock } from "@/lib/news/relevance";
import type { NewsItem } from "@/lib/types";

export type RelatedNewsSearchInput = {
  symbol: string;
  name?: string | null;
  sectorKeywords?: string[];
  days?: number;
  maxResults?: number;
};

export type RelatedNewsSearchOutput = {
  provider: "tavily" | "news_provider";
  status: string;
  queries: string[];
  results: NewsItem[];
};

type TavilyResponse = {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    raw_content?: string;
    score?: number;
    published_date?: string;
    source?: string;
  }>;
};

export async function searchRelatedNews(input: RelatedNewsSearchInput): Promise<RelatedNewsSearchOutput> {
  const queries = buildSearchQueries(input);
  if (!queries.length) return { provider: "news_provider", status: "没有可用搜索关键词", queries, results: [] };

  if (normalizeEnv(process.env.TAVILY_API_KEY)) {
    try {
      const results = await searchTavilyNews(input, queries);
      if (results.length) {
        return {
          provider: "tavily",
          status: `Tavily 联网搜索命中 ${results.length} 条相关新闻`,
          queries,
          results
        };
      }
    } catch {
      // Fall through to the configured news provider; search should never break stock analysis.
    }
  }

  const fallbackResults = await searchViaConfiguredNewsProvider(input, queries);
  return {
    provider: "news_provider",
    status: normalizeEnv(process.env.TAVILY_API_KEY)
      ? `Tavily 未命中，已回退到 ${process.env.NEWS_PROVIDER || "news provider"}`
      : `未配置 TAVILY_API_KEY，已使用 ${process.env.NEWS_PROVIDER || "news provider"} 搜索`,
    queries,
    results: fallbackResults
  };
}

function buildSearchQueries(input: RelatedNewsSearchInput) {
  const keywords = buildStockNewsKeywords({
    symbol: input.symbol,
    name: input.name,
    extraKeywords: input.sectorKeywords ?? []
  });
  const compactSymbol = input.symbol.replace(/\.(SH|SZ|BJ|HK)$/i, "");
  const primaryName = input.name?.trim();
  const sector = input.sectorKeywords?.find((item) => item.trim().length >= 2);
  const output = new Set<string>();

  if (primaryName && primaryName.toUpperCase() !== input.symbol.toUpperCase()) {
    output.add(`${primaryName} 股票 最新消息`);
    output.add(`${primaryName} 公告 业绩 合同 政策`);
  }
  if (sector) output.add(`${primaryName || compactSymbol} ${sector} 行业新闻`);
  output.add(`${compactSymbol} ${primaryName || ""} 股票 新闻`.trim());
  output.add(`${keywords.slice(0, 4).join(" ")} 最新 财经`.trim());

  return [...output].filter((item) => item.length >= 4).slice(0, numberEnv("WEB_SEARCH_MAX_QUERIES", 3));
}

async function searchTavilyNews(input: RelatedNewsSearchInput, queries: string[]) {
  const rows: NewsItem[] = [];
  for (const query of queries) {
    rows.push(...(await searchTavilyQuery(query, input)));
    if (rows.length >= (input.maxResults ?? 8)) break;
  }
  return filterAndDedupe(rows, input);
}

async function searchTavilyQuery(query: string, input: RelatedNewsSearchInput) {
  const key = normalizeEnv(process.env.TAVILY_API_KEY);
  if (!key) return [];

  const cacheKey = `web_news:tavily:${hash(`${query}:${input.days ?? 7}`)}`;
  return remember(cacheKey, numberEnv("WEB_SEARCH_CACHE_TTL_SECONDS", numberEnv("NEWS_CACHE_TTL_SECONDS", 900)), async () => {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query,
        topic: "news",
        search_depth: "basic",
        max_results: Math.min(10, Math.max(1, input.maxResults ?? 8)),
        days: Math.max(1, Math.min(30, input.days ?? 7)),
        include_answer: false,
        include_raw_content: false,
        include_images: false
      })
    });

    const payload = (await response.json().catch(() => ({}))) as TavilyResponse & { error?: string; message?: string };
    if (!response.ok) {
      throw new AppError("DATA_PROVIDER_ERROR", payload.error || payload.message || `Tavily 搜索失败：HTTP ${response.status}`);
    }

    return (payload.results ?? []).map((row) => tavilyRowToNewsItem(row, input));
  });
}

async function searchViaConfiguredNewsProvider(input: RelatedNewsSearchInput, queries: string[]) {
  const provider = getNewsProvider();
  const to = new Date();
  const from = new Date(Date.now() - Math.max(1, input.days ?? 7) * 24 * 60 * 60 * 1000);
  const rows: NewsItem[] = [];

  for (const query of queries.slice(0, numberEnv("WEB_SEARCH_MAX_QUERIES", 3))) {
    rows.push(...(await provider.searchTopicNews(query.split(/\s+/).filter(Boolean).slice(0, 4), from.toISOString(), to.toISOString()).catch(() => [])));
  }

  return filterAndDedupe(rows.map((item) => attachInputContext(item, input)), input);
}

function tavilyRowToNewsItem(row: NonNullable<TavilyResponse["results"]>[number], input: RelatedNewsSearchInput): NewsItem {
  const url = row.url?.trim();
  const publishedAt = parsePublishedAt(row.published_date);
  const summary = cleanText(row.content || row.raw_content || row.title || "");
  return {
    title: row.title?.trim() || url || "未命名联网新闻",
    url,
    source: row.source || sourceFromUrl(url) || "Tavily",
    publishedAt: publishedAt.toISOString(),
    summary,
    rawContent: summary,
    symbols: [input.symbol.toUpperCase()],
    sectors: uniqueText(input.sectorKeywords ?? [])
  };
}

function attachInputContext(item: NewsItem, input: RelatedNewsSearchInput): NewsItem {
  return {
    ...item,
    symbols: uniqueUpper([...(item.symbols ?? []), input.symbol]),
    sectors: uniqueText([...(item.sectors ?? []), ...(input.sectorKeywords ?? [])])
  };
}

function filterAndDedupe(items: NewsItem[], input: RelatedNewsSearchInput) {
  const relevant = filterRelevantNewsForStock(items, {
    symbol: input.symbol,
    name: input.name,
    keywords: buildStockNewsKeywords({
      symbol: input.symbol,
      name: input.name,
      extraKeywords: input.sectorKeywords ?? []
    })
  });
  const seen = new Set<string>();
  const output: NewsItem[] = [];
  for (const item of relevant) {
    const key = (item.url || item.title).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push({
      ...item,
      rawContent: item.rawContent ? cleanText(item.rawContent).slice(0, 800) : undefined,
      summary: item.summary ? cleanText(item.summary).slice(0, 500) : undefined
    });
  }
  return output.slice(0, input.maxResults ?? 8);
}

function sourceFromUrl(value?: string) {
  if (!value) return null;
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function parsePublishedAt(value?: string) {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function uniqueUpper(values: string[]) {
  return [...new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean))];
}

function uniqueText(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeEnv(value?: string) {
  const next = value?.trim().replace(/^["']|["']$/g, "");
  if (!next || next.toLowerCase().includes("change_me")) return null;
  return next;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
