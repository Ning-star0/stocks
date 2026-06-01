import type { Candle, CompanyProfile, HistoryOptions, NewsItem, Quote, StockDataProvider } from "@/lib/stock-data/types";
import { AppError } from "@/lib/errors";

const basePrices: Record<string, number> = {
  AAPL: 192.41,
  MSFT: 427.53,
  NVDA: 905.12,
  TSLA: 171.22,
  AMZN: 183.8,
  META: 498.35,
  GOOGL: 154.62
};

function hashSymbol(symbol: string) {
  return symbol.toUpperCase().split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
}

function seededWave(seed: number, index: number) {
  return Math.sin((seed + index) * 0.31) + Math.cos((seed - index) * 0.17) * 0.65;
}

export class MockStockDataProvider implements StockDataProvider {
  async getQuote(symbol: string): Promise<Quote> {
    const normalized = symbol.toUpperCase();
    assertValidMockSymbol(normalized);
    const seed = hashSymbol(normalized);
    const base = basePrices[normalized] ?? 40 + (seed % 220);
    const minuteBucket = Math.floor(Date.now() / 60_000);
    const drift = seededWave(seed, minuteBucket % 390) * 0.012;
    const previousClose = Number((base * (1 - seededWave(seed, 3) * 0.01)).toFixed(2));
    const price = Number((base * (1 + drift)).toFixed(2));
    const open = Number((previousClose * (1 + seededWave(seed, 9) * 0.006)).toFixed(2));
    const high = Number((Math.max(open, price) * (1 + Math.abs(seededWave(seed, 11)) * 0.006)).toFixed(2));
    const low = Number((Math.min(open, price) * (1 - Math.abs(seededWave(seed, 13)) * 0.006)).toFixed(2));
    const change = Number((price - previousClose).toFixed(2));
    const changePercent = Number(((change / previousClose) * 100).toFixed(2));

    return {
      symbol: normalized,
      price,
      open,
      high,
      low,
      close: price,
      previousClose,
      change,
      changePercent,
      volume: Math.round(800_000 + Math.abs(seededWave(seed, minuteBucket)) * 9_000_000),
      timestamp: new Date().toISOString()
    };
  }

  async getHistory(symbol: string, range = "6mo", interval = "1d", options: HistoryOptions = {}): Promise<Candle[]> {
    void interval;
    void options;
    const normalized = symbol.toUpperCase();
    assertValidMockSymbol(normalized);
    const seed = hashSymbol(normalized);
    const base = basePrices[normalized] ?? 40 + (seed % 220);
    const days = range === "1mo" ? 30 : range === "3mo" ? 90 : range === "1y" ? 252 : 180;
    const candles: Candle[] = [];
    let close = base * (0.86 + (seed % 18) / 100);

    for (let i = days - 1; i >= 0; i -= 1) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const wave = seededWave(seed, days - i);
      const momentum = Math.sin((days - i) / 16) * 0.008;
      const move = wave * 0.012 + momentum;
      const open = close;
      close = Math.max(2, close * (1 + move));
      const high = Math.max(open, close) * (1 + Math.abs(seededWave(seed, i)) * 0.012);
      const low = Math.min(open, close) * (1 - Math.abs(seededWave(seed + 5, i)) * 0.012);

      candles.push({
        symbol: normalized,
        open: Number(open.toFixed(2)),
        high: Number(high.toFixed(2)),
        low: Number(low.toFixed(2)),
        close: Number(close.toFixed(2)),
        volume: Math.round(500_000 + Math.abs(wave) * 8_500_000),
        timestamp: date.toISOString()
      });
    }

    return candles;
  }

  async getCompanyProfile(symbol: string): Promise<CompanyProfile> {
    assertValidMockSymbol(symbol.toUpperCase());
    return {
      symbol: symbol.toUpperCase(),
      name: `${symbol.toUpperCase()} 模拟公司`,
      exchange: "模拟交易所",
      sector: "科技"
    };
  }

  async getNews(symbol: string): Promise<NewsItem[]> {
    const normalized = symbol.toUpperCase();
    assertValidMockSymbol(normalized);
    return [
      {
        title: `${normalized} 市场结构仍取决于后续数据`,
        source: "模拟新闻源",
        publishedAt: new Date().toISOString(),
        summary: "本地开发用模拟新闻。接入真实数据时请替换 provider。"
      }
    ];
  }
}

function assertValidMockSymbol(symbol: string) {
  if (!/^[A-Z0-9.\-_:]{1,16}$/.test(symbol)) {
    throw new AppError("SYMBOL_NOT_FOUND", "模拟数据源中未找到该股票代码。", { symbol });
  }
}
