import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/currentUser";
import { apiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { serializeWatchlistItem } from "@/lib/serializers";
import { getQuotesBatch } from "@/lib/services/quoteService";
import { stockSymbolVariants } from "@/lib/symbols";

export async function GET() {
  try {
    const user = await getCurrentUser();
    const watchlists = await prisma.watchlist.findMany({
      where: { userId: user.id },
      include: {
        items: {
          orderBy: { createdAt: "asc" }
        }
      },
      orderBy: { createdAt: "asc" }
    });
    const symbols = [...new Set(watchlists.flatMap((watchlist) => watchlist.items.map((item) => item.symbol)))];
    const [quotes, latestAnalyses] = await Promise.all([
      getQuotesBatch(symbols, { allowStale: true }),
      loadLatestAnalyses(user.id, symbols)
    ]);

    const enrichedWatchlists = watchlists.map((watchlist) => ({
      ...watchlist,
      items: watchlist.items.map((item) => ({
        ...serializeWatchlistItem(item),
        quote: quotes[item.symbol] ?? null,
        quoteError: quotes[item.symbol]?.error ?? null,
        latestAnalysis: latestAnalyses[item.symbol] ?? null
      }))
    }));

    return NextResponse.json({ user: { id: user.id, email: user.email }, watchlists: enrichedWatchlists });
  } catch (error) {
    return apiError(error);
  }
}

async function loadLatestAnalyses(userId: string, symbols: string[]) {
  const variants = [...new Set(symbols.flatMap(stockSymbolVariants))];
  const analyses = await prisma.aiAnalysis.findMany({
    where: { userId, symbol: { in: variants } },
    orderBy: { createdAt: "desc" },
    take: Math.max(20, symbols.length * 5)
  });
  const output: Record<string, { id: string; createdAt: Date; outputJson: unknown } | null> = Object.fromEntries(symbols.map((symbol) => [symbol, null]));
  for (const symbol of symbols) {
    const match = analyses.find((analysis) => stockSymbolVariants(symbol).includes(analysis.symbol));
    if (!match) continue;
    output[symbol] = {
      id: match.id,
      createdAt: match.createdAt,
      outputJson: match.outputJson
    };
  }
  return output;
}
