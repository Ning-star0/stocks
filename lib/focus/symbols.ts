import { sameStockSymbol, stockSymbolBase, stockSymbolVariants } from "@/lib/symbols";

export function focusSymbolVariants(symbol: string) {
  return stockSymbolVariants(symbol);
}

export function focusSymbolBase(symbol: string) {
  return stockSymbolBase(symbol);
}

export function sameFocusSymbol(a?: string | null, b?: string | null) {
  return sameStockSymbol(a, b);
}

export function latestFocusAnalysesForSymbols<T extends { id: string; symbol: string; createdAt: Date }>(symbols: string[], analyses: T[]) {
  const output = new Map<string, T>();
  for (const symbol of symbols) {
    const match = analyses.find((analysis) => sameFocusSymbol(analysis.symbol, symbol));
    if (match) output.set(symbol, match);
  }
  return output;
}
