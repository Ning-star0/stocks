import { calculateIndicators } from "@/lib/indicators";
import { setCache } from "@/lib/cache";
import { prisma } from "@/lib/prisma";
import { getStockDataProvider } from "@/lib/stock-data";
import type { IndicatorSnapshot, Quote } from "@/lib/types";

export type SymbolUpdateResult = {
  symbol: string;
  quote: Quote;
  indicators: IndicatorSnapshot;
};

export async function updateSymbolMarketData(symbol: string): Promise<SymbolUpdateResult> {
  const normalized = symbol.toUpperCase();
  const provider = getStockDataProvider();
  const [quote, history] = await Promise.all([provider.getQuote(normalized), provider.getHistory(normalized, "1y", "1d")]);
  const indicators = calculateIndicators(normalized, history);
  await setCache(`quote:${quote.symbol}`, quote, numberEnv("QUOTE_CACHE_TTL_SECONDS", 30));

  await prisma.$transaction([
    prisma.priceSnapshot.create({
      data: {
        symbol: quote.symbol,
        open: quote.open,
        high: quote.high,
        low: quote.low,
        close: quote.close,
        price: quote.price,
        volume: BigInt(quote.volume),
        timestamp: new Date(quote.timestamp)
      }
    }),
    prisma.technicalIndicator.create({
      data: {
        symbol: normalized,
        rsi14: indicators.rsi14,
        macd: indicators.macd,
        macdSignal: indicators.macdSignal,
        sma20: indicators.sma20,
        sma50: indicators.sma50,
        sma200: indicators.sma200,
        ema20: indicators.ema20,
        bollingerUpper: indicators.bollingerUpper,
        bollingerMiddle: indicators.bollingerMiddle,
        bollingerLower: indicators.bollingerLower,
        timestamp: new Date(indicators.timestamp)
      }
    })
  ]);

  return { symbol: normalized, quote, indicators };
}

export async function updateAllWatchlistMarketData() {
  const items = await prisma.watchlistItem.findMany({
    select: { symbol: true },
    distinct: ["symbol"],
    take: numberEnv("MAX_BATCH_SYMBOLS", 50)
  });

  const results: Array<{ symbol: string; ok: true; data: SymbolUpdateResult } | { symbol: string; ok: false; error: string }> = [];

  for (const item of items) {
    try {
      const data = await updateSymbolMarketData(item.symbol);
      results.push({ symbol: item.symbol, ok: true, data });
    } catch (error) {
      results.push({ symbol: item.symbol, ok: false, error: error instanceof Error ? error.message : "未知错误" });
    }
  }

  return results;
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
