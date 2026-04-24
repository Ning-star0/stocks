import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/currentUser";
import { remember } from "@/lib/cache";
import { apiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { serializeWatchlistItem } from "@/lib/serializers";
import { getStockDataProvider } from "@/lib/stock-data";

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

    const provider = getStockDataProvider();
    const enrichedWatchlists = await Promise.all(
      watchlists.map(async (watchlist) => {
        const items = await Promise.all(
          watchlist.items.map(async (item) => {
            const [quoteResult, latestAnalysis] = await Promise.allSettled([
              remember(`quote:${item.symbol}`, numberEnv("QUOTE_CACHE_TTL_SECONDS", 30), () => provider.getQuote(item.symbol)),
              prisma.aiAnalysis.findFirst({
                where: { userId: user.id, symbol: item.symbol },
                orderBy: { createdAt: "desc" }
              })
            ]);

            return {
              ...serializeWatchlistItem(item),
              quote: quoteResult.status === "fulfilled" ? quoteResult.value : null,
              quoteError: quoteResult.status === "rejected" ? (quoteResult.reason instanceof Error ? quoteResult.reason.message : "报价暂不可用") : null,
              latestAnalysis:
                latestAnalysis.status === "fulfilled" && latestAnalysis.value
                  ? {
                      id: latestAnalysis.value.id,
                      createdAt: latestAnalysis.value.createdAt,
                      outputJson: latestAnalysis.value.outputJson
                    }
                  : null
            };
          })
        );

        return { ...watchlist, items };
      })
    );

    return NextResponse.json({ user: { id: user.id, email: user.email }, watchlists: enrichedWatchlists });
  } catch (error) {
    return apiError(error);
  }
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
