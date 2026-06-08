import type { Prisma } from "@prisma/client";

import { AppError } from "@/lib/errors";

export const TRADING_LOT_SIZE = 100;
export const TRADING_FEE_RATE = 0.0005;
export const TRADING_FEE_MIN_BASE = 10000;

export type TradeSide = "buy" | "sell";

type TransactionClient = Prisma.TransactionClient;

type LedgerPosition = {
  baseSymbol: string;
  shares: number;
  avgPrice: number;
  openedAt: Date | null;
};

export function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

export function roundPrice(value: number) {
  return Number(value.toFixed(4));
}

export function calculateTradeFee(amount: number) {
  return roundMoney(Math.max(amount, TRADING_FEE_MIN_BASE) * TRADING_FEE_RATE);
}

export function parsePositiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function parseTradeSide(value: unknown): TradeSide | null {
  const side = String(value ?? "").trim().toLowerCase();
  return side === "buy" || side === "sell" ? side : null;
}

export function assertValidTradeShares(shares: number | null) {
  if (!shares || shares < TRADING_LOT_SIZE || shares % TRADING_LOT_SIZE !== 0) {
    throw new AppError("BAD_REQUEST", `买入/卖出数量必须至少 ${TRADING_LOT_SIZE} 股/份，并且按 ${TRADING_LOT_SIZE} 股/份整数手填写。`);
  }
}

export function normalizeTradeSymbol(symbol: unknown) {
  return String(symbol ?? "").trim().toUpperCase();
}

export function baseSymbol(symbol: string) {
  return normalizeTradeSymbol(symbol).replace(/\.(SH|SZ|BJ)$/i, "");
}

export function serializePosition(position: { symbol: string; isHolding: boolean; holdingPrice: unknown; holdingShares: unknown; positionOpenedAt: Date | null }) {
  return {
    symbol: position.symbol,
    isHolding: position.isHolding,
    holdingPrice: position.holdingPrice === null ? null : Number(position.holdingPrice),
    holdingShares: position.holdingShares === null ? null : Number(position.holdingShares),
    positionOpenedAt: position.positionOpenedAt?.toISOString() ?? null
  };
}

export async function createManualTradeAndRebuild(
  tx: TransactionClient,
  input: {
    userId: string;
    symbol: string;
    side: TradeSide;
    price: number;
    shares: number;
    executedAt: Date;
    note: string | null;
  }
) {
  const symbol = normalizeTradeSymbol(input.symbol);
  if (!symbol) throw new AppError("BAD_REQUEST", "请选择交易标的。");
  assertValidTradeShares(input.shares);

  const item = await findWatchlistItemBySymbol(tx, input.userId, symbol);
  if (!item) throw new AppError("BAD_REQUEST", `自选股中找不到 ${symbol}，无法同步持仓。`);

  if (input.side === "sell") {
    const current = await calculateLedgerPosition(tx, input.userId, symbol);
    if (input.shares > current.shares + 0.0001) {
      throw new AppError("BAD_REQUEST", `卖出数量不能超过当前流水持仓。当前 ${current.shares || 0} 股/份，计划卖出 ${input.shares} 股/份。`);
    }
  }

  const amount = roundMoney(input.price * input.shares);
  const fee = calculateTradeFee(amount);
  const execution = await tx.tradeExecution.create({
    data: {
      userId: input.userId,
      symbol: item.symbol,
      side: input.side,
      price: input.price,
      shares: input.shares,
      amount,
      fee,
      netCashChange: input.side === "buy" ? -roundMoney(amount + fee) : roundMoney(amount - fee),
      realizedPnl: null,
      executedAt: input.executedAt,
      note: input.note
    }
  });

  const positions = await rebuildUserPositions(tx, input.userId, [item.symbol]);
  return {
    execution,
    position: positions.find((position) => baseSymbol(position.symbol) === baseSymbol(item.symbol)) ?? null
  };
}

export async function rebuildUserPositions(tx: TransactionClient, userId: string, symbols?: string[]) {
  const targetBases = symbols?.map(baseSymbol).filter(Boolean);
  const allExecutions = await tx.tradeExecution.findMany({
    where: { userId },
    orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }]
  });
  const executions = targetBases?.length
    ? allExecutions.filter((execution) => targetBases.includes(baseSymbol(execution.symbol)))
    : allExecutions;

  const bases = new Set(executions.map((execution) => baseSymbol(execution.symbol)).filter(Boolean));
  if (!bases.size) return [];

  const watchlistItems = await tx.watchlistItem.findMany({
    where: { watchlist: { userId } },
    select: { id: true, symbol: true }
  });
  const itemByBase = new Map(watchlistItems.map((item) => [baseSymbol(item.symbol), item]));
  const positions = new Map<string, LedgerPosition>();

  for (const execution of executions) {
    const symbolBase = baseSymbol(execution.symbol);
    const position = positions.get(symbolBase) ?? { baseSymbol: symbolBase, shares: 0, avgPrice: 0, openedAt: null };
    const side = String(execution.side).toLowerCase();
    const price = Number(execution.price);
    const shares = Number(execution.shares);
    const amount = roundMoney(price * shares);
    const fee = calculateTradeFee(amount);

    if (side === "buy") {
      const nextShares = position.shares + shares;
      position.avgPrice = nextShares > 0 ? ((position.avgPrice * position.shares) + (price * shares)) / nextShares : price;
      position.shares = nextShares;
      position.openedAt = position.openedAt ?? execution.executedAt;
      await syncExecutionMoney(tx, execution.id, { amount, fee, netCashChange: -roundMoney(amount + fee), realizedPnl: null });
    } else if (side === "sell") {
      const sellShares = Math.min(shares, position.shares);
      const costBasis = position.avgPrice * sellShares;
      const buyFeeForSold = calculateTradeFee(costBasis);
      const realizedPnl = sellShares > 0 ? roundMoney(amount - fee - costBasis - buyFeeForSold) : null;
      position.shares = Math.max(0, position.shares - sellShares);
      if (position.shares <= 0) {
        position.shares = 0;
        position.avgPrice = 0;
        position.openedAt = null;
      }
      await syncExecutionMoney(tx, execution.id, { amount, fee, netCashChange: roundMoney(amount - fee), realizedPnl });
    }
    positions.set(symbolBase, position);
  }

  const serialized = [];
  for (const base of bases) {
    const item = itemByBase.get(base);
    if (!item) continue;
    const position = positions.get(base) ?? { baseSymbol: base, shares: 0, avgPrice: 0, openedAt: null };
    const updated = await tx.watchlistItem.update({
      where: { id: item.id },
      data: position.shares > 0
        ? {
            isHolding: true,
            holdingPrice: roundPrice(position.avgPrice),
            holdingShares: roundPrice(position.shares),
            positionOpenedAt: position.openedAt ?? new Date()
          }
        : {
            isHolding: false,
            holdingPrice: null,
            holdingShares: null,
            positionOpenedAt: null
          },
      select: { symbol: true, isHolding: true, holdingPrice: true, holdingShares: true, positionOpenedAt: true }
    });
    serialized.push(serializePosition(updated));
  }

  return serialized;
}

export async function calculateLedgerPosition(tx: TransactionClient, userId: string, symbol: string) {
  const symbolBase = baseSymbol(symbol);
  const executions = await tx.tradeExecution.findMany({
    where: { userId },
    orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }]
  });
  const position: LedgerPosition = { baseSymbol: symbolBase, shares: 0, avgPrice: 0, openedAt: null };

  for (const execution of executions) {
    if (baseSymbol(execution.symbol) !== symbolBase) continue;
    const side = String(execution.side).toLowerCase();
    const price = Number(execution.price);
    const shares = Number(execution.shares);
    if (side === "buy") {
      const nextShares = position.shares + shares;
      position.avgPrice = nextShares > 0 ? ((position.avgPrice * position.shares) + (price * shares)) / nextShares : price;
      position.shares = nextShares;
      position.openedAt = position.openedAt ?? execution.executedAt;
    } else if (side === "sell") {
      position.shares = Math.max(0, position.shares - shares);
      if (position.shares <= 0) {
        position.shares = 0;
        position.avgPrice = 0;
        position.openedAt = null;
      }
    }
  }

  return position;
}

async function syncExecutionMoney(
  tx: TransactionClient,
  id: string,
  data: { amount: number; fee: number; netCashChange: number; realizedPnl: number | null }
) {
  await tx.tradeExecution.update({
    where: { id },
    data
  });
}

async function findWatchlistItemBySymbol(tx: TransactionClient, userId: string, symbol: string) {
  const targetBase = baseSymbol(symbol);
  const items = await tx.watchlistItem.findMany({
    where: { watchlist: { userId } },
    select: { id: true, symbol: true }
  });
  return items.find((item) => baseSymbol(item.symbol) === targetBase) ?? null;
}
