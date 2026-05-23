import { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/currentUser";
import { apiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") || 10), 30);
    const runs = await prisma.analysisRun.findMany({
      where: { userId: user.id },
      include: { items: { orderBy: { createdAt: "asc" } } },
      orderBy: { startedAt: "desc" },
      take: limit
    });
    const latest = runs[0] ?? null;
    const todayStart = startOfToday();
    const todayRuns = runs.filter((run) => run.startedAt >= todayStart);
    return Response.json({
      summary: {
        nextRunAt: latest?.nextRunAt?.toISOString() ?? null,
        todayRunCount: todayRuns.length,
        latestStatus: latest?.status ?? "idle",
        latestStartedAt: latest?.startedAt.toISOString() ?? null,
        latestFinishedAt: latest?.finishedAt?.toISOString() ?? null,
        successCount: latest?.successCount ?? 0,
        failedCount: latest?.failedCount ?? 0,
        fallbackCount: latest?.items.filter((item) => item.fallbackUsed).length ?? 0
      },
      runs: runs.map((run) => ({
        id: run.id,
        runType: run.runType,
        status: run.status,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
        durationMs: run.durationMs,
        totalSymbols: run.totalSymbols,
        successCount: run.successCount,
        failedCount: run.failedCount,
        nextRunAt: run.nextRunAt?.toISOString() ?? null,
        fallbackUsed: run.fallbackUsed,
        errorSummary: run.errorSummary,
        items: run.items.map((item) => ({
          id: item.id,
          symbol: item.symbol,
          stockName: item.stockName,
          status: item.status,
          decisionId: item.decisionId,
          aiStatus: item.aiStatus,
          quoteStatus: item.quoteStatus,
          newsStatus: item.newsStatus,
          errorMessage: item.errorMessage,
          durationMs: item.durationMs,
          aiDurationMs: item.aiDurationMs,
          quoteDurationMs: item.quoteDurationMs,
          newsDurationMs: item.newsDurationMs,
          fallbackUsed: item.fallbackUsed,
          createdAt: item.createdAt.toISOString()
        }))
      }))
    });
  } catch (error) {
    return apiError(error);
  }
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
