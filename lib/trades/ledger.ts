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
  costBasis: number;
  openedAt: Date | null;
};

type WatchlistPositionRow = {
  id: string;
  symbol: string;
  isHolding: boolean;
  holdingPrice: unknown;
  holdingShares: unknown;
  positionOpenedAt: Date | null;
};

type LedgerPositionOptions = {
  excludeExecutionId?: string | null;
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

  await reconcileLegacyPositions(tx, input.userId, [item.symbol]);

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

export async function upsertFeedbackTradeAndRebuild(
  tx: TransactionClient,
  input: {
    userId: string;
    feedbackId: string;
    symbol: string;
    side: TradeSide;
    price: number;
    shares: number;
    note: string | null;
  }
) {
  const symbol = normalizeTradeSymbol(input.symbol);
  if (!symbol) throw new AppError("BAD_REQUEST", "请选择交易标的。");
  assertValidTradeShares(input.shares);

  const item = await findWatchlistItemBySymbol(tx, input.userId, symbol);
  if (!item) throw new AppError("BAD_REQUEST", `自选股中找不到 ${symbol}，无法同步持仓。`);

  await reconcileLegacyPositions(tx, input.userId, [item.symbol]);
  const existingExecution = await tx.tradeExecution.findUnique({
    where: { feedbackId: input.feedbackId },
    select: { id: true }
  });

  if (input.side === "sell") {
    const current = await calculateLedgerPosition(tx, input.userId, item.symbol, {
      excludeExecutionId: existingExecution?.id ?? null
    });
    if (input.shares > current.shares + 0.0001) {
      throw new AppError("BAD_REQUEST", `卖出数量不能超过当前流水持仓。当前 ${current.shares || 0} 股/份，计划卖出 ${input.shares} 股/份。`);
    }
  }

  const amount = roundMoney(input.price * input.shares);
  const fee = calculateTradeFee(amount);
  const execution = await tx.tradeExecution.upsert({
    where: { feedbackId: input.feedbackId },
    create: {
      userId: input.userId,
      feedbackId: input.feedbackId,
      symbol: item.symbol,
      side: input.side,
      price: input.price,
      shares: input.shares,
      amount,
      fee,
      netCashChange: input.side === "buy" ? -roundMoney(amount + fee) : roundMoney(amount - fee),
      realizedPnl: null,
      note: input.note
    },
    update: {
      symbol: item.symbol,
      side: input.side,
      price: input.price,
      shares: input.shares,
      amount,
      fee,
      netCashChange: input.side === "buy" ? -roundMoney(amount + fee) : roundMoney(amount - fee),
      realizedPnl: null,
      note: input.note
    }
  });

  const positions = await rebuildUserPositions(tx, input.userId, [item.symbol]);
  return {
    execution,
    position: positions.find((position) => baseSymbol(position.symbol) === baseSymbol(item.symbol)) ?? null
  };
}

export async function deleteTradeExecutionAndRebuild(
  tx: TransactionClient,
  input: {
    userId: string;
    executionId: string;
  }
) {
  const execution = await tx.tradeExecution.findFirst({
    where: { id: input.executionId, userId: input.userId },
    select: { id: true, symbol: true }
  });
  if (!execution) throw new AppError("BAD_REQUEST", "交易记录不存在。");
  await tx.tradeExecution.delete({ where: { id: execution.id } });
  const positions = await rebuildUserPositions(tx, input.userId, [execution.symbol]);
  return { deletedId: execution.id, position: positions[0] ?? null, symbol: execution.symbol };
}

export async function reconcileLegacyPositions(tx: TransactionClient, userId: string, symbols?: string[]) {
  const targetBases = symbols?.map(baseSymbol).filter(Boolean);
  const [watchlistItems, executions] = await Promise.all([
    tx.watchlistItem.findMany({
      where: { watchlist: { userId } },
      select: {
        id: true,
        symbol: true,
        isHolding: true,
        holdingPrice: true,
        holdingShares: true,
        positionOpenedAt: true
      }
    }),
    tx.tradeExecution.findMany({
      where: { userId },
      orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }]
    })
  ]);

  const itemByBase = new Map(watchlistItems.map((item) => [baseSymbol(item.symbol), item]));
  const bases = new Set<string>();
  for (const item of watchlistItems) bases.add(baseSymbol(item.symbol));
  for (const execution of executions) bases.add(baseSymbol(execution.symbol));

  for (const base of bases) {
    if (targetBases?.length && !targetBases.includes(base)) continue;
    const item = itemByBase.get(base);
    if (!item) continue;

    const group = executions.filter((execution) => baseSymbol(execution.symbol) === base);
    const buyShares = sumShares(group.filter((execution) => String(execution.side).toLowerCase() === "buy"));
    const sellShares = sumShares(group.filter((execution) => String(execution.side).toLowerCase() === "sell"));
    const currentShares = item.isHolding ? Number(item.holdingShares ?? 0) : 0;
    const missingShares = roundPrice(sellShares + currentShares - buyShares);
    if (missingShares <= 0.0001) continue;

    const openingPrice = inferOpeningPrice(item, group);
    if (!openingPrice || openingPrice <= 0) continue;

    const amount = roundMoney(openingPrice * missingShares);
    const fee = calculateTradeFee(amount);
    await tx.tradeExecution.create({
      data: {
        userId,
        symbol: item.symbol,
        side: "buy",
        price: openingPrice,
        shares: missingShares,
        amount,
        fee,
        netCashChange: -roundMoney(amount + fee),
        realizedPnl: null,
        executedAt: legacyOpeningTime(item, group),
        note: "系统迁移补齐：根据旧持仓或历史卖出记录生成期初持仓。"
      }
    });
  }
}

export async function reconcileAndRebuildUserPositions(tx: TransactionClient, userId: string, symbols?: string[]) {
  await reconcileLegacyPositions(tx, userId, symbols);
  return rebuildUserPositions(tx, userId, symbols);
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
    const position = positions.get(symbolBase) ?? emptyLedgerPosition(symbolBase);
    const side = String(execution.side).toLowerCase();
    const price = Number(execution.price);
    const shares = Number(execution.shares);
    const amount = roundMoney(price * shares);
    const fee = calculateTradeFee(amount);

    if (side === "buy") {
      const nextShares = position.shares + shares;
      position.avgPrice = nextShares > 0 ? ((position.avgPrice * position.shares) + (price * shares)) / nextShares : price;
      position.shares = nextShares;
      position.costBasis = roundMoney(position.costBasis + amount + fee);
      position.openedAt = position.openedAt ?? execution.executedAt;
      await syncExecutionMoney(tx, execution.id, { amount, fee, netCashChange: -roundMoney(amount + fee), realizedPnl: null });
    } else if (side === "sell") {
      const sellShares = Math.min(shares, position.shares);
      const soldCostBasis = allocateSoldCostBasis(position, sellShares);
      const realizedPnl = sellShares > 0 ? roundMoney(amount - fee - soldCostBasis) : null;
      position.shares = Math.max(0, position.shares - sellShares);
      position.costBasis = roundMoney(Math.max(0, position.costBasis - soldCostBasis));
      if (position.shares <= 0) {
        position.shares = 0;
        position.avgPrice = 0;
        position.costBasis = 0;
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
    const position = positions.get(base) ?? emptyLedgerPosition(base);
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

export async function calculateLedgerPosition(tx: TransactionClient, userId: string, symbol: string, options: LedgerPositionOptions = {}) {
  const symbolBase = baseSymbol(symbol);
  const executions = await tx.tradeExecution.findMany({
    where: { userId },
    orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }]
  });
  const position = emptyLedgerPosition(symbolBase);

  for (const execution of executions) {
    if (options.excludeExecutionId && execution.id === options.excludeExecutionId) continue;
    if (baseSymbol(execution.symbol) !== symbolBase) continue;
    const side = String(execution.side).toLowerCase();
    const price = Number(execution.price);
    const shares = Number(execution.shares);
    if (side === "buy") {
      const amount = Number(execution.amount ?? Number(execution.price) * Number(execution.shares));
      const fee = Number(execution.fee ?? calculateTradeFee(amount));
      const nextShares = position.shares + shares;
      position.avgPrice = nextShares > 0 ? ((position.avgPrice * position.shares) + (price * shares)) / nextShares : price;
      position.shares = nextShares;
      position.costBasis = roundMoney(position.costBasis + amount + fee);
      position.openedAt = position.openedAt ?? execution.executedAt;
    } else if (side === "sell") {
      const sellShares = Math.min(shares, position.shares);
      const soldCostBasis = allocateSoldCostBasis(position, sellShares);
      position.shares = Math.max(0, position.shares - sellShares);
      position.costBasis = roundMoney(Math.max(0, position.costBasis - soldCostBasis));
      if (position.shares <= 0) {
        position.shares = 0;
        position.avgPrice = 0;
        position.costBasis = 0;
        position.openedAt = null;
      }
    }
  }

  return position;
}

function emptyLedgerPosition(baseSymbol: string): LedgerPosition {
  return { baseSymbol, shares: 0, avgPrice: 0, costBasis: 0, openedAt: null };
}

function allocateSoldCostBasis(position: LedgerPosition, sellShares: number) {
  if (sellShares <= 0 || position.shares <= 0 || position.costBasis <= 0) return 0;
  if (sellShares >= position.shares) return roundMoney(position.costBasis);
  return roundMoney(position.costBasis * (sellShares / position.shares));
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

function sumShares(executions: Array<{ shares: unknown }>) {
  return executions.reduce((sum, execution) => sum + Number(execution.shares ?? 0), 0);
}

function inferOpeningPrice(item: WatchlistPositionRow, executions: Array<{ side: unknown; price: unknown; shares: unknown; amount: unknown; fee: unknown; realizedPnl: unknown }>) {
  const holdingPrice = Number(item.holdingPrice ?? 0);
  if (holdingPrice > 0) return roundPrice(holdingPrice);

  const sellCosts = executions
    .filter((execution) => String(execution.side).toLowerCase() === "sell")
    .map((execution) => inferCostBasisFromSell(execution))
    .filter((value): value is { cost: number; shares: number } => Boolean(value));
  const totalShares = sellCosts.reduce((sum, item) => sum + item.shares, 0);
  const totalCost = sellCosts.reduce((sum, item) => sum + item.cost, 0);
  if (totalShares > 0 && totalCost > 0) return roundPrice(totalCost / totalShares);

  const firstSellPrice = Number(executions.find((execution) => String(execution.side).toLowerCase() === "sell")?.price ?? 0);
  return firstSellPrice > 0 ? roundPrice(firstSellPrice) : null;
}

function inferCostBasisFromSell(execution: { amount: unknown; fee: unknown; realizedPnl: unknown; shares: unknown }) {
  const amount = Number(execution.amount ?? 0);
  const fee = Number(execution.fee ?? 0);
  const realizedPnl = Number(execution.realizedPnl ?? NaN);
  const shares = Number(execution.shares ?? 0);
  if (!Number.isFinite(realizedPnl) || amount <= 0 || shares <= 0) return null;

  const grossCostBeforeBuyFee = amount - fee - realizedPnl;
  if (grossCostBeforeBuyFee <= 0) return null;
  const minFeeCost = grossCostBeforeBuyFee - calculateTradeFee(0);
  const cost = minFeeCost < TRADING_FEE_MIN_BASE
    ? minFeeCost
    : grossCostBeforeBuyFee / (1 + TRADING_FEE_RATE);
  return cost > 0 ? { cost, shares } : null;
}

function legacyOpeningTime(item: WatchlistPositionRow, executions: Array<{ executedAt: Date; createdAt: Date }>) {
  if (item.positionOpenedAt) return item.positionOpenedAt;
  const firstExecution = executions[0];
  if (firstExecution?.executedAt) return new Date(firstExecution.executedAt.getTime() - 60_000);
  return new Date();
}
