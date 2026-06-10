import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";

import { getCurrentUser } from "@/lib/currentUser";
import { buildDecisionChange } from "@/lib/decision/change";
import { apiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { boundedIntParam } from "@/lib/queryParams";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const params = request.nextUrl.searchParams;
    const limit = boundedIntParam(params.get("limit"), 5, 1, 50);
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
    const previousRecords = await Promise.all(
      records.map((record) =>
        prisma.decisionHistory.findFirst({
          where: {
            userId: user.id,
            symbol: record.symbol,
            decisionTime: { lt: record.decisionTime }
          },
          orderBy: { decisionTime: "desc" }
        })
      )
    );

    return Response.json({
      records: records.map((record, index) => ({
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
        changeSummary: record.changeSummary,
        change: buildDecisionChange(toDecisionSnapshot(previousRecords[index]), toDecisionSnapshot(record) ?? {})
      }))
    });
  } catch (error) {
    return apiError(error);
  }
}

function toDecisionSnapshot(record?: {
  action?: string | null;
  strategyDirection?: string | null;
  riskLevel?: string | null;
  confidence?: Prisma.Decimal | number | null;
} | null) {
  if (!record) return null;
  return {
    action: record.action ?? null,
    strategyDirection: record.strategyDirection ?? null,
    riskLevel: record.riskLevel ?? null,
    confidence: record.confidence === null || record.confidence === undefined ? null : Number(record.confidence)
  };
}
