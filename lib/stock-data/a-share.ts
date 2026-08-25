import { AppError } from "@/lib/errors";
import { readProviderJsonResponse } from "@/lib/httpJson";
import {
  adjustTencentHistoryForCorporateActions,
  assertNoUnexplainedCorporateActionGap
} from "@/lib/stock-data/corporateActions";
import { fetchCninfoDisclosures, fetchCninfoFundamentals } from "@/lib/stock-data/cninfoEvidence";
import { fetchEastMoneyPeerValuationEvidence } from "@/lib/stock-data/peerValuationEvidence";
import type {
  Candle,
  CompanyEvidenceOptions,
  CompanyProfile,
  DisclosureEvidence,
  FundamentalEvidence,
  HistoryOptions,
  PeerValuationEvidence,
  Quote,
  StockDataProvider,
  ValuationPriceHistoryEvidence
} from "@/lib/stock-data/types";

type EastMoneyQuoteResponse = {
  rc?: number;
  data?: {
    f43?: number | "-";
    f44?: number | "-";
    f45?: number | "-";
    f46?: number | "-";
    f47?: number | "-";
    f57?: string;
    f58?: string;
    f60?: number | "-";
    f169?: number | "-";
    f170?: number | "-";
    f86?: number | "-";
  } | null;
};

type EastMoneyKlineResponse = {
  rc?: number;
  data?: {
    code?: string;
    name?: string;
    klines?: string[];
  } | null;
};

type TencentKlineResponse = {
  code?: number;
  data?: Record<string, {
    day?: string[][];
    week?: string[][];
    month?: string[][];
    m1?: string[][];
    prec?: string;
  }>;
};

export class AShareEastMoneyProvider implements StockDataProvider {
  private readonly quoteBaseUrl = "http://push2.eastmoney.com/api/qt/stock/get";
  private readonly klineBaseUrl = "http://push2his.eastmoney.com/api/qt/stock/kline/get";
  private readonly tencentQuoteBaseUrl = "https://qt.gtimg.cn/q";
  private readonly tencentKlineBaseUrl = "https://proxy.finance.qq.com/ifzqgtimg/appstock/app/kline";

  async getQuote(symbol: string): Promise<Quote> {
    const target = normalizeAShareSymbol(symbol);
    try {
      return await this.getEastMoneyQuote(target);
    } catch (error) {
      return this.getTencentFallbackQuote(target).catch(() => {
        throw error;
      });
    }
  }

  private async getEastMoneyQuote(target: ReturnType<typeof normalizeAShareSymbol>): Promise<Quote> {
    const url = new URL(this.quoteBaseUrl);
    url.searchParams.set("secid", target.secid);
    url.searchParams.set("ut", "fa5fd1943c7b386f172d6893dbfba10b");
    url.searchParams.set("fltt", "2");
    url.searchParams.set("invt", "2");
    url.searchParams.set("fields", "f43,f44,f45,f46,f47,f57,f58,f60,f169,f170,f86");

    const response = await fetch(url, {
      headers: requestHeaders(),
      next: { revalidate: 30 }
    });
    if (!response.ok) throw new AppError("DATA_PROVIDER_ERROR", `东方财富报价请求失败：${response.status}`);

    const payload = await readProviderJsonResponse<EastMoneyQuoteResponse>(response, "东方财富报价");
    const data = payload.data;
    if (!data || payload.rc !== 0) throw new AppError("SYMBOL_NOT_FOUND", `未找到 A 股代码 ${target.symbol}。`, { symbol: target.symbol });

    const price = readNumber(data.f43);
    const previousClose = readNumber(data.f60);
    if (price === null || previousClose === null) throw new AppError("SYMBOL_NOT_FOUND", `未返回 ${target.symbol} 的有效报价。`, { symbol: target.symbol });

    const open = readNumber(data.f46) ?? price;
    const high = readNumber(data.f44) ?? price;
    const low = readNumber(data.f45) ?? price;
    const change = readNumber(data.f169) ?? Number((price - previousClose).toFixed(2));
    const changePercent = readNumber(data.f170) ?? Number(((change / previousClose) * 100).toFixed(2));
    const volumeInHands = readNumber(data.f47) ?? 0;
    const timestamp = typeof data.f86 === "number" && data.f86 > 0 ? parseEastMoneyTimestamp(data.f86) : new Date().toISOString();

    return {
      symbol: target.symbol,
      name: data.f58,
      currency: "CNY",
      price,
      open,
      high,
      low,
      close: price,
      previousClose,
      change,
      changePercent,
      volume: Math.round(volumeInHands * 100),
      timestamp
    };
  }

  private async getTencentFallbackQuote(target: ReturnType<typeof normalizeAShareSymbol>): Promise<Quote> {
    const marketSymbol = tencentMarketSymbol(target);
    const response = await fetch(`${this.tencentQuoteBaseUrl}=${marketSymbol}`, {
      headers: requestHeaders(),
      cache: "no-store"
    });
    if (!response.ok) throw new AppError("DATA_PROVIDER_ERROR", `腾讯报价请求失败：${response.status}`);

    const bytes = await response.arrayBuffer();
    const text = new TextDecoder("gb18030").decode(bytes);
    const payload = text.match(/="([^"]*)"/)?.[1];
    const fields = payload?.split("~") ?? [];
    const price = readTencentNumber(fields[3]);
    const previousClose = readTencentNumber(fields[4]);
    if (!payload || price === null || price <= 0 || previousClose === null || previousClose <= 0) {
      throw new AppError("SYMBOL_NOT_FOUND", `腾讯未返回 ${target.symbol} 的有效报价。`, { symbol: target.symbol });
    }

    const open = readTencentNumber(fields[5]) || price;
    const high = readTencentNumber(fields[33]) || price;
    const low = readTencentNumber(fields[34]) || price;
    const change = readTencentNumber(fields[31]) ?? Number((price - previousClose).toFixed(3));
    const changePercent = readTencentNumber(fields[32]) ?? Number(((change / previousClose) * 100).toFixed(2));
    const volumeInHands = readTencentNumber(fields[6]) ?? 0;

    return {
      symbol: target.symbol,
      name: fields[1] || target.symbol,
      currency: "CNY",
      price,
      open,
      high,
      low,
      close: price,
      previousClose,
      change,
      changePercent,
      volume: Math.round(volumeInHands * 100),
      timestamp: parseTencentQuoteTimestamp(fields[30])
    };
  }

  async getHistory(symbol: string, range = "1y", interval = "1d", options: HistoryOptions = {}): Promise<Candle[]> {
    const target = normalizeAShareSymbol(symbol);
    const normalizedInterval = normalizeInterval(interval);
    try {
      return await this.getEastMoneyHistory(target, range, normalizedInterval, options);
    } catch (error) {
      try {
        return await this.getTencentFallbackHistory(target, range, normalizedInterval, options.adjustment ?? "forward");
      } catch (fallbackError) {
        // Data-integrity errors from the fallback are more useful than a
        // connectivity error from the preferred provider.
        if (fallbackError instanceof AppError && fallbackError.details) throw fallbackError;
        throw error;
      }
    }
  }

  async getValuationPriceHistory(symbol: string, options: HistoryOptions = {}): Promise<ValuationPriceHistoryEvidence> {
    const target = normalizeAShareSymbol(symbol);
    const fetchedAt = new Date().toISOString();
    const historyOptions = { ...options, adjustment: "none" as const };
    try {
      const candles = await this.getEastMoneyHistory(target, "5y", "1d", historyOptions);
      return {
        schemaVersion: "valuation-price-history-v1",
        status: "available",
        provider: "EASTMONEY",
        sourceUrl: this.eastMoneyHistoryUrl(target, "5y", "1d", "none").toString(),
        fetchedAt,
        adjustment: "none",
        candles,
        failure: null
      };
    } catch (preferredError) {
      try {
        const candles = await this.getTencentDailyHistory(target, "5y", "1d", "none");
        return {
          schemaVersion: "valuation-price-history-v1",
          status: "available",
          provider: "TENCENT",
          sourceUrl: this.tencentDailyHistoryUrl(target, "5y").toString(),
          fetchedAt,
          adjustment: "none",
          candles,
          failure: null
        };
      } catch (fallbackError) {
        return {
          schemaVersion: "valuation-price-history-v1",
          status: "unavailable",
          provider: "EASTMONEY_TENCENT",
          sourceUrl: "",
          fetchedAt,
          adjustment: "none",
          candles: [],
          failure: `未取得未复权历史价格：${errorMessage(preferredError)}；备用源：${errorMessage(fallbackError)}`
        };
      }
    }
  }

  async getPeerValuation(symbol: string, options: HistoryOptions = {}): Promise<PeerValuationEvidence> {
    const target = normalizeAShareSymbol(symbol);
    return fetchEastMoneyPeerValuationEvidence({ symbol: target.symbol, forceRefresh: options.forceRefresh });
  }

  private async getEastMoneyHistory(
    target: ReturnType<typeof normalizeAShareSymbol>,
    range: string,
    normalizedInterval: string,
    options: HistoryOptions
  ) {
    const adjustment = options.adjustment ?? "forward";
    const url = this.eastMoneyHistoryUrl(target, range, normalizedInterval, adjustment);

    const shouldBypassCache = options.forceRefresh || isIntraday(normalizedInterval);
    const response = await fetch(url, shouldBypassCache
      ? {
          headers: requestHeaders(),
          cache: "no-store"
        }
      : {
          headers: requestHeaders(),
          next: { revalidate: 300 }
        });
    if (!response.ok) throw new AppError("DATA_PROVIDER_ERROR", `东方财富 K 线请求失败：${response.status}`);

    const payload = await readProviderJsonResponse<EastMoneyKlineResponse>(response, "东方财富 K 线");
    const rows = payload.data?.klines;
    if (!rows?.length) throw new AppError("SYMBOL_NOT_FOUND", `未返回 ${target.symbol} 的历史行情。`, { symbol: target.symbol });

    const candles = rows.map((row) => {
      const [date, open, close, high, low, volume] = row.split(",");
      return {
        symbol: target.symbol,
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Math.round(Number(volume) * 100),
        timestamp: parseKlineTimestamp(date, normalizedInterval)
      };
    });
    if (adjustment === "forward" && !isIntraday(normalizedInterval) && normalizedInterval === "1d") {
      assertNoUnexplainedCorporateActionGap(target.symbol, candles);
    }
    return candles;
  }

  private eastMoneyHistoryUrl(
    target: ReturnType<typeof normalizeAShareSymbol>,
    range: string,
    normalizedInterval: string,
    adjustment: "forward" | "none"
  ) {
    const url = new URL(this.klineBaseUrl);
    url.searchParams.set("secid", target.secid);
    url.searchParams.set("ut", "fa5fd1943c7b386f172d6893dbfba10b");
    url.searchParams.set("fields1", "f1,f2,f3,f4,f5,f6");
    url.searchParams.set("fields2", "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61");
    url.searchParams.set("klt", intervalToKlt(normalizedInterval));
    url.searchParams.set("fqt", adjustment === "forward" ? "1" : "0");
    url.searchParams.set("end", "20500101");
    url.searchParams.set("lmt", String(rangeToLimit(range, normalizedInterval)));
    return url;
  }

  async getCompanyProfile(symbol: string): Promise<CompanyProfile> {
    const target = normalizeAShareSymbol(symbol);
    return {
      symbol: target.symbol,
      name: target.symbol,
      exchange: target.exchange,
      sector: "A股"
    };
  }

  private async getTencentFallbackHistory(
    target: ReturnType<typeof normalizeAShareSymbol>,
    range: string,
    interval: string,
    adjustment: "forward" | "none"
  ): Promise<Candle[]> {
    if (isIntraday(interval)) {
      const candles = await this.getTencentIntradayHistory(target, range);
      return aggregateIntradayCandles(candles, interval);
    }
    return this.getTencentDailyHistory(target, range, interval, adjustment);
  }

  private async getTencentIntradayHistory(target: ReturnType<typeof normalizeAShareSymbol>, range: string) {
    const marketSymbol = tencentMarketSymbol(target);
    const url = new URL(`${this.tencentKlineBaseUrl}/mkline`);
    const limit = Math.min(rangeToLimit(range, "1m"), 1440);
    url.searchParams.set("param", `${marketSymbol},m1,,${limit}`);

    const response = await fetch(url, {
      headers: requestHeaders(),
      cache: "no-store"
    });
    if (!response.ok) throw new AppError("DATA_PROVIDER_ERROR", `腾讯分时 K 线请求失败：${response.status}`);
    const payload = await readProviderJsonResponse<TencentKlineResponse>(response, "腾讯分时 K 线");
    const rows = payload.data?.[marketSymbol]?.m1;
    if (!rows?.length) throw new AppError("SYMBOL_NOT_FOUND", `未返回 ${target.symbol} 的腾讯分时行情。`);
    const candles = rows.map((row) => tencentRowToCandle(target.symbol, row, true)).filter(isValidCandle);
    return filterIntradayCandlesByRange(candles, range);
  }

  private async getTencentDailyHistory(
    target: ReturnType<typeof normalizeAShareSymbol>,
    range: string,
    interval: string,
    adjustment: "forward" | "none" = "forward"
  ) {
    const marketSymbol = tencentMarketSymbol(target);
    // When an adjusted series is requested, adjust daily bars before weekly/monthly
    // aggregation. Historical valuation deliberately requests the untouched raw series.
    const requestedPeriod = interval === "1wk" || interval === "1w" ? "week" : interval === "1mo" ? "month" : "day";
    const period = "day";
    const url = this.tencentDailyHistoryUrl(target, range);

    const response = await fetch(url, {
      headers: requestHeaders(),
      cache: "no-store"
    });
    if (!response.ok) throw new AppError("DATA_PROVIDER_ERROR", `腾讯日 K 线请求失败：${response.status}`);
    const payload = await readProviderJsonResponse<TencentKlineResponse>(response, "腾讯日 K 线");
    const rows = payload.data?.[marketSymbol]?.[period];
    if (!rows?.length) throw new AppError("SYMBOL_NOT_FOUND", `未返回 ${target.symbol} 的腾讯历史行情。`);
    const rawCandles = rows.map((row) => tencentRowToCandle(target.symbol, row, false)).filter(isValidCandle);
    const normalized = adjustment === "forward" ? adjustTencentHistoryForCorporateActions(target.symbol, rawCandles) : rawCandles;
    return requestedPeriod === "day" ? normalized : aggregateDailyCandles(normalized, requestedPeriod);
  }

  private tencentDailyHistoryUrl(target: ReturnType<typeof normalizeAShareSymbol>, range: string) {
    const marketSymbol = tencentMarketSymbol(target);
    const url = new URL(`${this.tencentKlineBaseUrl}/kline`);
    url.searchParams.set("param", `${marketSymbol},day,,,${rangeToLimit(range, "1d")}`);
    return url;
  }

  async getFundamentals(symbol: string, options: CompanyEvidenceOptions = {}): Promise<FundamentalEvidence> {
    const target = normalizeAShareSymbol(symbol);
    return fetchCninfoFundamentals({ code: target.code, symbol: target.symbol, options });
  }

  async getDisclosures(symbol: string, options: CompanyEvidenceOptions = {}): Promise<DisclosureEvidence> {
    const target = normalizeAShareSymbol(symbol);
    return fetchCninfoDisclosures({ code: target.code, symbol: target.symbol, exchange: target.exchange, options });
  }
}

function normalizeAShareSymbol(input: string) {
  const raw = input.trim().toUpperCase().replace(/\s+/g, "");
  const compact = raw.replace(/^SH/, "").replace(/^SZ/, "").replace(/^BJ/, "").replace(/\.(SH|SZ|BJ)$/, "");
  if (!/^\d{6}$/.test(compact)) {
    throw new AppError("SYMBOL_NOT_FOUND", "A 股代码应为 6 位数字，例如 600519.SH、000001.SZ 或 600519。", { symbol: input });
  }

  const exchange = inferExchange(raw, compact);
  const marketId = exchange === "SH" ? "1" : "0";
  return {
    code: compact,
    exchange,
    secid: `${marketId}.${compact}`,
    symbol: `${compact}.${exchange}`
  };
}

function inferExchange(raw: string, code: string): "SH" | "SZ" | "BJ" {
  if (raw.startsWith("SH") || raw.endsWith(".SH")) return "SH";
  if (raw.startsWith("SZ") || raw.endsWith(".SZ")) return "SZ";
  if (raw.startsWith("BJ") || raw.endsWith(".BJ")) return "BJ";
  if (/^(5|6|9)/.test(code)) return "SH";
  return "SZ";
}

function readNumber(value: number | "-" | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readTencentNumber(value?: string) {
  if (!value?.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rangeToLimit(range: string, interval: string) {
  if (isIntraday(interval)) {
    const barsPerDay = Math.ceil(240 / intervalMinutes(interval));
    const tradingDays = intradayTradingDays(range);
    return Math.min(barsPerDay * tradingDays, 5000);
  }
  if (range === "1mo") return 30;
  if (range === "3mo") return 90;
  if (range === "6mo") return 180;
  if (range === "1y") return 260;
  if (range === "2y") return 520;
  if (range === "5y") return 1300;
  if (range === "all") return 5000;
  return 260;
}

function intervalMinutes(interval: string) {
  if (interval === "1m") return 1;
  if (interval === "5m") return 5;
  if (interval === "15m") return 15;
  if (interval === "30m") return 30;
  return 60;
}

function intradayTradingDays(range: string) {
  if (range === "1d") return 1;
  if (range === "5d") return 5;
  if (range === "1mo") return 22;
  if (range === "3mo") return 66;
  if (range === "6mo") return 126;
  return 22;
}

function normalizeInterval(interval: string) {
  const value = interval.toLowerCase();
  if (value === "1h") return "60m";
  if (["1m", "5m", "15m", "30m", "60m", "1d", "1wk", "1w", "1mo"].includes(value)) return value;
  return "1d";
}

function intervalToKlt(interval: string) {
  if (interval === "1m") return "1";
  if (interval === "5m") return "5";
  if (interval === "15m") return "15";
  if (interval === "30m") return "30";
  if (interval === "60m") return "60";
  if (interval === "1wk" || interval === "1w") return "102";
  if (interval === "1mo") return "103";
  return "101";
}

function isIntraday(interval: string) {
  return ["1m", "5m", "15m", "30m", "60m"].includes(interval);
}

function parseKlineTimestamp(value: string, interval: string) {
  if (value.includes(" ")) {
    return new Date(`${value.replace(" ", "T")}:00+08:00`).toISOString();
  }
  const closeTime = isIntraday(interval) ? "09:30:00" : "15:00:00";
  return new Date(`${value}T${closeTime}+08:00`).toISOString();
}

function parseEastMoneyTimestamp(value: number) {
  const text = String(value);
  if (!/^\d{14}$/.test(text)) return new Date().toISOString();
  const year = text.slice(0, 4);
  const month = text.slice(4, 6);
  const day = text.slice(6, 8);
  const hour = text.slice(8, 10);
  const minute = text.slice(10, 12);
  const second = text.slice(12, 14);
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`).toISOString();
}

function tencentMarketSymbol(target: ReturnType<typeof normalizeAShareSymbol>) {
  return `${target.exchange.toLowerCase()}${target.code}`;
}

function tencentRowToCandle(symbol: string, row: string[], intraday: boolean): Candle {
  const [time, open, close, high, low, volume] = row;
  return {
    symbol,
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    volume: Math.round(Number(volume) * 100),
    timestamp: intraday ? parseTencentIntradayTimestamp(time) : new Date(`${time}T15:00:00+08:00`).toISOString()
  };
}

function parseTencentIntradayTimestamp(value: string) {
  const year = value.slice(0, 4);
  const month = value.slice(4, 6);
  const day = value.slice(6, 8);
  const hour = value.slice(8, 10);
  const minute = value.slice(10, 12);
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:00+08:00`).toISOString();
}

function parseTencentQuoteTimestamp(value?: string) {
  if (!value || !/^\d{14}$/.test(value)) return new Date().toISOString();
  const year = value.slice(0, 4);
  const month = value.slice(4, 6);
  const day = value.slice(6, 8);
  const hour = value.slice(8, 10);
  const minute = value.slice(10, 12);
  const second = value.slice(12, 14);
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`).toISOString();
}

function aggregateIntradayCandles(candles: Candle[], interval: string) {
  const minutes = intervalMinutes(interval);
  if (minutes <= 1) return candles;
  const buckets = new Map<number, Candle[]>();
  for (const candle of candles) {
    const date = new Date(candle.timestamp);
    const bucketMinute = Math.floor(date.getMinutes() / minutes) * minutes;
    const bucketStart = new Date(date);
    bucketStart.setMinutes(bucketMinute, 0, 0);
    const key = bucketStart.getTime();
    const rows = buckets.get(key) ?? [];
    rows.push(candle);
    buckets.set(key, rows);
  }
  return [...buckets.entries()].sort(([a], [b]) => a - b).map(([timestamp, rows]) => ({
    symbol: rows[0].symbol,
    open: rows[0].open,
    high: Math.max(...rows.map((row) => row.high)),
    low: Math.min(...rows.map((row) => row.low)),
    close: rows[rows.length - 1].close,
    volume: rows.reduce((sum, row) => sum + row.volume, 0),
    timestamp: new Date(timestamp).toISOString()
  }));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}

function aggregateDailyCandles(candles: Candle[], period: "week" | "month") {
  const buckets = new Map<string, Candle[]>();
  for (const candle of candles) {
    const key = period === "month" ? localDateKey(candle.timestamp).slice(0, 7) : weekKey(candle.timestamp);
    const rows = buckets.get(key) ?? [];
    rows.push(candle);
    buckets.set(key, rows);
  }
  return [...buckets.values()].map((rows) => ({
    symbol: rows[0].symbol,
    open: rows[0].open,
    high: Math.max(...rows.map((row) => row.high)),
    low: Math.min(...rows.map((row) => row.low)),
    close: rows[rows.length - 1].close,
    volume: rows.reduce((sum, row) => sum + row.volume, 0),
    timestamp: rows[rows.length - 1].timestamp
  }));
}

function weekKey(timestamp: string) {
  const dateKey = localDateKey(timestamp);
  const date = new Date(`${dateKey}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function filterIntradayCandlesByRange(candles: Candle[], range: string) {
  const ordered = [...candles].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  if (!ordered.length) return ordered;

  const keepDays = intradayTradingDays(range);
  const dates = Array.from(new Set(ordered.map((candle) => localDateKey(candle.timestamp))));
  const allowedDates = new Set(dates.slice(-keepDays));
  return ordered.filter((candle) => allowedDates.has(localDateKey(candle.timestamp)));
}

function localDateKey(timestamp: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(timestamp));
}

function isValidCandle(candle: Candle) {
  return [candle.open, candle.high, candle.low, candle.close].every((value) => Number.isFinite(value) && value > 0);
}

function requestHeaders() {
  return {
    Referer: "https://quote.eastmoney.com/",
    "User-Agent": "Mozilla/5.0 StockAI/1.0"
  };
}
