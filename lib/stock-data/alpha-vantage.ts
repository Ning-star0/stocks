import type { Candle, CompanyProfile, HistoryOptions, Quote, StockDataProvider } from "@/lib/stock-data/types";
import { AppError } from "@/lib/errors";
import { readProviderJsonResponse } from "@/lib/httpJson";

type AlphaGlobalQuote = {
  "01. symbol": string;
  "02. open": string;
  "03. high": string;
  "04. low": string;
  "05. price": string;
  "06. volume": string;
  "07. latest trading day": string;
  "08. previous close": string;
  "09. change": string;
  "10. change percent": string;
};

function requireKey() {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) throw new Error("使用 alpha_vantage 数据源需要配置 ALPHA_VANTAGE_API_KEY。");
  return key;
}

function parsePercent(value: string) {
  return Number(value.replace("%", ""));
}

export class AlphaVantageProvider implements StockDataProvider {
  private readonly baseUrl = "https://www.alphavantage.co/query";

  async getQuote(symbol: string): Promise<Quote> {
    const key = requireKey();
    const url = `${this.baseUrl}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${key}`;
    const response = await fetch(url, { next: { revalidate: 60 } });
    if (!response.ok) throw new Error(`Alpha Vantage 报价请求失败：${response.status}`);
    const data = await readProviderJsonResponse<{ "Global Quote"?: AlphaGlobalQuote; Note?: string; Information?: string }>(response, "Alpha Vantage 报价");
    if (data.Note) throw new AppError("RATE_LIMIT", "Alpha Vantage 触发限流。", { providerMessage: data.Note });
    if (data.Information) throw new AppError("RATE_LIMIT", "Alpha Vantage 请求额度已达上限。", { providerMessage: data.Information });
    const quote = data["Global Quote"];
    if (!quote?.["05. price"]) throw new AppError("SYMBOL_NOT_FOUND", `未返回 ${symbol} 的报价。`, { symbol });

    const price = Number(quote["05. price"]);
    const previousClose = Number(quote["08. previous close"]);
    return {
      symbol: quote["01. symbol"].toUpperCase(),
      price,
      open: Number(quote["02. open"]),
      high: Number(quote["03. high"]),
      low: Number(quote["04. low"]),
      close: price,
      previousClose,
      change: Number(quote["09. change"]),
      changePercent: parsePercent(quote["10. change percent"]),
      volume: Number(quote["06. volume"]),
      timestamp: new Date(`${quote["07. latest trading day"]}T21:00:00.000Z`).toISOString()
    };
  }

  async getHistory(symbol: string, range = "6mo", interval = "1d", options: HistoryOptions = {}): Promise<Candle[]> {
    const key = requireKey();
    const functionName = interval === "1d" ? "TIME_SERIES_DAILY_ADJUSTED" : "TIME_SERIES_INTRADAY";
    const intervalParam = interval === "1d" ? "" : `&interval=${encodeURIComponent(interval)}`;
    const outputsize = range === "1mo" || range === "3mo" ? "compact" : "full";
    const url = `${this.baseUrl}?function=${functionName}&symbol=${encodeURIComponent(symbol)}${intervalParam}&outputsize=${outputsize}&apikey=${key}`;
    const response = await fetch(url, options.forceRefresh ? { cache: "no-store" } : { next: { revalidate: 300 } });
    if (!response.ok) throw new Error(`Alpha Vantage 历史行情请求失败：${response.status}`);
    const data = await readProviderJsonResponse<Record<string, unknown> & { Note?: string; Information?: string }>(response, "Alpha Vantage 历史行情");
    if (data.Note) throw new AppError("RATE_LIMIT", "Alpha Vantage 触发限流。", { providerMessage: data.Note });
    if (data.Information) throw new AppError("RATE_LIMIT", "Alpha Vantage 请求额度已达上限。", { providerMessage: data.Information });
    const seriesKey = Object.keys(data).find((keyName) => keyName.includes("Time Series"));
    const series = seriesKey ? data[seriesKey] : null;
    if (!series) throw new AppError("SYMBOL_NOT_FOUND", `未返回 ${symbol} 的历史行情。`, { symbol });

    const maxRows = range === "1mo" ? 30 : range === "3mo" ? 90 : range === "1y" ? 252 : 180;
    return Object.entries(series)
      .slice(0, maxRows)
      .map(([timestamp, row]) => {
        const item = row as Record<string, string>;
        return {
          symbol: symbol.toUpperCase(),
          open: Number(item["1. open"]),
          high: Number(item["2. high"]),
          low: Number(item["3. low"]),
          close: Number(item["4. close"]),
          volume: Number(item["6. volume"] ?? item["5. volume"]),
          timestamp: new Date(timestamp).toISOString()
        };
      })
      .reverse();
  }

  async getCompanyProfile(symbol: string): Promise<CompanyProfile> {
    return { symbol: symbol.toUpperCase(), name: symbol.toUpperCase() };
  }
}
