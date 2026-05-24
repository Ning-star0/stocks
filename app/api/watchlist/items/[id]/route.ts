import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/currentUser";
import { invalidateDashboardCache } from "@/lib/dashboardCache";
import { apiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { updateWatchlistItemSchema } from "@/lib/schemas";
import { serializeWatchlistItem } from "@/lib/serializers";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await getCurrentUser();
    const body = updateWatchlistItemSchema.parse(await request.json());

    const item = await prisma.watchlistItem.findFirst({
      where: { id, watchlist: { userId: user.id } }
    });
    if (!item) return NextResponse.json({ error: { code: "SYMBOL_NOT_FOUND", message: "未找到该自选股。" } }, { status: 404 });

    const updated = await prisma.watchlistItem.update({
      where: { id },
      data: {
        note: body.note === undefined ? item.note : body.note || null,
        holdingPrice: body.holdingPrice === undefined ? item.holdingPrice : body.holdingPrice ?? null,
        targetPrice: body.targetPrice === undefined ? item.targetPrice : body.targetPrice ?? null,
        stopLoss: body.stopLoss === undefined ? item.stopLoss : body.stopLoss ?? null,
        positionOpenedAt: body.positionOpenedAt === undefined ? item.positionOpenedAt : body.positionOpenedAt ?? null,
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
