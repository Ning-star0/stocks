import { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/currentUser";
import { feedbackActionLabel, normalizeFeedbackAction, verifyDecisionFeedbackToken } from "@/lib/decisionFeedback";
import { apiError, AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import {
  assertValidTradeShares,
  baseSymbol,
  deleteTradeExecutionAndRebuild,
  parsePositiveNumber,
  upsertFeedbackTradeAndRebuild
} from "@/lib/trades/ledger";

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
      let positionAfterDelete = null;

      if (existing?.tradeExecution) {
        const existingTrade = getExistingSyncedTrade(existing);
        const nextTrade = shouldSyncPosition
          ? { symbol: tradeSymbol!, side: tradeSide! as "buy" | "sell", price: executedPrice!, shares: executedShares! }
          : null;
        if (!nextTrade || !existingTrade || !isSameTrade(existingTrade, nextTrade)) {
          const deleted = await deleteTradeExecutionAndRebuild(tx, {
            userId: decision.userId,
            executionId: existing.tradeExecution.id
          });
          positionAfterDelete = deleted.position;
        }
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
        ? await upsertFeedbackTradeAndRebuild(tx, {
            userId: decision.userId,
            feedbackId: feedback.id,
            symbol: tradeSymbol!,
            side: tradeSide!,
            price: executedPrice!,
            shares: executedShares!,
            note
          })
        : null;
      return { feedback, position: syncResult?.position ?? positionAfterDelete, execution: syncResult?.execution ?? null };
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
  return baseSymbol(a.symbol) === baseSymbol(b.symbol) && a.side === b.side && a.shares === b.shares && Math.abs(a.price - b.price) < 0.0001;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
