export function focusSymbolVariants(symbol: string) {
  const normalized = symbol.toUpperCase();
  const base = focusSymbolBase(normalized);
  if (!/^\d{6}$/.test(base)) return [normalized];
  return [normalized, base, `${base}.SH`, `${base}.SZ`, `${base}.BJ`];
}

export function focusSymbolBase(symbol: string) {
  return symbol.toUpperCase().replace(/\.(SH|SZ|BJ)$/, "");
}

export function sameFocusSymbol(a?: string | null, b?: string | null) {
  if (!a || !b) return false;
  return focusSymbolVariants(a).includes(b.toUpperCase()) || focusSymbolVariants(b).includes(a.toUpperCase());
}

export function latestFocusAnalysesForSymbols<T extends { id: string; symbol: string; createdAt: Date }>(symbols: string[], analyses: T[]) {
  const output = new Map<string, T>();
  for (const symbol of symbols) {
    const variants = focusSymbolVariants(symbol);
    const match = analyses.find((analysis) => variants.includes(analysis.symbol));
    if (match) output.set(symbol, match);
  }
  return output;
}
