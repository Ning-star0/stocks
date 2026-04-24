import { NextResponse } from "next/server";

import { getCache } from "@/lib/cache";
import { getCurrentUser } from "@/lib/currentUser";
import { apiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { serializeAlert, serializeWatchlistItem } from "@/lib/serializers";
import { getQuoteProviderInfo, getQuotesBatch } from "@/lib/services/quoteService";

export async function GET() {
  try {
    const user = await getCurrentUser();
    const watchlists = await prisma.watchlist.findMany({
      where: { userId: user.id },
      include: { items: { orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "asc" }
    });
    const items = watchlists.flatMap((watchlist) => watchlist.items);
    const symbols = [...new Set(items.map((item) => item.symbol))].slice(0, numberEnv("MAX_BATCH_SYMBOLS", 50));

    const [alerts, highImpactNews] = await Promise.all([
      prisma.alert.findMany({ where: { userId: user.id, isActive: true }, orderBy: { createdAt: "desc" }, take: 20 }),
      prisma.newsItem.findMany({
        where: { importance: "high", symbols: { hasSome: symbols } },
        orderBy: { publishedAt: "desc" },
        take: 10
      })
    ]);

    const quotes = await getQuotesBatch(symbols, { cacheOnly: true, allowStale: true });
    const latestAnalyses: Record<string, unknown> = {};
    for (const symbol of symbols) {
      const cachedAnalysis = await getCache<unknown>(`latest_analysis:${symbol}`);
      if (cachedAnalysis) {
        latestAnalyses[symbol] = cachedAnalysis;
      } else {
        const latest = await prisma.aiAnalysis.findFirst({
          where: { userId: user.id, symbol },
          orderBy: { createdAt: "desc" }
        });
        latestAnalyses[symbol] = latest ? { id: latest.id, createdAt: latest.createdAt, outputJson: latest.outputJson } : null;
      }
    }

    return NextResponse.json({
      user: { id: user.id, email: user.email },
      watchlist: watchlists.flatMap((watchlist) => watchlist.items.map(serializeWatchlistItem)),
      quotes,
      latestAnalyses,
      dataSource: getQuoteProviderInfo(),
      watchlists: watchlists.map((watchlist) => ({
        ...watchlist,
        items: watchlist.items.map((item) => ({
          ...serializeWatchlistItem(item),
          quote: quotes[item.symbol] ?? null,
          latestAnalysis: latestAnalyses[item.symbol] ?? null
        }))
      })),
      activeAlerts: alerts.map(serializeAlert),
      highImpactNews,
      recentHighImpactNews: highImpactNews
    });
  } catch (error) {
    return apiError(error);
  }
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
