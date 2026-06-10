export function stockSymbolBase(symbol: string) {
  return symbol.trim().toUpperCase().replace(/\.(SH|SZ|BJ)$/, "");
}

export function stockSymbolVariants(symbol: string) {
  const normalized = symbol.trim().toUpperCase();
  const base = stockSymbolBase(normalized);
  if (!/^\d{6}$/.test(base)) return [normalized];
  return [normalized, base, `${base}.SH`, `${base}.SZ`, `${base}.BJ`];
}

export function sameStockSymbol(a?: string | null, b?: string | null) {
  if (!a || !b) return false;
  return stockSymbolVariants(a).includes(b.trim().toUpperCase()) || stockSymbolVariants(b).includes(a.trim().toUpperCase());
}
