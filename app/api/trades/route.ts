import { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/currentUser";
import { apiError, AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { readRequestJson } from "@/lib/serverApi";
import {
  createManualTradeAndRebuild,
  parsePositiveNumber,
  parseTradeSide,
  reconcileAndRebuildUserPositions,
  rebuildUserPositions
} from "@/lib/trades/ledger";

export async function GET() {
  try {
    const user = await getCurrentUser();
    await prisma.$transaction((tx) => reconcileAndRebuildUserPositions(tx, user.id));
    const executions = await prisma.tradeExecution.findMany({
      where: { userId: user.id },
      orderBy: [{ executedAt: "desc" }, { createdAt: "desc" }],
      take: 20
    });
    return Response.json({
      executions: executions.map((execution) => ({
        id: execution.id,
        symbol: execution.symbol,
        side: execution.side,
        price: Number(execution.price),
        shares: Number(execution.shares),
        amount: Number(execution.amount),
        fee: Number(execution.fee),
        netCashChange: Number(execution.netCashChange),
        realizedPnl: execution.realizedPnl === null ? null : Number(execution.realizedPnl),
        executedAt: execution.executedAt.toISOString(),
        note: execution.note
      }))
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const body = await readRequestJson<Record<string, unknown>>(request);
    const symbol = String(body.symbol ?? "").trim().toUpperCase();
    const side = parseTradeSide(body.side);
    const price = parsePositiveNumber(body.price);
    const shares = parsePositiveNumber(body.shares);
    const executedAt = parseExecutedAt(body.executedAt);
    const note = String(body.note ?? "").trim() || null;

    if (!symbol) throw new AppError("BAD_REQUEST", "请选择交易标的。");
    if (!side) throw new AppError("BAD_REQUEST", "请选择买入或卖出。");
    if (!price) throw new AppError("BAD_REQUEST", "请输入有效成交价。");
    if (!shares) throw new AppError("BAD_REQUEST", "请输入有效成交数量。");

    const result = await prisma.$transaction(async (tx) => {
      return createManualTradeAndRebuild(tx, {
        userId: user.id,
        symbol,
        side,
        price,
        shares,
        executedAt,
        note
      });
    });

    return Response.json({
      ok: true,
      execution: {
        id: result.execution.id,
        symbol: result.execution.symbol,
        side: result.execution.side,
        price: Number(result.execution.price),
        shares: Number(result.execution.shares),
        amount: Number(result.execution.amount),
        fee: Number(result.execution.fee),
        netCashChange: Number(result.execution.netCashChange),
        realizedPnl: result.execution.realizedPnl === null ? null : Number(result.execution.realizedPnl),
        executedAt: result.execution.executedAt.toISOString(),
        note: result.execution.note
      },
      position: result.position
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new AppError("BAD_REQUEST", "缺少交易记录 ID。");

    const result = await prisma.$transaction(async (tx) => {
      const execution = await tx.tradeExecution.findFirst({
        where: { id, userId: user.id },
        select: { id: true, symbol: true }
      });
      if (!execution) throw new AppError("BAD_REQUEST", "交易记录不存在。");
      await tx.tradeExecution.delete({ where: { id: execution.id } });
      const positions = await rebuildUserPositions(tx, user.id, [execution.symbol]);
      return { deletedId: execution.id, position: positions[0] ?? null };
    });

    return Response.json({ ok: true, ...result });
  } catch (error) {
    return apiError(error);
  }
}

function parseExecutedAt(value: unknown) {
  if (!value) return new Date();
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new AppError("BAD_REQUEST", "交易时间格式无效。");
  return date;
}
