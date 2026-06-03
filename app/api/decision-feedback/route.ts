import { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/currentUser";
import { feedbackActionLabel, normalizeFeedbackAction, verifyDecisionFeedbackToken } from "@/lib/decisionFeedback";
import { apiError, AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

const TRADING_LOT_SIZE = 100;

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
      const position = shouldSyncPosition
        ? await syncWatchlistPosition(tx, {
            userId: decision.userId,
            symbol: tradeSymbol!,
            side: tradeSide!,
            price: executedPrice!,
            shares: executedShares!
          })
        : null;
      return { feedback, position };
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
