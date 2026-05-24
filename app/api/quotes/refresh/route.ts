import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/currentUser";
import { invalidateDashboardCache } from "@/lib/dashboardCache";
import { apiError } from "@/lib/errors";
import { MARKET_INDICES } from "@/lib/marketIndices";
import { prisma } from "@/lib/prisma";
import { getQuotesBatch } from "@/lib/services/quoteService";

export async function POST() {
  try {
    const user = await getCurrentUser();
    const watchlists = await prisma.watchlist.findMany({
      where: { userId: user.id },
      include: { items: { select: { symbol: true } } }
    });
    const watchlistSymbols = watchlists.flatMap((watchlist) => watchlist.items.map((item) => item.symbol));
    const symbols = [...new Set([...watchlistSymbols, ...MARKET_INDICES.map((item) => item.symbol)])].slice(0, numberEnv("MAX_BATCH_SYMBOLS", 50));

    if (!symbols.length) {
      return NextResponse.json({ refreshed: 0, cacheStatus: {} });
    }

    const quotes = await getQuotesBatch(symbols, { forceRefresh: true, allowStale: true });
    await invalidateDashboardCache(user.id);

    return NextResponse.json({
      refreshed: symbols.length,
      cacheStatus: Object.fromEntries(Object.entries(quotes).map(([symbol, quote]) => [symbol, quote.status]))
    });
  } catch (error) {
    return apiError(error);
  }
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
