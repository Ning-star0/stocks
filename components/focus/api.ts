import type { StockItem, WatchlistResponse } from "@/components/focus/types";

export function normalizeWatchlistItems(data: WatchlistResponse): StockItem[] {
  const rawItems = Array.isArray(data.watchlists)
    ? data.watchlists.flatMap((watchlist) => watchlist.items ?? [])
    : data.items ?? [];

  return rawItems.map((item) => ({
    id: item.id,
    symbol: item.symbol,
    name: item.quote?.name ?? undefined,
    note: item.note,
    isHolding: item.isHolding ?? false,
    holdingPrice: item.holdingPrice ?? null,
    holdingShares: item.holdingShares ?? null,
    quote: item.quote ? { price: item.quote.price ?? null, changePct: item.quote.changePct ?? null } : null,
    latestAnalysis: item.latestAnalysis ?? null,
    positionOpenedAt: item.positionOpenedAt ?? null
  }));
}

export function buildStockNameMap(items: StockItem[]) {
  return Object.fromEntries(items.filter((item) => item.name).map((item) => [item.symbol, item.name as string]));
}
