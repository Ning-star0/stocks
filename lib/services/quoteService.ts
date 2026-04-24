import { prisma } from "@/lib/prisma";
import { getStockDataProvider } from "@/lib/stock-data";
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
};

export async function getQuote(symbol: string, options: GetQuoteOptions = {}): Promise<QuoteWithStatus> {
  const normalized = symbol.toUpperCase();
  const cacheKey = `quote:${normalized}`;
  const cached = await readQuoteCache(cacheKey);

  if (cached?.fresh) return toQuoteWithStatus(cached.quote, "cached");
  if (options.cacheOnly) {
    if (options.allowStale && cached?.quote) return toQuoteWithStatus(cached.quote, "stale");
    if (options.allowStale) {
      const snapshot = await readLatestSnapshot(normalized);
      if (snapshot) return snapshot;
    }
    return unavailableQuote(normalized, cached?.quote ? "stale" : "unavailable");
  }

  try {
    const quote = await getStockDataProvider().getQuote(normalized);
    await writeQuoteCache(cacheKey, quote);
    return toQuoteWithStatus(quote, "normal");
  } catch (error) {
    if (options.allowStale && cached?.quote) return toQuoteWithStatus(cached.quote, "stale", errorMessage(error));
    if (options.allowStale) {
      const snapshot = await readLatestSnapshot(normalized);
      if (snapshot) return { ...snapshot, error: errorMessage(error) };
    }
    return unavailableQuote(normalized, "error", errorMessage(error));
  }
}

export async function getQuotesBatch(symbols: string[], options: GetQuoteOptions = {}) {
  const output: Record<string, QuoteWithStatus> = {};
  for (const symbol of [...new Set(symbols.map((item) => item.toUpperCase()))].slice(0, numberEnv("MAX_BATCH_SYMBOLS", 50))) {
    output[symbol] = await getQuote(symbol, options);
  }
  return output;
}

export function getQuoteProviderInfo() {
  const provider = process.env.STOCK_DATA_PROVIDER?.toLowerCase() || "mock";
  return {
    quoteProvider: provider,
    isMock: provider === "mock"
  };
}

async function readQuoteCache(key: string) {
  try {
    const row = await prisma.cacheEntry.findUnique({ where: { key } });
    if (!row) return null;
    return {
      quote: row.value as unknown as Quote,
      fresh: row.expiresAt.getTime() > Date.now()
    };
  } catch {
    return null;
  }
}

async function writeQuoteCache(key: string, quote: Quote) {
  const expiresAt = new Date(Date.now() + numberEnv("QUOTE_CACHE_TTL_SECONDS", 30) * 1000);
  await prisma.cacheEntry
    .upsert({
      where: { key },
      update: { value: JSON.parse(JSON.stringify(quote)), expiresAt },
      create: { key, value: JSON.parse(JSON.stringify(quote)), expiresAt }
    })
    .catch(() => undefined);
}

async function readLatestSnapshot(symbol: string): Promise<QuoteWithStatus | null> {
  try {
    const row = await prisma.priceSnapshot.findFirst({
      where: { symbol },
      orderBy: { timestamp: "desc" }
    });
    if (!row) return null;
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
      status: "stale",
      isMock: getQuoteProviderInfo().isMock,
      raw: null
    };
  } catch {
    return null;
  }
}

function toQuoteWithStatus(quote: Quote, status: QuoteStatus, error?: string): QuoteWithStatus {
  return {
    symbol: quote.symbol,
    name: quote.name ?? null,
    price: quote.price ?? null,
    changePct: quote.changePercent ?? null,
    volume: quote.volume ?? null,
    currency: normalizeCurrency(quote.currency),
    market: inferMarket(quote.symbol, quote.currency),
    updatedAt: quote.timestamp ?? null,
    source: getQuoteProviderInfo().quoteProvider,
    status,
    error,
    isMock: getQuoteProviderInfo().isMock,
    raw: quote
  };
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

function normalizeCurrency(value?: string): "USD" | "CNY" | "HKD" {
  if (value === "USD" || value === "CNY" || value === "HKD") return value;
  return value?.toUpperCase() === "HKD" ? "HKD" : inferCurrency("");
}

function inferCurrency(symbol: string): "USD" | "CNY" | "HKD" {
  if (symbol.endsWith(".HK")) return "HKD";
  if (/^\d{6}(\.(SH|SZ|BJ))?$/.test(symbol)) return "CNY";
  return process.env.STOCK_DATA_PROVIDER === "a_share" ? "CNY" : "USD";
}

function inferMarket(symbol: string, currency?: string): "US" | "CN" | "HK" {
  if (currency === "HKD" || symbol.endsWith(".HK")) return "HK";
  if (currency === "CNY" || /^\d{6}(\.(SH|SZ|BJ))?$/.test(symbol)) return "CN";
  return "US";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "行情请求失败。";
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
