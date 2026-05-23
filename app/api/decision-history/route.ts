import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";

import { getCurrentUser } from "@/lib/currentUser";
import { apiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const params = request.nextUrl.searchParams;
    const limit = Math.min(Number(params.get("limit") || 5), 50);
    const symbol = params.get("symbol");
    const action = params.get("action");
    const riskLevel = params.get("riskLevel");
    const date = params.get("date");
    const where: Prisma.DecisionHistoryWhereInput = { userId: user.id };

    if (symbol) where.symbol = { contains: symbol.trim(), mode: "insensitive" };
    if (action && action !== "all") where.action = action;
    if (riskLevel && riskLevel !== "all") where.riskLevel = riskLevel;
    if (date) {
      const start = new Date(`${date}T00:00:00`);
      const end = new Date(`${date}T23:59:59.999`);
      if (!Number.isNaN(start.getTime())) where.decisionTime = { gte: start, lte: end };
    }

    const records = await prisma.decisionHistory.findMany({
      where,
      orderBy: { decisionTime: "desc" },
      take: limit
    });

    return Response.json({
      records: records.map((record) => ({
        id: record.id,
        runId: record.runId,
        analysisId: record.analysisId,
        symbol: record.symbol,
        stockName: record.stockName,
        decisionTime: record.decisionTime.toISOString(),
        source: record.source,
        strategyDirection: record.strategyDirection,
        action: record.action,
        riskLevel: record.riskLevel,
        confidence: record.confidence === null ? null : Number(record.confidence),
        summary: record.summary,
        keyReasons: record.keyReasons,
        entryRange: record.entryRange,
        stopLoss: record.stopLoss,
        takeProfit: record.takeProfit,
        invalidationCondition: record.invalidationCondition,
        fallbackUsed: record.fallbackUsed,
        rawModelName: record.rawModelName,
        previousAction: record.previousAction,
        previousStrategyDirection: record.previousStrategyDirection,
        changeSummary: record.changeSummary
      }))
    });
  } catch (error) {
    return apiError(error);
  }
}
