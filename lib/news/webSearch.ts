import { createHash } from "node:crypto";

import { generateNewsSearchQueries } from "@/lib/ai/generateNewsSearchQueries";
import { remember } from "@/lib/cache";
import { AppError } from "@/lib/errors";
import { getNewsProvider } from "@/lib/news";
import {
  buildSectorNewsKeywords,
  buildStockNewsKeywords,
  cleanStockName,
  filterRelevantNewsForStock,
  isLowValueMarketMoveNews,
  scoreNewsCatalyst
} from "@/lib/news/relevance";
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
  const stockKeywords = buildStockNewsKeywords({
    symbol: input.symbol,
    name: input.name,
    extraKeywords: input.sectorKeywords ?? []
  });
  const sectorKeywords = buildSectorNewsKeywords({
    symbol: input.symbol,
    name: input.name,
    extraKeywords: [...(input.sectorKeywords ?? []), ...stockKeywords]
  });
  const compactSymbol = input.symbol.replace(/\.(SH|SZ|BJ|HK)$/i, "");
  const primaryName = input.name?.trim();
  const coreName = primaryName ? cleanStockName(primaryName) : "";
  const isFundLike = Boolean(primaryName && /(ETF|LOF|QDII|基金|指数|联接)/i.test(primaryName));
  const sector = sectorKeywords.find((item) => item.trim().length >= 2 && item !== coreName);
  const output = new Set<string>();

  for (const query of buildCatalystQueries(sectorKeywords, coreName || primaryName || "")) output.add(query);

  if (!isFundLike && primaryName && primaryName.toUpperCase() !== input.symbol.toUpperCase()) {
    output.add(`${primaryName} 公告 业绩 订单 合同`);
    output.add(`${primaryName} 行业 政策 产业链`);
    output.add(`${compactSymbol} ${primaryName} 公告 业绩`.trim());
  }
  if (sector) output.add(`${sector} 行业 政策 订单 招标 采购`);
  if (!output.size) output.add(`${stockKeywords.slice(0, 4).join(" ")} 行业 新闻`.trim());

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
      rawRows.push(...(await searchTavilyQuery(query, input, "news")));
      if (rawRows.length >= maxResults) break;
    }
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
  const keywords = buildSectorNewsKeywords({
    symbol: input.symbol,
    name: input.name,
    extraKeywords: input.sectorKeywords ?? []
  });
  const relevant = filterRelevantNewsForStock(items, {
    symbol: input.symbol,
    name: input.name,
    keywords: [...keywords, ...buildStockNewsKeywords({ symbol: input.symbol, name: input.name, extraKeywords: input.sectorKeywords ?? [] })]
  });
  const useful = relevant
    .filter((item) => !isLowValueMarketMoveNews(item))
    .sort((a, b) => scoreNewsCatalyst(b, keywords) - scoreNewsCatalyst(a, keywords));
  return normalizeOutput(useful, input);
}

function fallbackDedupe(items: NewsItem[], input: RelatedNewsSearchInput) {
  const keywords = buildSectorNewsKeywords({
    symbol: input.symbol,
    name: input.name,
    extraKeywords: input.sectorKeywords ?? []
  });
  const useful = items
    .filter((item) => !isLowValueMarketMoveNews(item))
    .sort((a, b) => scoreNewsCatalyst(b, keywords) - scoreNewsCatalyst(a, keywords));
  return normalizeOutput(useful, input).map((item) => ({
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

function buildCatalystQueries(keywords: string[], coreName: string) {
  const joined = keywords.join(" ");
  const output = new Set<string>();
  const lead = keywords.find((item) => item.length >= 2 && !/^\d+$/.test(item)) ?? coreName;

  if (joined.includes("电网") || joined.includes("特高压") || joined.includes("输变电") || joined.includes("电力设备")) {
    output.add("国家电网 招标 采购 电力设备");
    output.add("南方电网 招标 采购 配电设备");
    output.add("特高压 输变电 项目 中标 订单");
    output.add("配电网 改造 投资 电力设备");
    output.add("智能电网 设备采购 政策 投资");
  } else if (joined.includes("通信") || joined.includes("光模块") || joined.includes("5G")) {
    output.add("通信设备 招标 采购 运营商");
    output.add("光模块 算力网络 数据中心 订单");
    output.add("5G 通信设备 政策 投资");
  } else if (joined.includes("芯片") || joined.includes("半导体")) {
    output.add("半导体 政策 订单 设备 材料");
    output.add("AI芯片 算力 产业链 投资");
  } else if (joined.includes("新能源") || joined.includes("电动车") || joined.includes("动力电池")) {
    output.add("新能源汽车 销量 政策 补贴");
    output.add("动力电池 订单 扩产 产业链");
  } else if (lead) {
    output.add(`${lead} 行业 政策 投资`);
    output.add(`${lead} 订单 合同 招标 采购`);
    output.add(`${lead} 产业链 景气度 业绩`);
  }

  return [...output];
}
