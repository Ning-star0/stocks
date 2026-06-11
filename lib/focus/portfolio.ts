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
  side?: unknown;
  price?: unknown;
  shares?: unknown;
  amount?: unknown;
  fee?: unknown;
  netCashChange: unknown;
  realizedPnl: unknown;
  executedAt?: Date | string | null;
  updatedAt?: Date | string | null;
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
  const investedCost = calculateInvestedCost(input.portfolioItems, input.tradeExecutions);
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

export function calculateInvestedCost(
  items: Array<{ symbol?: string; holdingPrice?: unknown; holdingShares: unknown }>,
  tradeExecutions: TradeExecutionCashRow[] = []
) {
  const ledgerCost = calculateLedgerInvestedCost(items, tradeExecutions);
  if (ledgerCost !== null) return ledgerCost;

  const total = items.reduce((sum, item) => {
    const price = toNumber(item.holdingPrice) ?? 0;
    const shares = toNumber(item.holdingShares) ?? 0;
    if (price <= 0 || shares <= 0) return sum;
    const amount = price * shares;
    return sum + amount + calculateFocusTradeFee(amount);
  }, 0);
  return Number(total.toFixed(2));
}

export function calculatePositionCostBasisBySymbol(
  items: Array<{ symbol: string; holdingShares: unknown }>,
  tradeExecutions: TradeExecutionCashRow[]
) {
  const ledger = rebuildCostBasisByBase(tradeExecutions);
  if (!ledger.size) return new Map<string, number>();
  const output = new Map<string, number>();
  for (const item of items) {
    const shares = toNumber(item.holdingShares) ?? 0;
    if (shares <= 0) continue;
    const base = focusSymbolBase(item.symbol);
    const position = ledger.get(base);
    if (!position || position.shares <= 0) continue;
    output.set(base, Number(position.costBasis.toFixed(2)));
  }
  return output;
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

function calculateLedgerInvestedCost(
  items: Array<{ symbol?: string; holdingShares: unknown }>,
  tradeExecutions: TradeExecutionCashRow[]
) {
  if (!tradeExecutions.length || items.some((item) => !item.symbol)) return null;
  const ledger = rebuildCostBasisByBase(tradeExecutions);
  if (!ledger.size) return null;

  let total = 0;
  for (const item of items) {
    const shares = toNumber(item.holdingShares) ?? 0;
    if (shares <= 0) continue;
    const symbol = item.symbol;
    if (!symbol) return null;
    const position = ledger.get(focusSymbolBase(symbol));
    if (!position || position.shares <= 0) return null;
    total += position.costBasis;
  }
  return Number(total.toFixed(2));
}

function rebuildCostBasisByBase(tradeExecutions: TradeExecutionCashRow[]) {
  const positions = new Map<string, { shares: number; costBasis: number }>();
  const ordered = [...tradeExecutions].sort((a, b) => timestamp(a) - timestamp(b));

  for (const execution of ordered) {
    const symbolBase = focusSymbolBase(execution.symbol);
    const side = String(execution.side ?? "").toLowerCase();
    const shares = toNumber(execution.shares) ?? 0;
    if (!symbolBase || shares <= 0 || (side !== "buy" && side !== "sell")) continue;

    const position = positions.get(symbolBase) ?? { shares: 0, costBasis: 0 };
    const price = toNumber(execution.price) ?? 0;
    const amount = toNumber(execution.amount) ?? (price > 0 ? price * shares : 0);
    const fee = toNumber(execution.fee) ?? calculateFocusTradeFee(amount);

    if (side === "buy") {
      position.shares += shares;
      position.costBasis = Number((position.costBasis + amount + fee).toFixed(2));
    } else {
      const sellShares = Math.min(shares, position.shares);
      const soldCostBasis = allocateCostBasis(position, sellShares);
      position.shares = Math.max(0, position.shares - sellShares);
      position.costBasis = Number(Math.max(0, position.costBasis - soldCostBasis).toFixed(2));
      if (position.shares <= 0) {
        position.shares = 0;
        position.costBasis = 0;
      }
    }
    positions.set(symbolBase, position);
  }

  return positions;
}

function allocateCostBasis(position: { shares: number; costBasis: number }, sellShares: number) {
  if (sellShares <= 0 || position.shares <= 0 || position.costBasis <= 0) return 0;
  if (sellShares >= position.shares) return Number(position.costBasis.toFixed(2));
  return Number((position.costBasis * (sellShares / position.shares)).toFixed(2));
}

function timestamp(value: TradeExecutionCashRow) {
  const date = value.executedAt ?? value.updatedAt;
  const time = date ? new Date(date).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}
