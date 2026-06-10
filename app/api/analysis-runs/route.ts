import { NextRequest } from "next/server";

import { getFocusStockAnalysisConcurrency } from "@/lib/ai/config";
import { getCurrentUser } from "@/lib/currentUser";
import { apiError } from "@/lib/errors";
import { nextMarketScheduledTime } from "@/lib/marketCalendar";
import { prisma } from "@/lib/prisma";
import { boundedIntParam } from "@/lib/queryParams";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const limit = boundedIntParam(request.nextUrl.searchParams.get("limit"), 10, 1, 30);
    const runs = await prisma.analysisRun.findMany({
      where: { userId: user.id },
      include: { items: { orderBy: { createdAt: "asc" } } },
      orderBy: { startedAt: "desc" },
      take: limit
    });
    const focus = await prisma.focusGroup.findUnique({
      where: { userId: user.id },
      select: { analysisTimes: true }
    });
    const latest = runs[0] ?? null;
    const todayStart = startOfToday();
    const todayRuns = runs.filter((run) => run.startedAt >= todayStart);
    const nextRunAt = resolveNextRunAt(latest?.nextRunAt ?? null, focus?.analysisTimes ?? []);
    const latestMetrics = latest ? aggregateRunMetrics(latest.items) : emptyMetrics();
    const runningCount = runs.filter((run) => run.status === "running").length;
    const runningItems = runs.reduce((total, run) => total + run.items.filter((item) => item.status === "running").length, 0);
    const focusStockAnalysisLimit = await getFocusStockAnalysisConcurrency();
    return Response.json({
      summary: {
        nextRunAt: nextRunAt?.toISOString() ?? null,
        todayRunCount: todayRuns.length,
        runningCount,
        latestRunId: latest?.id ?? null,
        latestRunType: latest?.runType ?? null,
        latestStatus: latest?.status ?? "idle",
        latestStartedAt: latest?.startedAt.toISOString() ?? null,
        latestFinishedAt: latest?.finishedAt?.toISOString() ?? null,
        latestDurationMs: latest?.durationMs ?? null,
        successCount: latest?.successCount ?? 0,
        failedCount: latest?.failedCount ?? 0,
        totalSymbols: latest?.totalSymbols ?? 0,
        fallbackCount: latest?.items.filter((item) => item.fallbackUsed).length ?? 0,
        latestFallbackUsed: latest?.fallbackUsed ?? false,
        latestErrorSummary: latest?.errorSummary ?? null,
        latestMetrics,
        concurrency: {
          runningRuns: runningCount,
          runningItems,
          jobWorkerLimit: clamp(numberEnv("MAX_CONCURRENT_JOBS", 3), 1, 8),
          focusStockAnalysisLimit,
          quoteRequestLimit: Math.max(1, numberEnv("MAX_EXTERNAL_API_CONCURRENT", 2))
        }
      },
      runs: runs.map((run) => {
        const metrics = aggregateRunMetrics(run.items);
        return {
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
        metrics,
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
      };
      })
    });
  } catch (error) {
    return apiError(error);
  }
}

function aggregateRunMetrics(items: Array<{ durationMs: number | null; aiDurationMs: number | null; quoteDurationMs: number | null; newsDurationMs: number | null; status: string }>) {
  return {
    totalItemDurationMs: sum(items.map((item) => item.durationMs)),
    aiDurationMs: sum(items.map((item) => item.aiDurationMs)),
    quoteDurationMs: sum(items.map((item) => item.quoteDurationMs)),
    newsDurationMs: sum(items.map((item) => item.newsDurationMs)),
    averageItemDurationMs: average(items.map((item) => item.durationMs)),
    runningItems: items.filter((item) => item.status === "running").length
  };
}

function emptyMetrics() {
  return {
    totalItemDurationMs: 0,
    aiDurationMs: 0,
    quoteDurationMs: 0,
    newsDurationMs: 0,
    averageItemDurationMs: null,
    runningItems: 0
  };
}

function sum(values: Array<number | null | undefined>) {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function average(values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => typeof value === "number");
  if (!valid.length) return null;
  return Math.round(sum(valid) / valid.length);
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function resolveNextRunAt(stored: Date | null, times: string[]) {
  const now = new Date();
  if (stored && stored.getTime() > now.getTime()) return stored;
  return nextMarketScheduledTime(times, now);
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
