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
    const focus = await prisma.focusGroup.findUnique({
      where: { userId: user.id },
      select: { analysisTimes: true }
    });
    const latest = runs[0] ?? null;
    const todayStart = startOfToday();
    const todayRuns = runs.filter((run) => run.startedAt >= todayStart);
    const nextRunAt = resolveNextRunAt(latest?.nextRunAt ?? null, focus?.analysisTimes ?? []);
    return Response.json({
      summary: {
        nextRunAt: nextRunAt?.toISOString() ?? null,
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

function resolveNextRunAt(stored: Date | null, times: string[]) {
  const now = new Date();
  if (stored && stored.getTime() > now.getTime()) return stored;
  return nextScheduledTime(times, now);
}

function nextScheduledTime(times: string[], now: Date) {
  const sorted = [...new Set(times)].filter(Boolean).sort();
  if (!sorted.length) return null;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const next = sorted.find((time) => minutesOfDay(time) > currentMinutes) ?? sorted[0];
  const [hour = "0", minute = "0"] = next.split(":");
  const date = new Date(now);
  date.setHours(Number(hour), Number(minute), 0, 0);
  if (date <= now) date.setDate(date.getDate() + 1);
  return date;
}

function minutesOfDay(time: string) {
  const [hour = "0", minute = "0"] = time.split(":");
  return Number(hour) * 60 + Number(minute);
}
