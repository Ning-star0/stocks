import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser, getDefaultWatchlist } from "@/lib/currentUser";
import { invalidateDashboardCache } from "@/lib/dashboardCache";
import { apiError } from "@/lib/errors";
import { enqueueJob } from "@/lib/jobs/enqueueJob";
import { JOB_PRIORITY, JOB_TYPES } from "@/lib/jobs/jobTypes";
import { prisma } from "@/lib/prisma";
import { readRequestJson } from "@/lib/serverApi";
import { createWatchlistItemSchema } from "@/lib/schemas";
import { serializeWatchlistItem } from "@/lib/serializers";
import { normalizeStockSymbolForMarket } from "@/lib/symbols";

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const rawBody = await readRequestJson<Record<string, unknown>>(request);
    const body = createWatchlistItemSchema.parse(rawBody);
    const symbol = normalizeStockSymbolForMarket(body.symbol, body.market);
    const watchlist = await getDefaultWatchlist(user.id);
    const createPosition = buildCreatePositionData(body);
    const updatePosition = buildUpdatePositionData(body, rawBody);

    const item = await prisma.watchlistItem.upsert({
      where: {
        watchlistId_symbol: {
          watchlistId: watchlist.id,
          symbol
        }
      },
      update: {
        market: body.market,
        note: hasOwn(rawBody, "note") && body.note?.trim() ? body.note : undefined,
        ...updatePosition,
        timeHorizon: hasOwn(rawBody, "timeHorizon") ? body.timeHorizon : undefined,
        riskLevel: hasOwn(rawBody, "riskLevel") ? body.riskLevel : undefined
      },
      create: {
        watchlistId: watchlist.id,
        symbol,
        market: body.market,
        note: body.note || null,
        ...createPosition,
        targetPrice: body.targetPrice ?? null,
        stopLoss: body.stopLoss ?? null,
        timeHorizon: body.timeHorizon,
        riskLevel: body.riskLevel
      }
    });

    // 新加了自选股，后台自动入队 AI 分析，不阻塞添加响应
    try {
      await enqueueJob({
        userId: user.id,
        symbol,
        jobType: JOB_TYPES.STOCK_ANALYSIS,
        priority: JOB_PRIORITY.SCHEDULED_REFRESH,
        payload: { reason: "新加入自选股，自动触发分析" }
      });
    } catch {
      // worker 没开或队列异常时也不影响添加操作
    }

    await invalidateDashboardCache(user.id);
    return NextResponse.json({ item: serializeWatchlistItem(item) }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

function buildCreatePositionData(body: ReturnType<typeof createWatchlistItemSchema.parse>) {
  const isHolding = body.isHolding ?? false;
  return {
    isHolding,
    holdingPrice: isHolding ? body.holdingPrice ?? null : null,
    holdingShares: isHolding ? body.holdingShares ?? null : null,
    positionOpenedAt: isHolding ? body.positionOpenedAt ?? new Date() : null
  };
}

function buildUpdatePositionData(body: ReturnType<typeof createWatchlistItemSchema.parse>, rawBody: Record<string, unknown>) {
  const isHoldingProvided = hasOwn(rawBody, "isHolding");
  const isHolding = body.isHolding ?? false;
  if (isHoldingProvided && !isHolding) {
    return {
      isHolding: false,
      holdingPrice: null,
      holdingShares: null,
      positionOpenedAt: null,
      targetPrice: body.targetPrice ?? undefined,
      stopLoss: body.stopLoss ?? undefined
    };
  }

  return {
    isHolding: isHoldingProvided ? isHolding : undefined,
    holdingPrice: isHoldingProvided || hasOwn(rawBody, "holdingPrice") ? body.holdingPrice ?? null : undefined,
    holdingShares: isHoldingProvided || hasOwn(rawBody, "holdingShares") ? body.holdingShares ?? null : undefined,
    positionOpenedAt: isHoldingProvided || hasOwn(rawBody, "positionOpenedAt") ? body.positionOpenedAt ?? (isHolding ? new Date() : null) : undefined,
    targetPrice: hasOwn(rawBody, "targetPrice") ? body.targetPrice ?? null : undefined,
    stopLoss: hasOwn(rawBody, "stopLoss") ? body.stopLoss ?? null : undefined
  };
}

function hasOwn(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
