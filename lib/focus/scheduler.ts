import { enqueueJob } from "@/lib/jobs/enqueueJob";
import { createAnalysisRun } from "@/lib/analysis/runRecords";
import { invalidateDashboardCache } from "@/lib/dashboardCache";
import { JOB_PRIORITY, JOB_TYPES } from "@/lib/jobs/jobTypes";
import { buildSectorNewsKeywords, buildStockNewsKeywords, isLowValueMarketMoveNews, resolveSharedSectorTopic, scoreNewsCatalyst } from "@/lib/news/relevance";
import { upsertNewsItem } from "@/lib/news/store";
import type { NewsItem } from "@/lib/types";
import { getNewsProvider } from "@/lib/news";
import { createNewsRequestContext } from "@/lib/news/NewsProvider";
import { createNewsBatchContext, searchSharedTopicNews } from "@/lib/news/batchCoordinator";
import { loadStoredIndustryClassifications } from "@/lib/news/industryClassification";
import { calculateNewsImportance } from "@/lib/news/importance";
import { isMarketTradingDay, nextMarketScheduledTime } from "@/lib/marketCalendar";
import { prisma } from "@/lib/prisma";
import { getQuotesBatch } from "@/lib/services/quoteService";
import { searchRelatedNews } from "@/lib/news/webSearch";

export async function checkFocusSchedules() {
  try {
    const now = new Date();
    if (!isMarketTradingDay(now)) return;

    const groups = await prisma.focusGroup.findMany({
      where: { symbols: { isEmpty: false } }
    });

    for (const group of groups) {
      const symbols = normalizeFocusSymbols(group.symbols);
      // 先刷新行情
      let symbolNames: Record<string, string | null> = {};
      try {
        const quotes = await getQuotesBatch(symbols, { cacheOnly: false, forceRefresh: true, allowStale: true });
        symbolNames = Object.fromEntries(symbols.map((symbol) => [symbol, quotes[symbol]?.name?.trim() || null]));
      } catch { /* 行情刷新失败不阻塞后续 */ }

      // 新闻抓取时间：真正抓新闻入库
      const newsDue = isScheduledTimeDue(group.newsFetchTime, group.lastNewsFetch, now);
      if (newsDue) await refreshFocusNews(group.id, group.userId, symbols, symbolNames, now);

      // AI 分析时间点：入队分析任务
      const dueAnalysisTime = dueScheduledTime(group.analysisTimes, group.lastAnalysis, now);
      if (dueAnalysisTime) {
        if (!newsDue && shouldRefreshNewsBeforeAnalysis(group.newsFetchTime, group.lastNewsFetch, dueAnalysisTime, now)) {
          await refreshFocusNews(group.id, group.userId, symbols, symbolNames, now);
        }
        const run = await createAnalysisRun({
          userId: group.userId,
          runType: "scheduled",
          totalSymbols: symbols.length,
          nextRunAt: nextMarketScheduledTime(group.analysisTimes, now)
        });
        const batchJob = await enqueueJob({
          userId: group.userId,
          jobType: JOB_TYPES.FOCUS_STOCK_BATCH,
          priority: JOB_PRIORITY.SCHEDULED_REFRESH,
          inputHash: `focus_stock_batch:${group.id}:${formatDateKey(now)}:${dueAnalysisTime}`,
          payload: { reason: `关注板块定时分析 ${dueAnalysisTime}`, runId: run.id, symbols, scheduledFor: now.toISOString() }
        }).catch(() => {});
        if (batchJob) {
          await enqueueJob({
            userId: group.userId,
            jobType: JOB_TYPES.FOCUS_DECISION,
            priority: JOB_PRIORITY.FOCUS_DECISION,
            inputHash: `focus_decision:${group.id}:${formatDateKey(now)}:${dueAnalysisTime}`,
            payload: { reason: `关注板块定时策略观察 ${dueAnalysisTime}`, scheduledFor: now.toISOString(), runId: run.id }
          }).catch(() => {});
        }
        if (batchJob) {
          await prisma.focusGroup.update({
            where: { id: group.id },
            data: { lastAnalysis: now }
          });
        } else {
          await prisma.analysisRun.update({
            where: { id: run.id },
            data: { status: "failed", finishedAt: new Date(), errorSummary: "定时批量分析任务入队失败" }
          }).catch(() => null);
        }
      }
    }
  } catch {
    // 调度检查失败不影响 worker 主循环
  }
}

async function refreshFocusNews(groupId: string, userId: string, symbols: string[], symbolNames: Record<string, string | null>, now: Date) {
  await fetchAndStoreNewsForSymbols(userId, symbols, symbolNames);
  await prisma.focusGroup.update({
    where: { id: groupId },
    data: { lastNewsFetch: now }
  });
  await invalidateDashboardCache(userId);
}

// 抓取新闻并存入 DB
async function fetchAndStoreNewsForSymbols(userId: string, symbols: string[], symbolNames: Record<string, string | null>) {
  const provider = getNewsProvider();
  const to = new Date();
  const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const fetched: NewsItem[] = [];
  const industryClassifications = await loadStoredIndustryClassifications({ userId, symbols, asOf: to });
  const newsBatch = createNewsBatchContext(undefined, industryClassifications);

  for (const symbol of symbols) {
    try {
      const name = symbolNames[symbol] ?? null;
      const industryClassification = industryClassifications.get(symbol.toUpperCase()) ?? null;
      const industryName = industryClassification?.status === "verified" ? industryClassification.industryName : null;
      const context = createNewsRequestContext({ userId, symbol, priority: "routine", requestBatchId: newsBatch.id });
      const keywords = buildStockNewsKeywords({ symbol, name });
      const sectorKeywords = buildSectorNewsKeywords({ symbol, name, extraKeywords: [...(industryName ? [industryName] : []), ...keywords] });

      const codeNews = await provider.searchCompanyNews(symbol, from.toISOString(), to.toISOString(), context);
      const relevantCodeNews = codeNews
        .filter((item) => !isLowValueMarketMoveNews(item))
        .sort((a, b) => scoreNewsCatalyst(b, sectorKeywords) - scoreNewsCatalyst(a, keywords));
      fetched.push(...relevantCodeNews.map((item) => attachSymbol(item, symbol, industryName)));

      const topicKeywords = sectorKeywords.filter((kw) => !/^\d+$/.test(kw)).slice(0, 5);
      if (topicKeywords.length) {
        const sharedTopic = resolveSharedSectorTopic(topicKeywords, industryClassification);
        const topicNews = sharedTopic
          ? await searchSharedTopicNews({
              batch: newsBatch,
              key: sharedTopic.key,
              context,
              load: () => provider.searchTopicNews(sharedTopic.keywords, from.toISOString(), to.toISOString(), context)
            })
          : await provider.searchTopicNews(topicKeywords, from.toISOString(), to.toISOString(), context);
        const relevant = topicNews.filter((item) => !isLowValueMarketMoveNews(item));
        fetched.push(...relevant.map((item) => attachSymbol(item, symbol, industryName)));
      }

      // 新闻源结果不足时才允许联网检索补充，默认关闭，避免 Tavily 产生不可预期消耗。
      if (enableNewsWebSearch() && fetched.filter((item) => item.symbols?.includes(symbol)).length < 3) {
        try {
          const webResults = await searchRelatedNews({
            symbol, name, sectorKeywords, days: 7, maxResults: 5, context
          });
          fetched.push(...webResults.results.map((item) => attachSymbol(item, symbol, industryName)));
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

function attachSymbol(item: NewsItem, symbol: string, sectorName?: string | null): NewsItem {
  return {
    ...item,
    symbols: [...new Set([...(item.symbols ?? []), symbol].map((s) => s.trim().toUpperCase()).filter(Boolean))],
    sectors: [...new Set([...(item.sectors ?? []), ...(sectorName ? [sectorName] : [])].map((value) => value.trim()).filter(Boolean))]
  };
}

function normalizeFocusSymbols(symbols: string[]) {
  return [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
}

function isScheduledTimeDue(time: string | null, lastRun: Date | null, now: Date) {
  if (!time) return false;
  const scheduledAt = todayAt(time, now);
  if (!scheduledAt || now < scheduledAt) return false;
  return !lastRun || lastRun < scheduledAt;
}

function shouldRefreshNewsBeforeAnalysis(newsFetchTime: string | null, lastNewsFetch: Date | null, analysisTime: string, now: Date) {
  const newsAt = todayAt(newsFetchTime ?? "09:30", now);
  const analysisAt = todayAt(analysisTime, now);
  if (!newsAt || !analysisAt || newsAt > analysisAt || now < newsAt) return false;
  return !lastNewsFetch || lastNewsFetch < newsAt;
}

function dueScheduledTime(times: string[], lastRun: Date | null, now: Date) {
  const due = times
    .map((time) => ({ time, date: todayAt(time, now) }))
    .filter((item): item is { time: string; date: Date } => Boolean(item.date) && now >= (item.date as Date) && (!lastRun || lastRun < (item.date as Date)))
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  return due[0]?.time ?? null;
}

function todayAt(time: string, now: Date) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return null;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
}

function formatDateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function enableNewsWebSearch() {
  return /^(1|true|yes|on)$/i.test(String(process.env.ENABLE_NEWS_WEB_SEARCH ?? ""));
}
