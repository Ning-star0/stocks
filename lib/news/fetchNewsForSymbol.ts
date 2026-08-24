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
  scoreNewsCatalyst
} from "@/lib/news/relevance";
import { searchRelatedNews } from "@/lib/news/webSearch";
import { upsertNewsItem } from "@/lib/news/store";
import { prisma } from "@/lib/prisma";
import { getQuote } from "@/lib/services/quoteService";
import { needsSimplifiedChineseSummary } from "@/lib/text/simplifiedChinese";
import type { NewsItem } from "@/lib/types";

export type FetchNewsForSymbolResult = {
  symbol: string;
  completed: boolean;
  fetched: number;
  saved: number;
  filteredOut: number;
  queuedAnalysis: number;
  webSearchUsed: boolean;
  companySearchCompleted: boolean;
  topicSearchCompleted: boolean;
  failures: string[];
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
  let companySearchCompleted = false;
  let topicSearchCompleted = false;
  const failures: string[] = [];

  // 公司新闻
  try {
    const codeNews = await provider.searchCompanyNews(symbol, from.toISOString(), to.toISOString());
    const relevantCodeNews = rankUsefulNews(
      filterRelevantNewsForStock(codeNews, { symbol, name, keywords: [...keywords, ...sectorKeywords] }),
      sectorKeywords
    );
    filteredOut += codeNews.length - relevantCodeNews.length;
    fetched.push(...relevantCodeNews.map((item) => attachSymbol(item, symbol, sectorKeywords[0] ?? keywords[1] ?? name ?? symbol)));
    companySearchCompleted = true;
  } catch (error) {
    failures.push(`公司新闻检索失败：${errorMessage(error)}`);
  }

  // 主题新闻
  const topicKeywords = sectorKeywords.filter((k) => !/^\d+$/.test(k)).slice(0, 5);
  try {
    const topicNews = await provider.searchTopicNews(topicKeywords, from.toISOString(), to.toISOString());
    const relevantTopicNews = rankUsefulNews(
      filterRelevantNewsForStock(topicNews, { symbol, name, keywords: [...keywords, ...sectorKeywords] }),
      sectorKeywords
    );
    filteredOut += topicNews.length - relevantTopicNews.length;
    fetched.push(...relevantTopicNews.map((item) => attachSymbol(item, symbol, sectorKeywords[0] ?? keywords[1] ?? name ?? symbol)));
    topicSearchCompleted = true;
  } catch (error) {
    failures.push(`主题新闻检索失败：${errorMessage(error)}`);
  }

  // 新闻源结果不足时才允许联网检索补充，默认关闭，避免 Tavily 产生不可预期消耗。
  if (enableNewsWebSearch() && fetched.filter((item) => item.symbols?.includes(symbol)).length < 3) {
    try {
      const webSearch = await searchRelatedNews({
        symbol,
        name,
        sectorKeywords,
        days: 7,
        maxResults: 8
      });
      if (webSearch.results.length) webSearchUsed = true;
      fetched.push(...webSearch.results.map((item) => attachSymbol(item, symbol, sectorKeywords[0] ?? keywords[1] ?? name ?? symbol)));
    } catch (error) {
      failures.push(`联网新闻补充失败：${errorMessage(error)}`);
    }
  }

  // 存入数据库并计算重要性
  const savedById = new Map<string, Awaited<ReturnType<typeof upsertNewsItem>>>();
  const userSymbols = await loadUserSymbols(userId);

  for (const item of fetched) {
    try {
      const row = await upsertNewsItem(item);
      const importance = calculateNewsImportance({ ...item, symbols: row.symbols }, userSymbols);
      const updated = await prisma.newsItem.update({
        where: { id: row.id },
        data: { importance: importance.level }
      });
      savedById.set(updated.id, updated);
    } catch (error) {
      failures.push(`新闻保存失败：${errorMessage(error)}`);
    }
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
    try {
      await enqueueJob({
        userId,
        symbol: item.symbols[0] ?? null,
        jobType: JOB_TYPES.NEWS_ANALYSIS,
        priority: importance.level === "high" ? JOB_PRIORITY.HIGH_IMPORTANCE_NEWS : JOB_PRIORITY.SCHEDULED_REFRESH,
        inputHash: `news:${item.id}`,
        payload: { newsItemId: item.id, reason: importance.level === "high" ? "high_importance_news" : "translate_foreign_news_summary" }
      });
      queuedAnalysis += 1;
    } catch (error) {
      failures.push(`新闻精读任务入队失败：${errorMessage(error)}`);
    }
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
    completed: companySearchCompleted && topicSearchCompleted && failures.length === 0,
    fetched: fetched.length,
    saved: saved.length,
    filteredOut,
    queuedAnalysis,
    webSearchUsed,
    companySearchCompleted,
    topicSearchCompleted,
    failures: uniqueText(failures)
  };
}

function enableNewsWebSearch() {
  return /^(1|true|yes|on)$/i.test(String(process.env.ENABLE_NEWS_WEB_SEARCH ?? ""));
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}
