import { AlphaVantageProvider } from "@/lib/stock-data/alpha-vantage";
import { AShareEastMoneyProvider } from "@/lib/stock-data/a-share";
import { MockStockDataProvider } from "@/lib/stock-data/mock";
import type { StockDataProvider } from "@/lib/stock-data/types";

let provider: StockDataProvider | null = null;

export function getStockDataProvider(): StockDataProvider {
  if (provider) return provider;

  const providerName = process.env.STOCK_DATA_PROVIDER?.toLowerCase() ?? "mock";
  if (providerName === "alpha_vantage") provider = new AlphaVantageProvider();
  else if (providerName === "a_share" || providerName === "eastmoney") provider = new AShareEastMoneyProvider();
  else provider = new MockStockDataProvider();
  return provider;
}

export type { StockDataProvider } from "@/lib/stock-data/types";
