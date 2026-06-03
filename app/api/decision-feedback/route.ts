import { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/currentUser";
import { feedbackActionLabel, normalizeFeedbackAction, verifyDecisionFeedbackToken } from "@/lib/decisionFeedback";
import { apiError, AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

const TRADING_LOT_SIZE = 100;
const TRADING_FEE_RATE = 0.0005;
const TRADING_FEE_MIN_BASE = 10000;

export async function POST(request: NextRequest) {
  try {
    const input = await parseFeedbackInput(request);
    const decision = await prisma.focusDecision.findUnique({
      where: { id: input.decisionId },
      select: { id: true, userId: true, decisionJson: true }
    });
    if (!decision) throw new AppError("BAD_REQUEST", "这条 AI 决策不存在。");
    await assertCanWriteFeedback({ userId: decision.userId, decisionId: decision.id, token: input.token });

    const action = normalizeFeedbackAction(input.feedbackAction);
    const note = input.note.trim() || null;
    const executedPrice = parsePositiveNumber(input.executedPrice);
    const executedShares = parsePositiveNumber(input.executedShares);
    const tradeSide = normalizeTradeSide(input.tradeSide, action);
    const tradeSymbol = normalizeTradeSymbol(input.tradeSymbol, tradeSide ? decision : null, tradeSide);
    const shouldSyncPosition = Boolean(tradeSide && tradeSymbol && executedPrice && executedShares && (action === "bought" || action === "sold"));
    if (shouldSyncPosition) assertValidTradeShares(executedShares);

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.decisionFeedback.findUnique({
        where: { decisionId: decision.id },
        include: { tradeExecution: true }
      });

      if (existing?.positionSyncedAt) {
        const existingTrade = getExistingSyncedTrade(existing);
        const nextTrade = shouldSyncPosition
          ? { symbol: tradeSymbol!, side: tradeSide! as "buy" | "sell", price: executedPrice!, shares: executedShares! }
          : null;
        if (nextTrade && existingTrade && isSameTrade(existingTrade, nextTrade)) {
          const feedback = await tx.decisionFeedback.update({
            where: { id: existing.id },
            data: { feedbackAction: action, note, executedPrice, executedShares, tradeSymbol, tradeSide }
          });
          const execution = existing.tradeExecution ?? await createTradeExecutionMarker(tx, {
            userId: decision.userId,
            feedbackId: feedback.id,
            trade: nextTrade,
            note
          });
          return { feedback, position: await findSerializedPosition(tx, decision.userId, nextTrade.symbol), execution };
        }
        if (existingTrade) {
          await reverseSyncedTrade(tx, {
            userId: decision.userId,
            trade: existingTrade
          });
        }
        if (existing.tradeExecution) await tx.tradeExecution.delete({ where: { id: existing.tradeExecution.id } });
      }

      const feedback = await tx.decisionFeedback.upsert({
        where: { decisionId: decision.id },
        create: {
          userId: decision.userId,
          decisionId: decision.id,
          feedbackAction: action,
          note,
          executedPrice,
          executedShares,
          tradeSymbol,
          tradeSide,
          positionSyncedAt: shouldSyncPosition ? new Date() : null
        },
        update: {
          feedbackAction: action,
          note,
          executedPrice,
          executedShares,
          tradeSymbol,
          tradeSide,
          positionSyncedAt: shouldSyncPosition ? new Date() : null
        }
      });
      const syncResult = shouldSyncPosition
        ? await syncWatchlistPositionAndCreateExecution(tx, {
            userId: decision.userId,
            feedbackId: feedback.id,
            symbol: tradeSymbol!,
            side: tradeSide!,
            price: executedPrice!,
            shares: executedShares!,
            note
          })
        : null;
      return { feedback, position: syncResult?.position ?? null, execution: syncResult?.execution ?? null };
    });
    const feedback = result.feedback;

    if (input.respondWithJson) {
      return Response.json({
        ok: true,
        feedback: {
          id: feedback.id,
          action,
          label: feedbackActionLabel(action),
          note: feedback.note,
          executedPrice: feedback.executedPrice ? Number(feedback.executedPrice) : null,
          executedShares: feedback.executedShares ? Number(feedback.executedShares) : null,
          tradeSymbol: feedback.tradeSymbol,
          tradeSide: feedback.tradeSide,
          positionSyncedAt: feedback.positionSyncedAt?.toISOString() ?? null,
          position: result.position,
          execution: result.execution ? {
            id: result.execution.id,
            symbol: result.execution.symbol,
            side: result.execution.side,
            amount: Number(result.execution.amount),
            fee: Number(result.execution.fee),
            netCashChange: Number(result.execution.netCashChange),
            realizedPnl: result.execution.realizedPnl === null ? null : Number(result.execution.realizedPnl)
          } : null,
          updatedAt: feedback.updatedAt.toISOString()
        }
      });
    }

    const url = new URL("/feedback/decision", request.url);
    url.searchParams.set("decisionId", decision.id);
    url.searchParams.set("token", input.token);
    url.searchParams.set("action", action);
    url.searchParams.set("saved", "1");
    return Response.redirect(url, 303);
  } catch (error) {
    return apiError(error);
  }
}

async function assertCanWriteFeedback(input: { userId: string; decisionId: string; token?: string | null }) {
  if (verifyDecisionFeedbackToken(input)) return;

  const currentUser = await getCurrentUser().catch(() => null);
  if (currentUser?.id === input.userId) return;

  throw new AppError("UNAUTHORIZED", "反馈链接已失效，或当前账号无权修改这条反馈。");
}

async function parseFeedbackInput(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    return {
      decisionId: String(body.decisionId ?? ""),
      token: String(body.token ?? ""),
      feedbackAction: String(body.feedbackAction ?? body.action ?? ""),
      note: String(body.note ?? ""),
      executedPrice: body.executedPrice,
      executedShares: body.executedShares,
      tradeSymbol: body.tradeSymbol,
      tradeSide: body.tradeSide ?? body.tradeSymbol,
      respondWithJson: true
    };
  }
  const form = await request.formData();
  return {
    decisionId: String(form.get("decisionId") ?? ""),
    token: String(form.get("token") ?? ""),
    feedbackAction: String(form.get("feedbackAction") ?? form.get("action") ?? ""),
    note: String(form.get("note") ?? ""),
    executedPrice: form.get("executedPrice"),
    executedShares: form.get("executedShares"),
    tradeSymbol: form.get("tradeSymbol"),
    tradeSide: form.get("tradeSide") ?? form.get("tradeSymbol"),
    respondWithJson: false
  };
}

function parsePositiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeTradeSide(value: unknown, action: string) {
  const side = String(value ?? "").trim().toLowerCase();
  if (side.startsWith("buy:")) return "buy";
  if (side.startsWith("sell:")) return "sell";
  if (side === "buy" || side === "sell") return side;
  if (action === "bought") return "buy";
  if (action === "sold") return "sell";
  return null;
}

function normalizeTradeSymbol(value: unknown, decision: { decisionJson: unknown } | null, tradeSide: "buy" | "sell" | null) {
  const raw = String(value ?? "").trim();
  const direct = raw.includes(":") ? raw.split(":").slice(1).join(":").trim().toUpperCase() : raw.toUpperCase();
  if (direct) return direct;
  if (!decision || !tradeSide || !isRecord(decision.decisionJson)) return null;
  const key = tradeSide === "buy" ? "orders" : "sellOrders";
  const orders = Array.isArray(decision.decisionJson[key]) ? decision.decisionJson[key].filter(isRecord) : [];
  return orders.length === 1 && typeof orders[0].symbol === "string" ? orders[0].symbol.toUpperCase() : null;
}

function assertValidTradeShares(shares: number | null) {
  if (!shares || shares < TRADING_LOT_SIZE || shares % TRADING_LOT_SIZE !== 0) {
    throw new AppError("BAD_REQUEST", `买入/卖出数量必须至少 ${TRADING_LOT_SIZE} 股/份，并且按 ${TRADING_LOT_SIZE} 股/份整数手填写。`);
  }
}

async function syncWatchlistPosition(
  tx: Prisma.TransactionClient,
  input: { userId: string; symbol: string; side: "buy" | "sell"; price: number; shares: number }
) {
  const item = await tx.watchlistItem.findFirst({
    where: { symbol: input.symbol, watchlist: { userId: input.userId } },
    select: { id: true, isHolding: true, holdingPrice: true, holdingShares: true, positionOpenedAt: true }
  });
  if (!item) throw new AppError("BAD_REQUEST", `自选股中找不到 ${input.symbol}，无法同步持仓。`);

  const currentShares = Number(item.holdingShares ?? 0);
  const currentPrice = Number(item.holdingPrice ?? 0);

  if (input.side === "buy") {
    const nextShares = currentShares + input.shares;
    const nextPrice = nextShares > 0 ? ((currentPrice * currentShares) + (input.price * input.shares)) / nextShares : input.price;
    const updated = await tx.watchlistItem.update({
      where: { id: item.id },
      data: {
        isHolding: true,
        holdingPrice: Number(nextPrice.toFixed(4)),
        holdingShares: Number(nextShares.toFixed(4)),
        positionOpenedAt: item.positionOpenedAt ?? new Date()
      },
      select: { symbol: true, isHolding: true, holdingPrice: true, holdingShares: true, positionOpenedAt: true }
    });
    return serializePosition(updated);
  }

  const nextShares = Math.max(0, currentShares - input.shares);
  const updated = await tx.watchlistItem.update({
    where: { id: item.id },
    data: nextShares > 0
      ? { isHolding: true, holdingShares: Number(nextShares.toFixed(4)) }
      : { isHolding: false, holdingPrice: null, holdingShares: null, positionOpenedAt: null },
    select: { symbol: true, isHolding: true, holdingPrice: true, holdingShares: true, positionOpenedAt: true }
  });
  return serializePosition(updated);
}

async function syncWatchlistPositionAndCreateExecution(
  tx: Prisma.TransactionClient,
  input: { userId: string; feedbackId: string; symbol: string; side: "buy" | "sell"; price: number; shares: number; note: string | null }
) {
  const positionBefore = await tx.watchlistItem.findFirst({
    where: { symbol: input.symbol, watchlist: { userId: input.userId } },
    select: { holdingPrice: true, holdingShares: true }
  });
  const currentShares = Number(positionBefore?.holdingShares ?? 0);
  if (input.side === "sell" && input.shares > currentShares) {
    throw new AppError("BAD_REQUEST", `卖出数量不能超过当前持仓。当前 ${currentShares || 0} 股/份，计划卖出 ${input.shares} 股/份。`);
  }
  const position = await syncWatchlistPosition(tx, input);
  const execution = await createTradeExecutionMarker(tx, {
    userId: input.userId,
    feedbackId: input.feedbackId,
    trade: input,
    holdingPrice: Number(positionBefore?.holdingPrice ?? 0),
    note: input.note
  });
  return { position, execution };
}

async function createTradeExecutionMarker(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    feedbackId: string;
    trade: { symbol: string; side: "buy" | "sell"; price: number; shares: number };
    holdingPrice?: number | null;
    note: string | null;
  }
) {
  const amount = roundMoney(input.trade.price * input.trade.shares);
  const fee = calculateTradeFee(amount);
  const realizedPnl = input.trade.side === "sell" && input.holdingPrice && input.holdingPrice > 0
    ? roundMoney(amount - fee - input.holdingPrice * input.trade.shares - calculateTradeFee(input.holdingPrice * input.trade.shares))
    : null;
  return tx.tradeExecution.upsert({
    where: { feedbackId: input.feedbackId },
    create: {
      userId: input.userId,
      feedbackId: input.feedbackId,
      symbol: input.trade.symbol,
      side: input.trade.side,
      price: input.trade.price,
      shares: input.trade.shares,
      amount,
      fee,
      netCashChange: input.trade.side === "buy" ? -roundMoney(amount + fee) : roundMoney(amount - fee),
      realizedPnl,
      note: input.note
    },
    update: {
      symbol: input.trade.symbol,
      side: input.trade.side,
      price: input.trade.price,
      shares: input.trade.shares,
      amount,
      fee,
      netCashChange: input.trade.side === "buy" ? -roundMoney(amount + fee) : roundMoney(amount - fee),
      realizedPnl,
      note: input.note
    }
  });
}

async function reverseSyncedTrade(
  tx: Prisma.TransactionClient,
  input: { userId: string; trade: { symbol: string; side: "buy" | "sell"; price: number; shares: number } }
) {
  const item = await tx.watchlistItem.findFirst({
    where: { symbol: input.trade.symbol, watchlist: { userId: input.userId } },
    select: { id: true, isHolding: true, holdingPrice: true, holdingShares: true, positionOpenedAt: true }
  });
  if (!item) return;
  const currentShares = Number(item.holdingShares ?? 0);
  const currentPrice = Number(item.holdingPrice ?? 0);
  if (input.trade.side === "buy") {
    const nextShares = Math.max(0, currentShares - input.trade.shares);
    if (nextShares <= 0) {
      await tx.watchlistItem.update({
        where: { id: item.id },
        data: { isHolding: false, holdingPrice: null, holdingShares: null, positionOpenedAt: null }
      });
      return;
    }
    const previousCost = Math.max(0, currentPrice * currentShares - input.trade.price * input.trade.shares);
    const nextPrice = previousCost > 0 ? previousCost / nextShares : currentPrice;
    await tx.watchlistItem.update({
      where: { id: item.id },
      data: { isHolding: true, holdingPrice: Number(nextPrice.toFixed(4)), holdingShares: Number(nextShares.toFixed(4)) }
    });
    return;
  }

  const nextShares = currentShares + input.trade.shares;
  const nextPrice = nextShares > 0 ? ((currentPrice * currentShares) + (input.trade.price * input.trade.shares)) / nextShares : input.trade.price;
  await tx.watchlistItem.update({
    where: { id: item.id },
    data: {
      isHolding: true,
      holdingPrice: Number(nextPrice.toFixed(4)),
      holdingShares: Number(nextShares.toFixed(4)),
      positionOpenedAt: item.positionOpenedAt ?? new Date()
    }
  });
}

async function findSerializedPosition(tx: Prisma.TransactionClient, userId: string, symbol: string) {
  const position = await tx.watchlistItem.findFirst({
    where: { symbol, watchlist: { userId } },
    select: { symbol: true, isHolding: true, holdingPrice: true, holdingShares: true, positionOpenedAt: true }
  });
  return position ? serializePosition(position) : null;
}

function getExistingSyncedTrade(feedback: {
  tradeSymbol: string | null;
  tradeSide: string | null;
  executedPrice: unknown;
  executedShares: unknown;
  tradeExecution?: { symbol: string; side: string; price: unknown; shares: unknown } | null;
}) {
  const execution = feedback.tradeExecution;
  const symbol = String(execution?.symbol ?? feedback.tradeSymbol ?? "").toUpperCase();
  const side = String(execution?.side ?? feedback.tradeSide ?? "").toLowerCase();
  const price = Number(execution?.price ?? feedback.executedPrice);
  const shares = Number(execution?.shares ?? feedback.executedShares);
  if (!symbol || (side !== "buy" && side !== "sell") || !Number.isFinite(price) || !Number.isFinite(shares)) return null;
  return { symbol, side, price, shares } as { symbol: string; side: "buy" | "sell"; price: number; shares: number };
}

function isSameTrade(
  a: { symbol: string; side: "buy" | "sell"; price: number; shares: number },
  b: { symbol: string; side: "buy" | "sell"; price: number; shares: number }
) {
  return a.symbol === b.symbol && a.side === b.side && a.shares === b.shares && Math.abs(a.price - b.price) < 0.0001;
}

function calculateTradeFee(amount: number) {
  return roundMoney(Math.max(amount, TRADING_FEE_MIN_BASE) * TRADING_FEE_RATE);
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function serializePosition(position: { symbol: string; isHolding: boolean; holdingPrice: unknown; holdingShares: unknown; positionOpenedAt: Date | null }) {
  return {
    symbol: position.symbol,
    isHolding: position.isHolding,
    holdingPrice: position.holdingPrice === null ? null : Number(position.holdingPrice),
    holdingShares: position.holdingShares === null ? null : Number(position.holdingShares),
    positionOpenedAt: position.positionOpenedAt?.toISOString() ?? null
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
