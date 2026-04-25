import { NextResponse } from "next/server";

import { deleteCache } from "@/lib/cache";
import { getCurrentUser } from "@/lib/currentUser";
import { apiError } from "@/lib/errors";
import { enqueueJob } from "@/lib/jobs/enqueueJob";
import { JOB_PRIORITY, JOB_TYPES } from "@/lib/jobs/jobTypes";
import { getNewsProvider } from "@/lib/news";
import { calculateNewsImportance } from "@/lib/news/importance";
import { serializeNewsItem, upsertNewsItem } from "@/lib/news/store";
import { prisma } from "@/lib/prisma";
import { getQuote } from "@/lib/services/quoteService";
import type { NewsItem } from "@/lib/types";

export async function POST() {
  try {
    const user = await getCurrentUser();
    const provider = getNewsProvider();
    const to = new Date();
    const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [watchlistItems, sectorWatches] = await Promise.all([
      prisma.watchlistItem.findMany({
        where: { watchlist: { userId: user.id } },
        select: { symbol: true }
      }),
      prisma.sectorWatch.findMany({
        where: { userId: user.id }
      })
    ]);

    const symbols = [...new Set(watchlistItems.map((item) => item.symbol))];
    const fetched: NewsItem[] = [];

    for (const symbol of symbols) {
      fetched.push(...(await provider.searchCompanyNews(symbol, from.toISOString(), to.toISOString())));
      const name = await resolveSymbolName(symbol);
      if (name) {
        const namedNews = await provider.searchTopicNews([name], from.toISOString(), to.toISOString());
        fetched.push(...namedNews.map((item) => attachSymbol(item, symbol, name)));
      }
    }

    for (const watch of sectorWatches) {
      const topicNews = await provider.searchTopicNews(watch.keywords, from.toISOString(), to.toISOString());
      fetched.push(...topicNews.map((item) => attachSectorWatch(item, watch.sectorName, watch.keywords, watch.symbols)));
    }

    const savedById = new Map<string, Awaited<ReturnType<typeof upsertNewsItem>>>();
    for (const item of fetched) {
      const row = await upsertNewsItem(item);
      const importance = calculateNewsImportance({ ...item, symbols: row.symbols }, symbols);
      const updated = await prisma.newsItem.update({
        where: { id: row.id },
        data: { importance: importance.level }
      });
      savedById.set(updated.id, updated);
    }
    const saved = [...savedById.values()];

    const queued = [];
    for (const item of saved) {
      const importance = calculateNewsImportance(item, symbols);
      if (importance.level !== "high") continue;
      const existing = await prisma.newsAnalysis.findFirst({ where: { newsItemId: item.id } });
      if (existing) continue;
      queued.push(
        await enqueueJob({
          userId: user.id,
          symbol: item.symbols[0] ?? null,
          jobType: JOB_TYPES.NEWS_ANALYSIS,
          priority: JOB_PRIORITY.HIGH_IMPORTANCE_NEWS,
          inputHash: `news:${item.id}`,
          payload: { newsItemId: item.id, reason: "high_importance_news" }
        })
      );
    }

    const affectedSymbols = new Set(symbols);
    for (const item of saved) {
      for (const symbol of item.symbols) affectedSymbols.add(symbol);
    }
    await Promise.all(
      [...affectedSymbols].flatMap((symbol) => [
        deleteCache(`news:${symbol}:24h`),
        deleteCache(`news:${symbol}:all`),
        deleteCache(`news:v2:${symbol}:24h`),
        deleteCache(`news:v2:${symbol}:all`)
      ])
    );

    return NextResponse.json({
      fetched: fetched.length,
      saved: saved.length,
      queued: queued.length,
      news: saved.map(serializeNewsItem)
    });
  } catch (error) {
    return apiError(error);
  }
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

function attachSymbol(item: NewsItem, symbol: string, sectorName?: string): NewsItem {
  return {
    ...item,
    symbols: uniqueUpper([...(item.symbols ?? []), symbol]),
    sectors: uniqueText([...(item.sectors ?? []), ...(sectorName ? [sectorName] : [])])
  };
}

function attachSectorWatch(item: NewsItem, sectorName: string, keywords: string[], symbols: string[]): NewsItem {
  return {
    ...item,
    symbols: uniqueUpper([...(item.symbols ?? []), ...symbols]),
    sectors: uniqueText([...(item.sectors ?? []), sectorName, ...keywords])
  };
}

function uniqueUpper(values: string[]) {
  return [...new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean))];
}

function uniqueText(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
