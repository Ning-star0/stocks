import { createHash } from "node:crypto";

import { generateNewsSearchQueries } from "@/lib/ai/generateNewsSearchQueries";
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
  rawResultCount: number;
  filteredResultCount: number;
  results: NewsItem[];
};

type TavilyTopic = "finance" | "general" | "news";

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
  if (!queries.length) {
    return {
      provider: "news_provider",
      status: "没有可用搜索关键词",
      queries,
      rawResultCount: 0,
      filteredResultCount: 0,
      results: []
    };
  }

  if (normalizeEnv(process.env.TAVILY_API_KEY)) {
    try {
      const tavily = await searchTavilyNews(input, queries);
      if (tavily.results.length) {
        return {
          provider: "tavily",
          status: buildTavilyStatus(tavily.rawResultCount, tavily.filteredResultCount, tavily.results.length),
          queries,
          rawResultCount: tavily.rawResultCount,
          filteredResultCount: tavily.filteredResultCount,
          results: tavily.results
        };
      }
      const aiQueries = await generateNewsSearchQueries(input);
      const extraQueries = aiQueries.filter((query) => !queries.includes(query)).slice(0, 4);
      if (extraQueries.length) {
        const aiTavily = await searchTavilyNews(input, extraQueries);
        if (aiTavily.results.length) {
          return {
            provider: "tavily",
            status: `第一轮 Tavily 未命中；AI 生成搜索词后二次搜索：${buildTavilyStatus(aiTavily.rawResultCount, aiTavily.filteredResultCount, aiTavily.results.length)}`,
            queries: [...queries, ...extraQueries],
            rawResultCount: tavily.rawResultCount + aiTavily.rawResultCount,
            filteredResultCount: aiTavily.filteredResultCount,
            results: aiTavily.results
          };
        }
      }
      return {
        provider: "tavily",
        status: `Tavily 原始命中 ${tavily.rawResultCount} 条，AI 二次搜索仍未命中`,
        queries: [...queries, ...extraQueries],
        rawResultCount: tavily.rawResultCount,
        filteredResultCount: 0,
        results: []
      };
    } catch (error) {
      const fallback = await searchViaConfiguredNewsProvider(input, queries);
      return {
        provider: "news_provider",
        status: `Tavily 调用失败，已回退到 ${process.env.NEWS_PROVIDER || "news provider"}：${error instanceof Error ? error.message : "未知错误"}`,
        queries,
        rawResultCount: fallback.rawResultCount,
        filteredResultCount: fallback.results.length,
        results: fallback.results
      };
    }
  }

  const fallbackResults = await searchViaConfiguredNewsProvider(input, queries);
  return {
    provider: "news_provider",
    status: `未配置 TAVILY_API_KEY，已使用 ${process.env.NEWS_PROVIDER || "news provider"} 搜索`,
    queries,
    rawResultCount: fallbackResults.rawResultCount,
    filteredResultCount: fallbackResults.results.length,
    results: fallbackResults.results
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
    output.add(`${primaryName} 研报 行业 新闻`);
  }
  if (sector) output.add(`${primaryName || compactSymbol} ${sector} 行业新闻`);
  output.add(`${compactSymbol} ${primaryName || ""} 股票 新闻`.trim());
  output.add(`${keywords.slice(0, 4).join(" ")} 最新 财经`.trim());

  return [...output].filter((item) => item.length >= 4).slice(0, numberEnv("WEB_SEARCH_MAX_QUERIES", 4));
}

async function searchTavilyNews(input: RelatedNewsSearchInput, queries: string[]) {
  const rawRows: NewsItem[] = [];
  const maxResults = input.maxResults ?? 8;

  for (const query of queries) {
    rawRows.push(...(await searchTavilyQuery(query, input, "finance")));
    if (rawRows.length >= maxResults) break;
  }

  if (rawRows.length === 0) {
    for (const query of queries.slice(0, 2)) {
      rawRows.push(...(await searchTavilyQuery(query, input, "general")));
      if (rawRows.length >= maxResults) break;
    }
  }

  const filtered = filterAndDedupe(rawRows, input);
  const results = filtered.length ? filtered : fallbackDedupe(rawRows, input);
  return {
    rawResultCount: dedupeRaw(rawRows).length,
    filteredResultCount: filtered.length,
    results: results.slice(0, maxResults)
  };
}

async function searchTavilyQuery(query: string, input: RelatedNewsSearchInput, topic: TavilyTopic) {
  const key = normalizeEnv(process.env.TAVILY_API_KEY);
  if (!key) return [];

  const cacheKey = `web_news:tavily:v3:${hash(`${topic}:${query}:${input.days ?? 30}`)}`;
  return remember(cacheKey, numberEnv("WEB_SEARCH_CACHE_TTL_SECONDS", numberEnv("NEWS_CACHE_TTL_SECONDS", 1800)), async () => {
    const body: Record<string, unknown> = {
      query,
      topic,
      search_depth: "basic",
      max_results: Math.min(10, Math.max(1, input.maxResults ?? 8)),
      include_answer: false,
      include_raw_content: false,
      include_images: false
    };

    if (topic === "news") {
      body.days = Math.max(1, Math.min(30, input.days ?? 7));
    } else {
      body.time_range = "month";
    }
    if (topic === "general") {
      body.country = "china";
    }

    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
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

  for (const query of queries.slice(0, numberEnv("WEB_SEARCH_MAX_QUERIES", 4))) {
    rows.push(...(await provider.searchTopicNews(query.split(/\s+/).filter(Boolean).slice(0, 4), from.toISOString(), to.toISOString()).catch(() => [])));
  }

  return {
    rawResultCount: dedupeRaw(rows).length,
    results: filterAndDedupe(rows.map((item) => attachInputContext(item, input)), input)
  };
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
  return normalizeOutput(relevant, input);
}

function fallbackDedupe(items: NewsItem[], input: RelatedNewsSearchInput) {
  return normalizeOutput(items, input).map((item) => ({
    ...item,
    summary: item.summary ? `${item.summary}（Tavily 原始候选，严格关键词未命中，请人工复核相关性。）` : "Tavily 原始候选，严格关键词未命中，请人工复核相关性。"
  }));
}

function normalizeOutput(items: NewsItem[], input: RelatedNewsSearchInput) {
  const seen = new Set<string>();
  const output: NewsItem[] = [];
  for (const item of items) {
    const key = (item.url || item.title).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push({
      ...attachInputContext(item, input),
      rawContent: item.rawContent ? cleanText(item.rawContent).slice(0, 800) : undefined,
      summary: item.summary ? cleanText(item.summary).slice(0, 500) : undefined
    });
  }
  return output.slice(0, input.maxResults ?? 8);
}

function dedupeRaw(items: NewsItem[]) {
  const seen = new Set<string>();
  const output: NewsItem[] = [];
  for (const item of items) {
    const key = (item.url || item.title).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function buildTavilyStatus(raw: number, filtered: number, returned: number) {
  if (filtered > 0) return `Tavily 原始命中 ${raw} 条，严格相关 ${filtered} 条，保存 ${returned} 条`;
  return `Tavily 原始命中 ${raw} 条，严格过滤 0 条，已保留 ${returned} 条候选新闻供复核`;
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
