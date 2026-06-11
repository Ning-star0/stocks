import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/currentUser";
import { invalidateDashboardCache } from "@/lib/dashboardCache";
import { apiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { readRequestJson } from "@/lib/serverApi";
import { updateWatchlistItemSchema } from "@/lib/schemas";
import { serializeWatchlistItem } from "@/lib/serializers";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await getCurrentUser();
    const body = updateWatchlistItemSchema.parse(await readRequestJson(request));

    const item = await prisma.watchlistItem.findFirst({
      where: { id, watchlist: { userId: user.id } }
    });
    if (!item) return NextResponse.json({ error: { code: "SYMBOL_NOT_FOUND", message: "未找到该自选股。" } }, { status: 404 });

    const nextIsHolding = body.isHolding === undefined ? item.isHolding : body.isHolding;
    const updated = await prisma.watchlistItem.update({
      where: { id },
      data: {
        note: body.note === undefined ? item.note : body.note || null,
        isHolding: nextIsHolding,
        holdingPrice: nextIsHolding ? (body.holdingPrice === undefined ? item.holdingPrice : body.holdingPrice ?? null) : null,
        holdingShares: nextIsHolding ? (body.holdingShares === undefined ? item.holdingShares : body.holdingShares ?? null) : null,
        targetPrice: body.targetPrice === undefined ? item.targetPrice : body.targetPrice ?? null,
        stopLoss: body.stopLoss === undefined ? item.stopLoss : body.stopLoss ?? null,
        positionOpenedAt: nextIsHolding ? resolvePositionOpenedAt({
          input: body.positionOpenedAt,
          inputProvided: body.positionOpenedAt !== undefined,
          previous: item.positionOpenedAt,
          wasHolding: item.isHolding
        }) : null,
        timeHorizon: body.timeHorizon ?? item.timeHorizon,
        riskLevel: body.riskLevel ?? item.riskLevel
      }
    });

    await invalidateDashboardCache(user.id);
    return NextResponse.json({ item: serializeWatchlistItem(updated) });
  } catch (error) {
    return apiError(error);
  }
}

function resolvePositionOpenedAt(input: {
  input: Date | null | undefined;
  inputProvided: boolean;
  previous: Date | null;
  wasHolding: boolean;
}) {
  if (input.inputProvided) return input.input ?? null;
  if (input.previous) return input.previous;
  return input.wasHolding ? null : new Date();
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await getCurrentUser();

    const item = await prisma.watchlistItem.findFirst({
      where: { id, watchlist: { userId: user.id } }
    });

    if (!item) return NextResponse.json({ error: { code: "SYMBOL_NOT_FOUND", message: "未找到该自选股。" } }, { status: 404 });
    await prisma.watchlistItem.delete({ where: { id } });
    await invalidateDashboardCache(user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
