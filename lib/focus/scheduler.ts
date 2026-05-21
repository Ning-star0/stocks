import { enqueueJob } from "@/lib/jobs/enqueueJob";
import { JOB_PRIORITY, JOB_TYPES } from "@/lib/jobs/jobTypes";
import { buildSectorNewsKeywords, buildStockNewsKeywords, isLowValueMarketMoveNews, scoreNewsCatalyst } from "@/lib/news/relevance";
import { upsertNewsItem } from "@/lib/news/store";
import type { NewsItem } from "@/lib/types";
import { getNewsProvider } from "@/lib/news";
import { calculateNewsImportance } from "@/lib/news/importance";
import { prisma } from "@/lib/prisma";
import { getQuotesBatch } from "@/lib/services/quoteService";
import { searchRelatedNews } from "@/lib/news/webSearch";

export async function checkFocusSchedules() {
  try {
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    const groups = await prisma.focusGroup.findMany({
      where: { symbols: { isEmpty: false } }
    });

    for (const group of groups) {
      // A 股代码统一去掉后缀，避免数据源查不到
      const symbols = group.symbols.map((s) => s.replace(/\.(SH|SZ|BJ)$/, "").toUpperCase());
      // 先刷新行情
      try {
        await getQuotesBatch(symbols, { cacheOnly: false });
      } catch { /* 行情刷新失败不阻塞后续 */ }

      // 新闻抓取时间：真正抓新闻入库
      if (group.newsFetchTime === timeStr && !sameDay(group.lastNewsFetch, now)) {
        await fetchAndStoreNewsForSymbols(group.userId, symbols);
        await prisma.focusGroup.update({
          where: { id: group.id },
          data: { lastNewsFetch: now }
        });
      }

      // AI 分析时间点：入队分析任务
      if (group.analysisTimes.includes(timeStr) && !sameTick(group.lastAnalysis, now)) {
        for (const symbol of symbols) {
          await enqueueJob({
            userId: group.userId,
            symbol,
            jobType: JOB_TYPES.STOCK_ANALYSIS,
            priority: JOB_PRIORITY.SCHEDULED_REFRESH,
            payload: { reason: `关注板块定时分析 ${timeStr}` }
          }).catch(() => {});
        }
        await prisma.focusGroup.update({
          where: { id: group.id },
          data: { lastAnalysis: now }
        });
      }
    }
  } catch {
    // 调度检查失败不影响 worker 主循环
  }
}

// 抓取新闻并存入 DB
async function fetchAndStoreNewsForSymbols(userId: string, symbols: string[]) {
  const provider = getNewsProvider();
  const to = new Date();
  const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const fetched: NewsItem[] = [];

  for (const symbol of symbols) {
    try {
      const keywords = buildStockNewsKeywords({ symbol, name: null });
      const sectorKeywords = buildSectorNewsKeywords({ symbol, name: null, extraKeywords: keywords });

      const codeNews = await provider.searchCompanyNews(symbol, from.toISOString(), to.toISOString());
      const relevantCodeNews = codeNews
        .filter((item) => !isLowValueMarketMoveNews(item))
        .sort((a, b) => scoreNewsCatalyst(b, sectorKeywords) - scoreNewsCatalyst(a, keywords));
      fetched.push(...relevantCodeNews.map((item) => attachSymbol(item, symbol)));

      const topicKeywords = sectorKeywords.filter((kw) => !/^\d+$/.test(kw)).slice(0, 5);
      if (topicKeywords.length) {
        const topicNews = await provider.searchTopicNews(topicKeywords, from.toISOString(), to.toISOString());
        const relevant = topicNews.filter((item) => !isLowValueMarketMoveNews(item));
        fetched.push(...relevant.map((item) => attachSymbol(item, symbol)));
      }

      // 联网搜索补充
      if (fetched.filter((item) => item.symbols?.includes(symbol)).length < 3) {
        try {
          const webResults = await searchRelatedNews({
            symbol, name: null, sectorKeywords, days: 7, maxResults: 5
          });
          fetched.push(...webResults.results.map((item) => attachSymbol(item, symbol)));
        } catch { /* 联网搜索可能不可用 */ }
      }
    } catch {
      // 某个 symbol 的新闻抓取失败不阻塞其他
    }
  }

  // 存入库
  for (const item of fetched) {
    try {
      const row = await upsertNewsItem(item);
      const importance = calculateNewsImportance(
        { title: item.title, source: item.source, summary: item.summary, symbols: row.symbols },
        symbols
      );
      await prisma.newsItem.update({
        where: { id: row.id },
        data: { importance: importance.level }
      });

      // 高影响新闻直接入队 AI 精读
      if (importance.level === "high") {
        const existing = await prisma.newsAnalysis.findFirst({ where: { newsItemId: row.id } });
        if (!existing) {
          await enqueueJob({
            userId,
            symbol: row.symbols[0] ?? null,
            jobType: JOB_TYPES.NEWS_ANALYSIS,
            priority: JOB_PRIORITY.HIGH_IMPORTANCE_NEWS,
            inputHash: `news:${row.id}`,
            payload: { newsItemId: row.id, reason: "scheduled_high_importance_news" }
          }).catch(() => {});
        }
      }
    } catch { /* 单条存储失败继续 */ }
  }
}

function attachSymbol(item: NewsItem, symbol: string): NewsItem {
  return {
    ...item,
    symbols: [...new Set([...(item.symbols ?? []), symbol].map((s) => s.trim().toUpperCase()).filter(Boolean))],
    sectors: item.sectors ?? []
  };
}

function sameDay(a: Date | null, b: Date) {
  if (!a) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function sameTick(a: Date | null, b: Date) {
  if (!a) return false;
  const diff = Math.abs(b.getTime() - a.getTime());
  return diff < 90_000; // 1.5 分钟内不去重
}
