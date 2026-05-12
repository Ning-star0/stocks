import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser, getDefaultWatchlist } from "@/lib/currentUser";
import { AppError, apiError } from "@/lib/errors";
import { enqueueJob } from "@/lib/jobs/enqueueJob";
import { JOB_PRIORITY, JOB_TYPES } from "@/lib/jobs/jobTypes";
import { prisma } from "@/lib/prisma";
import { createWatchlistItemSchema } from "@/lib/schemas";
import { serializeWatchlistItem } from "@/lib/serializers";

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const body = createWatchlistItemSchema.parse(await request.json());
    const symbol = normalizeSymbolForStorage(body.symbol, body.market);
    const watchlist = await getDefaultWatchlist(user.id);

    const item = await prisma.watchlistItem.upsert({
      where: {
        watchlistId_symbol: {
          watchlistId: watchlist.id,
          symbol
        }
      },
      update: {
        market: body.market,
        note: body.note || null,
        holdingPrice: body.holdingPrice ?? null,
        targetPrice: body.targetPrice ?? null,
        stopLoss: body.stopLoss ?? null,
        positionOpenedAt: body.positionOpenedAt ?? null,
        timeHorizon: body.timeHorizon,
        riskLevel: body.riskLevel
      },
      create: {
        watchlistId: watchlist.id,
        symbol,
        market: body.market,
        note: body.note || null,
        holdingPrice: body.holdingPrice ?? null,
        targetPrice: body.targetPrice ?? null,
        stopLoss: body.stopLoss ?? null,
        positionOpenedAt: body.positionOpenedAt ?? null,
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

    return NextResponse.json({ item: serializeWatchlistItem(item) }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

function normalizeSymbolForStorage(symbol: string, market: string) {
  const normalized = symbol.trim().toUpperCase();
  if (market.toUpperCase() !== "CN" && !/^\d{6}(\.(SH|SZ|BJ))?$/.test(normalized)) return normalized;
  const code = normalized.replace(/\.(SH|SZ|BJ)$/, "");
  if (!/^\d{6}$/.test(code)) return normalized;
  if (normalized.endsWith(".SH") || normalized.endsWith(".SZ") || normalized.endsWith(".BJ")) return normalized;
  if (/^(5|6|9)/.test(code)) return `${code}.SH`;
  return `${code}.SZ`;
}
