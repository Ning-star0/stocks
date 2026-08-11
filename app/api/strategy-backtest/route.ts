import { z } from "zod";

import { getCurrentUser } from "@/lib/currentUser";
import { apiError, AppError } from "@/lib/errors";
import { focusSymbolBase, focusSymbolVariants } from "@/lib/focus/symbols";
import { prisma } from "@/lib/prisma";
import { readRequestJson } from "@/lib/serverApi";
import { getQuotesBatch } from "@/lib/services/quoteService";
import { getStockDataProvider } from "@/lib/stock-data";
import { compareBacktestPresets, summarizeBacktestComparisons } from "@/lib/strategy/backtest";
import { saveStrategyHealthGates } from "@/lib/strategy/gate";
import { toNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = z.object({
  symbols: z.array(z.string().trim().min(1).max(20).transform((value) => value.toUpperCase())).min(1).max(8),
  range: z.enum(["1y", "2y"]).default("2y"),
  initialCapital: z.coerce.number().min(1000).max(100000000)
});

export async function GET() {
  try {
    const user = await getCurrentUser();
    const [items, focus] = await Promise.all([
      prisma.watchlistItem.findMany({
        where: { watchlist: { userId: user.id } },
        select: { symbol: true, isHolding: true },
        orderBy: { createdAt: "asc" }
      }),
      prisma.focusGroup.findUnique({ where: { userId: user.id }, select: { symbols: true, capital: true } })
    ]);
    const symbols = [...new Set(items.map((item) => item.symbol.toUpperCase()))];
    const focused = new Set((focus?.symbols ?? []).map(focusSymbolBase));
    const quotes = symbols.length ? await getQuotesBatch(symbols, { cacheOnly: true, allowStale: true }) : {};
    const defaults = symbols.filter((symbol) => focused.has(focusSymbolBase(symbol))).slice(0, 3);
    return Response.json({
      instruments: items.map((item) => {
        const quote = quotes[item.symbol] ?? quotes[focusSymbolVariants(item.symbol).find((variant) => quotes[variant]) ?? item.symbol];
        return { symbol: item.symbol, name: quote?.name ?? null, isHolding: item.isHolding, isFocused: focused.has(focusSymbolBase(item.symbol)) };
      }),
      defaults: {
        symbols: defaults.length ? defaults : symbols.slice(0, 1),
        range: "2y",
        initialCapital: Math.max(1000, toNumber(focus?.capital) ?? 100000)
      }
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    const input = requestSchema.parse(await readRequestJson(request));
    const items = await prisma.watchlistItem.findMany({
      where: { watchlist: { userId: user.id } },
      select: { symbol: true }
    });
    const allowed = new Set(items.map((item) => focusSymbolBase(item.symbol)));
    const disallowed = input.symbols.filter((symbol) => !allowed.has(focusSymbolBase(symbol)));
    if (disallowed.length) throw new AppError("BAD_REQUEST", `回测只能选择自选股：${disallowed.join("、")}`);

    const provider = getStockDataProvider();
    const comparisons = [];
    for (const symbol of input.symbols) {
      const candles = await provider.getHistory(symbol, input.range, "1d");
      comparisons.push(compareBacktestPresets({ symbol, candles, initialCapital: input.initialCapital, range: input.range, includeRollingGate: true }));
    }
    await saveStrategyHealthGates({ userId: user.id, capital: input.initialCapital, comparisons });
    return Response.json({ generatedAt: new Date().toISOString(), portfolioSummary: summarizeBacktestComparisons(comparisons), comparisons });
  } catch (error) {
    return apiError(error);
  }
}
