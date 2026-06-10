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

export function normalizeStockSymbolForMarket(symbol: string, market: string) {
  const normalized = symbol.trim().toUpperCase();
  const normalizedMarket = market.trim().toUpperCase();

  if (normalizedMarket === "CN") return normalizeCnSymbol(normalized);
  if (normalizedMarket === "HK") return normalizeHkSymbol(normalized);
  return normalized;
}

function normalizeCnSymbol(symbol: string) {
  const code = symbol.replace(/\.(SH|SZ|BJ)$/, "");
  if (!/^\d{6}$/.test(code)) return symbol;
  if (symbol.endsWith(".SH") || symbol.endsWith(".SZ") || symbol.endsWith(".BJ")) return symbol;
  if (/^(5|6|9)/.test(code)) return `${code}.SH`;
  return `${code}.SZ`;
}

function normalizeHkSymbol(symbol: string) {
  if (symbol.endsWith(".HK")) return symbol;
  if (/^\d{4,5}$/.test(symbol)) return `${symbol}.HK`;
  return symbol;
}
