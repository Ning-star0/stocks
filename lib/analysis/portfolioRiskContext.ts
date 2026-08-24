import { getCache, setCache } from "@/lib/cache";
import { buildPortfolioSnapshot } from "@/lib/focus/portfolio";
import { prisma } from "@/lib/prisma";
import { getQuotesBatch } from "@/lib/services/quoteService";
import { stockSymbolVariants } from "@/lib/symbols";
import { buildTradePerformance } from "@/lib/trades/performance";
import { buildPortfolioRiskBudget, type PortfolioRiskBudget } from "@/lib/trading/riskBudget";
import { toNumber } from "@/lib/utils";

export type PortfolioRiskContext = {
  schemaVersion: "portfolio-risk-context-v1";
  calculatedAt: string;
  capital: number;
  availableCash: number;
  totalAssets: number;
  portfolioValuationStatus: string;
  riskBudget: PortfolioRiskBudget;
};

const inFlight = new Map<string, Promise<PortfolioRiskContext | null>>();

export async function loadPortfolioRiskContext(userId: string): Promise<PortfolioRiskContext | null> {
  const cacheKey = `portfolio_risk_context:v1:${userId}`;
  const cached = await getCache<PortfolioRiskContext>(cacheKey);
  if (cached && Date.parse(cached.calculatedAt) >= Date.now() - 30_000) return cached;
  const existing = inFlight.get(userId);
  if (existing) return existing;
  const task = calculatePortfolioRiskContext(userId)
    .then(async (result) => {
      if (result) await setCache(cacheKey, result, 30);
      return result;
    })
    .finally(() => inFlight.delete(userId));
  inFlight.set(userId, task);
  return task;
}

async function calculatePortfolioRiskContext(userId: string): Promise<PortfolioRiskContext | null> {
  const [focus, holdings, executions] = await Promise.all([
    prisma.focusGroup.findUnique({ where: { userId }, select: { capital: true } }),
    prisma.watchlistItem.findMany({
      where: { watchlist: { userId }, isHolding: true },
      select: { symbol: true, holdingPrice: true, holdingShares: true, stopLoss: true, riskLevel: true }
    }),
    prisma.tradeExecution.findMany({
      where: { userId },
      select: {
        id: true,
        symbol: true,
        side: true,
        price: true,
        shares: true,
        amount: true,
        fee: true,
        netCashChange: true,
        realizedPnl: true,
        executedAt: true,
        updatedAt: true
      },
      orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }]
    })
  ]);
  const capital = toNumber(focus?.capital) ?? 0;
  if (capital <= 0) return null;
  const symbols = [...new Set(holdings.map((item) => item.symbol.toUpperCase()))];
  const quotes = symbols.length ? await getQuotesBatch(symbols, { allowStale: true }) : {};
  const portfolio = buildPortfolioSnapshot({ capital, portfolioItems: holdings, tradeExecutions: executions, quotes });
  const performance = buildTradePerformance(executions.map((item) => ({
    id: item.id,
    symbol: item.symbol,
    side: item.side,
    amount: toNumber(item.amount) ?? 0,
    fee: toNumber(item.fee) ?? 0,
    realizedPnl: toNumber(item.realizedPnl),
    executedAt: item.executedAt
  })), capital);
  const riskBudget = buildPortfolioRiskBudget({
    capital,
    totalAssets: portfolio.totalAssets,
    tradePerformance: performance,
    positions: holdings.map((item) => ({
      symbol: item.symbol,
      shares: toNumber(item.holdingShares),
      currentPrice: resolveQuotePrice(quotes, item.symbol),
      holdingPrice: toNumber(item.holdingPrice),
      stopLossPrice: toNumber(item.stopLoss),
      riskLevel: item.riskLevel
    }))
  });
  return {
    schemaVersion: "portfolio-risk-context-v1",
    calculatedAt: new Date().toISOString(),
    capital,
    availableCash: portfolio.availableCash,
    totalAssets: portfolio.totalAssets,
    portfolioValuationStatus: portfolio.portfolioValuationStatus,
    riskBudget
  };
}

function resolveQuotePrice(quotes: Record<string, { price: number | null }>, symbol: string) {
  for (const variant of stockSymbolVariants(symbol)) {
    const price = quotes[variant]?.price;
    if (typeof price === "number" && Number.isFinite(price) && price > 0) return price;
  }
  return null;
}
