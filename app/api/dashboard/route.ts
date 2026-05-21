import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { Prisma as PrismaSql } from "@prisma/client";

import { getCurrentUser } from "@/lib/currentUser";
import { apiError } from "@/lib/errors";
import { MARKET_INDICES } from "@/lib/marketIndices";
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
      symbols.length
        ? prisma.newsItem.findMany({
            where: { importance: { in: ["high", "medium"] }, symbols: { hasSome: symbols } },
            select: {
              id: true,
              title: true,
              url: true,
              source: true,
              publishedAt: true,
              summary: true,
              symbols: true,
              sectors: true,
              sentiment: true,
              importance: true,
              createdAt: true
            },
            orderBy: [{ importance: "asc" }, { publishedAt: "desc" }],
            take: 20
          })
        : Promise.resolve([])
    ]);

    const marketIndexSymbols = MARKET_INDICES.map((item) => item.symbol);
    const [quotes, marketQuotes] = await Promise.all([
      getQuotesBatch(symbols, { cacheOnly: true, allowStale: true }),
      getQuotesBatch(marketIndexSymbols, { cacheOnly: true, allowStale: true })
    ]);
    const latestAnalyses = await loadLatestAnalyses(user.id, symbols);

    return NextResponse.json({
      user: { id: user.id, email: user.email },
      watchlist: watchlists.flatMap((watchlist) => watchlist.items.map(serializeWatchlistItem)),
      quotes,
      marketIndices: MARKET_INDICES.map((item) => ({
        ...item,
        quote: marketQuotes[item.symbol] ?? null
      })),
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

async function loadLatestAnalyses(userId: string, symbols: string[]) {
  const output: Record<string, unknown> = Object.fromEntries(symbols.map((symbol) => [symbol, null]));
  if (!symbols.length) return output;

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      symbol: string;
      createdAt: Date;
      outputJson: Prisma.JsonValue;
    }>
  >(PrismaSql.sql`
    SELECT DISTINCT ON ("symbol") "id", "symbol", "createdAt", "outputJson"
    FROM "AiAnalysis"
    WHERE "userId" = ${userId}
      AND "symbol" IN (${PrismaSql.join(symbols)})
    ORDER BY "symbol", "createdAt" DESC
  `);

  for (const row of rows) {
    output[row.symbol] = {
      id: row.id,
      createdAt: row.createdAt,
      outputJson: row.outputJson
    };
  }
  return output;
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
