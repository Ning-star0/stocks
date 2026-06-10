import { toNumber } from "@/lib/utils";
import { focusSymbolBase, focusSymbolVariants } from "@/lib/focus/symbols";
import { calculateFocusTradeFee } from "@/lib/focus/trading";

export type PortfolioValuationStatus = "live" | "stale" | "partial_fallback" | "cost_fallback" | "empty";

export type PortfolioSnapshot = {
  investedCost: number;
  availableCash: number;
  currentMarketValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalAssets: number;
  portfolioValuationStatus: PortfolioValuationStatus;
  portfolioSnapshotAt: string;
};

type PortfolioItem = {
  symbol: string;
  holdingPrice?: unknown;
  holdingShares: unknown;
};

type TradeExecutionCashRow = {
  symbol: string;
  netCashChange: unknown;
  realizedPnl: unknown;
};

type QuoteForValuation = {
  price?: number | null;
  status?: string;
} | null | undefined;

export function buildPortfolioSnapshot(input: {
  capital: number;
  portfolioItems: PortfolioItem[];
  tradeExecutions: TradeExecutionCashRow[];
  quotes: Record<string, QuoteForValuation>;
  snapshotAt?: Date;
}): PortfolioSnapshot {
  const investedCost = calculateInvestedCost(input.portfolioItems);
  const realizedPnl = calculateRealizedPnl(input.tradeExecutions);
  const availableCash = calculateAvailableCash({
    capital: input.capital,
    investedCost,
    realizedPnl,
    portfolioItems: input.portfolioItems,
    tradeExecutions: input.tradeExecutions
  });
  const marketValue = calculatePortfolioMarketValue(input.portfolioItems, input.quotes);
  const unrealizedPnl = Number((marketValue.value - investedCost).toFixed(2));
  const totalAssets = Number((availableCash + marketValue.value).toFixed(2));

  return {
    investedCost,
    availableCash,
    currentMarketValue: marketValue.value,
    unrealizedPnl,
    realizedPnl,
    totalAssets,
    portfolioValuationStatus: marketValue.status,
    portfolioSnapshotAt: (input.snapshotAt ?? new Date()).toISOString()
  };
}

export function calculateInvestedCost(items: Array<{ holdingPrice?: unknown; holdingShares: unknown }>) {
  const total = items.reduce((sum, item) => {
    const price = toNumber(item.holdingPrice) ?? 0;
    const shares = toNumber(item.holdingShares) ?? 0;
    if (price <= 0 || shares <= 0) return sum;
    const amount = price * shares;
    return sum + amount + calculateFocusTradeFee(amount);
  }, 0);
  return Number(total.toFixed(2));
}

export function calculateCurrentMarketValue(
  items: PortfolioItem[],
  quotes: Record<string, QuoteForValuation>
) {
  return calculatePortfolioMarketValue(items, quotes).value;
}

export function calculatePortfolioMarketValue(
  items: PortfolioItem[],
  quotes: Record<string, QuoteForValuation>
) {
  if (!items.length) return { value: 0, status: "empty" as const };
  let usedStaleQuote = 0;
  let usedCostFallback = 0;
  const total = items.reduce((sum, item) => {
    const shares = toNumber(item.holdingShares) ?? 0;
    if (shares <= 0) return sum;
    const quote = quotes[item.symbol] ?? quotes[focusSymbolVariants(item.symbol).find((symbol) => quotes[symbol]) ?? item.symbol];
    const quotePrice = quote?.price ?? null;
    const price = quotePrice ?? toNumber(item.holdingPrice) ?? null;
    if (!price || price <= 0) return sum;
    if (quotePrice && quotePrice > 0) {
      if (quote?.status === "stale") usedStaleQuote += 1;
    } else {
      usedCostFallback += 1;
    }
    return sum + price * shares;
  }, 0);
  const value = Number(total.toFixed(2));
  const activeItems = items.filter((item) => (toNumber(item.holdingShares) ?? 0) > 0).length;
  if (activeItems === 0) return { value, status: "empty" as const };
  const status: PortfolioValuationStatus = usedCostFallback >= activeItems
    ? "cost_fallback"
    : usedCostFallback > 0
      ? "partial_fallback"
      : usedStaleQuote > 0
        ? "stale"
        : "live";
  return { value, status };
}

export function calculateAvailableCash(input: {
  capital: number;
  investedCost: number;
  realizedPnl: number;
  portfolioItems: Array<{ symbol: string; holdingShares: unknown }>;
  tradeExecutions: Array<{ symbol: string; netCashChange: unknown }>;
}) {
  const cashFromLedger = calculateLedgerCash(input.capital, input.portfolioItems, input.tradeExecutions);
  if (cashFromLedger !== null) return cashFromLedger;
  return Number(Math.max(0, input.capital - input.investedCost + input.realizedPnl).toFixed(2));
}

export function calculateRealizedPnl(items: Array<{ realizedPnl: unknown }>) {
  const total = items.reduce((sum, item) => sum + (toNumber(item.realizedPnl) ?? 0), 0);
  return Number(total.toFixed(2));
}

function calculateLedgerCash(
  capital: number,
  portfolioItems: Array<{ symbol: string; holdingShares: unknown }>,
  tradeExecutions: Array<{ symbol: string; netCashChange: unknown }>
) {
  if (!tradeExecutions.length) return null;

  const executionBases = new Set(tradeExecutions.map((execution) => focusSymbolBase(execution.symbol)).filter(Boolean));
  const activePositionBases = new Set(
    portfolioItems
      .filter((item) => (toNumber(item.holdingShares) ?? 0) > 0)
      .map((item) => focusSymbolBase(item.symbol))
      .filter(Boolean)
  );

  for (const symbolBase of activePositionBases) {
    if (!executionBases.has(symbolBase)) return null;
  }

  const netCashChange = tradeExecutions.reduce((sum, execution) => sum + (toNumber(execution.netCashChange) ?? 0), 0);
  return Number(Math.max(0, capital + netCashChange).toFixed(2));
}
