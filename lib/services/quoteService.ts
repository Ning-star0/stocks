import { prisma } from "@/lib/prisma";
import { logApiUsage } from "@/lib/apiUsage";
import { getCache, setCache } from "@/lib/cache";
import { mapWithConcurrency } from "@/lib/concurrency/pLimit";
import { getStockDataProvider } from "@/lib/stock-data";
import { stockSymbolVariants } from "@/lib/symbols";
import type { Quote } from "@/lib/types";

export type QuoteStatus = "normal" | "cached" | "stale" | "unavailable" | "error";

export type QuoteWithStatus = {
  symbol: string;
  name?: string | null;
  price: number | null;
  changePct: number | null;
  volume: number | null;
  currency: "USD" | "CNY" | "HKD";
  market: "US" | "CN" | "HK";
  updatedAt: string | null;
  source: string;
  status: QuoteStatus;
  error?: string;
  isMock: boolean;
  raw?: Quote | null;
};

type GetQuoteOptions = {
  cacheOnly?: boolean;
  allowStale?: boolean;
  forceRefresh?: boolean;
};

export async function getQuote(symbol: string, options: GetQuoteOptions = {}): Promise<QuoteWithStatus> {
  const normalized = symbol.toUpperCase();
  const cacheKeys = quoteCacheKeys(normalized);
  const cacheKey = cacheKeys[0];
  const freshCached = options.forceRefresh ? null : await readFreshQuoteCache(cacheKeys);
  if (freshCached) return toQuoteWithStatus(freshCached, "cached");

  const cached = options.allowStale || options.cacheOnly ? await readQuoteCacheRows(cacheKeys) : null;
  if (options.cacheOnly) {
    if (options.allowStale && cached) return toQuoteWithStatus(cached, fallbackQuoteStatus(cached));
    if (options.allowStale) {
      const snapshot = await readLatestSnapshotForSymbols(stockSymbolVariants(normalized));
      if (snapshot) return snapshot;
    }
    return unavailableQuote(normalized, cached ? "stale" : "unavailable");
  }

  try {
    const quote = await getStockDataProvider().getQuote(normalized);
    await logApiUsage({
      provider: getQuoteProviderInfo().quoteProvider,
      apiName: "quote",
      status: "success",
      metadata: { symbol: normalized }
    });
    await writeQuoteCache(cacheKey, quote);
    return toQuoteWithStatus(quote, "normal");
  } catch (error) {
    await logApiUsage({
      provider: getQuoteProviderInfo().quoteProvider,
      apiName: "quote",
      status: "failed",
      metadata: { symbol: normalized, error: errorMessage(error) }
    });
    if (options.allowStale && cached) return toQuoteWithStatus(cached, fallbackQuoteStatus(cached), errorMessage(error));
    if (options.allowStale) {
      const snapshot = await readLatestSnapshotForSymbols(stockSymbolVariants(normalized));
      if (snapshot) return { ...snapshot, error: errorMessage(error) };
    }
    return unavailableQuote(normalized, "error", errorMessage(error));
  }
}

export async function getQuotesBatch(symbols: string[], options: GetQuoteOptions = {}) {
  const uniqueSymbols = [...new Set(symbols.map((item) => item.toUpperCase()))].slice(0, numberEnv("MAX_BATCH_SYMBOLS", 50));
  const limit = options.cacheOnly ? numberEnv("MAX_CACHE_READ_CONCURRENT", 4) : numberEnv("MAX_EXTERNAL_API_CONCURRENT", 2);
  const rows = await mapWithConcurrency(uniqueSymbols, Math.max(1, limit), async (symbol) => [symbol, await getQuote(symbol, options)] as const);
  return Object.fromEntries(rows);
}

export function getQuoteProviderInfo() {
  const provider = process.env.STOCK_DATA_PROVIDER?.toLowerCase() || "mock";
  return {
    quoteProvider: provider,
    isMock: provider === "mock"
  };
}

async function readQuoteCacheRow(key: string) {
  try {
    const row = await prisma.cacheEntry.findUnique({ where: { key } });
    return row ? (row.value as unknown as Quote) : null;
  } catch {
    return null;
  }
}

async function readFreshQuoteCache(keys: string[]) {
  for (const key of keys) {
    const quote = await getCache<Quote>(key);
    if (quote) return quote;
  }
  return null;
}

async function readQuoteCacheRows(keys: string[]) {
  for (const key of keys) {
    const quote = await readQuoteCacheRow(key);
    if (quote) return quote;
  }
  return null;
}

async function writeQuoteCache(key: string, quote: Quote) {
  await setCache(key, quote, numberEnv("QUOTE_CACHE_TTL_SECONDS", 30));
}

async function readLatestSnapshotForSymbols(symbols: string[]): Promise<QuoteWithStatus | null> {
  try {
    const row = await prisma.priceSnapshot.findFirst({
      where: { symbol: { in: symbols } },
      orderBy: { timestamp: "desc" }
    });
    if (!row) return null;
    const symbol = row.symbol;
    const price = Number(row.price);
    const close = Number(row.close);
    const changePct = close > 0 ? Number((((price - close) / close) * 100).toFixed(2)) : null;
    return {
      symbol,
      price,
      changePct,
      volume: Number(row.volume),
      currency: inferCurrency(symbol),
      market: inferMarket(symbol),
      updatedAt: row.timestamp.toISOString(),
      source: getQuoteProviderInfo().quoteProvider,
      status: fallbackTimestampStatus(row.timestamp),
      isMock: getQuoteProviderInfo().isMock,
      raw: null
    };
  } catch {
    return null;
  }
}

function quoteCacheKeys(symbol: string) {
  return stockSymbolVariants(symbol).map((item) => `quote:${item}`);
}

function toQuoteWithStatus(quote: Quote, status: QuoteStatus, error?: string): QuoteWithStatus {
  return {
    symbol: quote.symbol,
    name: quote.name ?? null,
    price: quote.price ?? null,
    changePct: quote.changePercent ?? null,
    volume: quote.volume ?? null,
    currency: normalizeCurrency(quote.currency, quote.symbol),
    market: inferMarket(quote.symbol, quote.currency),
    updatedAt: quote.timestamp ?? null,
    source: getQuoteProviderInfo().quoteProvider,
    status,
    error,
    isMock: getQuoteProviderInfo().isMock,
    raw: quote
  };
}

function fallbackQuoteStatus(quote: Quote): QuoteStatus {
  return fallbackTimestampStatus(quote.timestamp);
}

function fallbackTimestampStatus(timestamp: string | Date | null | undefined): QuoteStatus {
  if (!timestamp) return "stale";
  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time)) return "stale";
  const ageMs = Date.now() - time;
  const graceMs = numberEnv("QUOTE_TRADE_GRACE_SECONDS", 300) * 1000;
  return ageMs >= -60_000 && ageMs <= graceMs ? "cached" : "stale";
}

function unavailableQuote(symbol: string, status: QuoteStatus, error?: string): QuoteWithStatus {
  return {
    symbol,
    price: null,
    changePct: null,
    volume: null,
    currency: inferCurrency(symbol),
    market: inferMarket(symbol),
    updatedAt: null,
    source: getQuoteProviderInfo().quoteProvider,
    status,
    error,
    isMock: getQuoteProviderInfo().isMock,
    raw: null
  };
}

function normalizeCurrency(value?: string, symbol = ""): "USD" | "CNY" | "HKD" {
  if (value === "USD" || value === "CNY" || value === "HKD") return value;
  const normalized = value?.toUpperCase();
  if (normalized === "USD" || normalized === "CNY" || normalized === "HKD") return normalized;
  return inferCurrency(symbol);
}

function inferCurrency(symbol: string): "USD" | "CNY" | "HKD" {
  if (symbol.endsWith(".HK")) return "HKD";
  if (/^\d{6}(\.(SH|SZ|BJ))?$/.test(symbol)) return "CNY";
  // A-shares are 6-digit numeric codes; everything else (letter tickers) defaults to USD
  const compact = symbol.replace(/\.(SH|SZ|BJ)$/, "");
  if (/^\d{6}$/.test(compact)) return "CNY";
  return "USD";
}

function inferMarket(symbol: string, currency?: string): "US" | "CN" | "HK" {
  const normalizedCurrency = currency?.toUpperCase();
  if (normalizedCurrency === "HKD" || symbol.endsWith(".HK")) return "HK";
  if (normalizedCurrency === "CNY" || /^\d{6}(\.(SH|SZ|BJ))?$/.test(symbol)) return "CN";
  return "US";
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "行情请求失败。";
  if (message === "fetch failed") return "行情源连接失败，已尝试使用本地缓存。";
  return message;
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
