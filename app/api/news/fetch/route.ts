import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/currentUser";
import { apiError } from "@/lib/errors";
import { enqueueJob } from "@/lib/jobs/enqueueJob";
import { JOB_PRIORITY, JOB_TYPES } from "@/lib/jobs/jobTypes";
import { getNewsProvider } from "@/lib/news";
import { calculateNewsImportance } from "@/lib/news/importance";
import { serializeNewsItem, upsertNewsItem } from "@/lib/news/store";
import { prisma } from "@/lib/prisma";

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
    const fetched = [];

    for (const symbol of symbols) {
      fetched.push(...(await provider.searchCompanyNews(symbol, from.toISOString(), to.toISOString())));
    }

    for (const watch of sectorWatches) {
      fetched.push(...(await provider.searchTopicNews(watch.keywords, from.toISOString(), to.toISOString())));
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
