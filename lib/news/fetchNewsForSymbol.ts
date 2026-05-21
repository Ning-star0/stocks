import { deleteCache } from "@/lib/cache";
import { enqueueJob } from "@/lib/jobs/enqueueJob";
import { JOB_PRIORITY, JOB_TYPES } from "@/lib/jobs/jobTypes";
import { getNewsProvider } from "@/lib/news";
import { calculateNewsImportance } from "@/lib/news/importance";
import {
  buildSectorNewsKeywords,
  buildStockNewsKeywords,
  filterRelevantNewsForStock,
  isLowValueMarketMoveNews,
  isNewsRelevantToStock,
  scoreNewsCatalyst
} from "@/lib/news/relevance";
import { searchRelatedNews } from "@/lib/news/webSearch";
import { serializeNewsItem, upsertNewsItem } from "@/lib/news/store";
import { prisma } from "@/lib/prisma";
import { getQuote } from "@/lib/services/quoteService";
import { needsSimplifiedChineseSummary } from "@/lib/text/simplifiedChinese";
import type { NewsItem } from "@/lib/types";

export type FetchNewsForSymbolResult = {
  symbol: string;
  fetched: number;
  saved: number;
  filteredOut: number;
  queuedAnalysis: number;
  webSearchUsed: boolean;
};

export async function fetchNewsForSymbol(symbol: string, userId: string): Promise<FetchNewsForSymbolResult> {
  const provider = getNewsProvider();
  const to = new Date();
  const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const name = await resolveSymbolName(symbol);
  const keywords = buildStockNewsKeywords({ symbol, name });
  const sectorKeywords = buildSectorNewsKeywords({ symbol, name, extraKeywords: keywords });

  const fetched: NewsItem[] = [];
  let filteredOut = 0;
  let webSearchUsed = false;

  // 公司新闻
  const codeNews = await provider.searchCompanyNews(symbol, from.toISOString(), to.toISOString());
  const relevantCodeNews = rankUsefulNews(
    filterRelevantNewsForStock(codeNews, { symbol, name, keywords: [...keywords, ...sectorKeywords] }),
    sectorKeywords
  );
  filteredOut += codeNews.length - relevantCodeNews.length;
  fetched.push(...relevantCodeNews.map((item) => attachSymbol(item, symbol, sectorKeywords[0] ?? keywords[1] ?? name ?? symbol)));

  // 主题新闻
  const topicKeywords = sectorKeywords.filter((k) => !/^\d+$/.test(k)).slice(0, 5);
  const topicNews = await provider.searchTopicNews(topicKeywords, from.toISOString(), to.toISOString());
  const relevantTopicNews = rankUsefulNews(
    filterRelevantNewsForStock(topicNews, { symbol, name, keywords: [...keywords, ...sectorKeywords] }),
    sectorKeywords
  );
  filteredOut += topicNews.length - relevantTopicNews.length;
  fetched.push(...relevantTopicNews.map((item) => attachSymbol(item, symbol, sectorKeywords[0] ?? keywords[1] ?? name ?? symbol)));

  // 新闻不足时联网搜索
  if (fetched.length === 0 || sectorKeywords.length > 0) {
    const webSearch = await searchRelatedNews({
      symbol,
      name,
      sectorKeywords,
      days: 7,
      maxResults: 8
    });
    if (webSearch.results.length) webSearchUsed = true;
    fetched.push(...webSearch.results.map((item) => attachSymbol(item, symbol, sectorKeywords[0] ?? keywords[1] ?? name ?? symbol)));
  }

  // 存入数据库并计算重要性
  const savedById = new Map<string, Awaited<ReturnType<typeof upsertNewsItem>>>();
  const userSymbols = await loadUserSymbols(userId);

  for (const item of fetched) {
    const row = await upsertNewsItem(item);
    const importance = calculateNewsImportance({ ...item, symbols: row.symbols }, userSymbols);
    const updated = await prisma.newsItem.update({
      where: { id: row.id },
      data: { importance: importance.level }
    });
    savedById.set(updated.id, updated);
  }
  const saved = [...savedById.values()];

  // 高重要性新闻入队 AI 分析
  let queuedAnalysis = 0;
  for (const item of saved) {
    const importance = calculateNewsImportance(item, userSymbols);
    const needsTranslation = importance.level === "medium" && needsSimplifiedChineseSummary(`${item.title} ${item.summary ?? ""}`);
    if (importance.level !== "high" && !needsTranslation) continue;
    const existing = await prisma.newsAnalysis.findFirst({ where: { newsItemId: item.id } });
    if (existing) continue;
    await enqueueJob({
      userId,
      symbol: item.symbols[0] ?? null,
      jobType: JOB_TYPES.NEWS_ANALYSIS,
      priority: importance.level === "high" ? JOB_PRIORITY.HIGH_IMPORTANCE_NEWS : JOB_PRIORITY.SCHEDULED_REFRESH,
      inputHash: `news:${item.id}`,
      payload: { newsItemId: item.id, reason: importance.level === "high" ? "high_importance_news" : "translate_foreign_news_summary" }
    });
    queuedAnalysis += 1;
  }

  // 清除缓存
  const cacheKeys = [symbol, ...userSymbols].flatMap((s) => [
    `news:${s}:24h`,
    `news:${s}:all`,
    `news:v2:${s}:24h`,
    `news:v2:${s}:all`
  ]);
  await Promise.all(cacheKeys.map((key) => deleteCache(key)));

  return {
    symbol,
    fetched: fetched.length,
    saved: saved.length,
    filteredOut,
    queuedAnalysis,
    webSearchUsed
  };
}

async function resolveSymbolName(symbol: string) {
  try {
    const quote = await getQuote(symbol, { allowStale: true });
    const name = quote.name?.trim();
    if (!name || name.toUpperCase() === symbol.toUpperCase()) return null;
    if (name.includes("模拟")) return null;
    return name;
  } catch {
    return null;
  }
}

async function loadUserSymbols(userId: string) {
  const items = await prisma.watchlistItem.findMany({
    where: { watchlist: { userId } },
    select: { symbol: true }
  });
  return [...new Set(items.map((item) => item.symbol))];
}

function attachSymbol(item: NewsItem, symbol: string, sectorName?: string): NewsItem {
  return {
    ...item,
    symbols: uniqueUpper([...(item.symbols ?? []), symbol]),
    sectors: uniqueText([...(item.sectors ?? []), ...(sectorName ? [sectorName] : [])])
  };
}

function rankUsefulNews(items: NewsItem[], keywords: string[]) {
  return items
    .filter((item) => !isLowValueMarketMoveNews(item))
    .sort((a, b) => scoreNewsCatalyst(b, keywords) - scoreNewsCatalyst(a, keywords));
}

function uniqueUpper(values: string[]) {
  return [...new Set(values.map((v) => v.trim().toUpperCase()).filter(Boolean))];
}

function uniqueText(values: string[]) {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}
