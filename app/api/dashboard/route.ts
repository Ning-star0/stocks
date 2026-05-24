import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { getCache, setCache } from "@/lib/cache";
import { getCurrentUser } from "@/lib/currentUser";
import { dashboardCacheKey } from "@/lib/dashboardCache";
import { apiError } from "@/lib/errors";
import { MARKET_INDICES } from "@/lib/marketIndices";
import { prisma } from "@/lib/prisma";
import { serializeAlert, serializeWatchlistItem } from "@/lib/serializers";
import { getQuoteProviderInfo, getQuotesBatch } from "@/lib/services/quoteService";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const cacheKey = dashboardCacheKey(user.id);
    const forceRefresh = request.headers.get("x-force-refresh") === "1";
    const cached = forceRefresh ? null : await getCache<unknown>(cacheKey);
    if (cached) return dashboardResponse(cached, "HIT");

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

    const payload = {
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
    };

    await setCache(cacheKey, payload, numberEnv("DASHBOARD_CACHE_TTL_SECONDS", 30));
    return dashboardResponse(payload, "MISS");
  } catch (error) {
    return apiError(error);
  }
}

function dashboardResponse(payload: unknown, cacheStatus: "HIT" | "MISS") {
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": `private, max-age=${numberEnv("DASHBOARD_BROWSER_CACHE_SECONDS", 15)}, stale-while-revalidate=${numberEnv("DASHBOARD_BROWSER_STALE_SECONDS", 60)}`,
      "Vary": "Cookie",
      "X-Data-Cache": cacheStatus
    }
  });
}

async function loadLatestAnalyses(userId: string, symbols: string[]) {
  const output: Record<string, { id: string; createdAt: Date; outputJson: Prisma.JsonValue } | null> = Object.fromEntries(symbols.map((symbol) => [symbol, null]));
  if (!symbols.length) return output;

  const variants = [...new Set(symbols.flatMap(symbolVariants))];
  const rows = await prisma.aiAnalysis.findMany({
    where: { userId, symbol: { in: variants } },
    orderBy: { createdAt: "desc" },
    take: Math.max(20, symbols.length * 5)
  });

  for (const symbol of symbols) {
    const match = rows.find((row) => symbolVariants(symbol).includes(row.symbol));
    if (!match) continue;
    output[symbol] = {
      id: match.id,
      createdAt: match.createdAt,
      outputJson: match.outputJson
    };
  }
  return output;
}

function symbolVariants(symbol: string) {
  const normalized = symbol.toUpperCase();
  const base = normalized.replace(/\.(SH|SZ|BJ)$/, "");
  if (!/^\d{6}$/.test(base)) return [normalized];
  return [normalized, base, `${base}.SH`, `${base}.SZ`, `${base}.BJ`];
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
