import { getCurrentUser } from "@/lib/currentUser";
import { createAnalysisRun, createDecisionHistoryFromAnalysis, finishAnalysisRunItem, startAnalysisRunItem } from "@/lib/analysis/runRecords";
import { getFocusStockAnalysisConcurrency } from "@/lib/ai/config";
import { runStockAnalysis } from "@/lib/analysis/stockAnalysisRunner";
import { mapWithConcurrency } from "@/lib/concurrency/pLimit";
import { apiError } from "@/lib/errors";
import { generateAndStoreFocusDecision, getLatestStoredFocusDecision } from "@/lib/focus/decision";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const user = await getCurrentUser();
    const decision = await getLatestStoredFocusDecision(user.id);
    if (!decision) {
      return Response.json({
        decisionUnavailable: true,
        message: "还没有定时生成的策略观察。到达你设置的自动分析时间后，系统会自动生成并保存。"
      });
    }
    return Response.json(decision);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST() {
  try {
    const user = await getCurrentUser();
    const focus = await prisma.focusGroup.findUnique({ where: { userId: user.id } });
    const run = await createAnalysisRun({
      userId: user.id,
      runType: "manual",
      totalSymbols: focus?.symbols.length ?? 0
    });
    await mapWithConcurrency(focus?.symbols ?? [], await getFocusStockAnalysisConcurrency(), (symbol) => analyzeFocusSymbol(user.id, run.id, symbol));
    const decision = await generateAndStoreFocusDecision({
      userId: user.id,
      forceRefresh: true,
      source: "manual",
      runId: run.id,
      createRunItems: false
    });
    return Response.json(decision);
  } catch (error) {
    return apiError(error);
  }
}

async function analyzeFocusSymbol(userId: string, runId: string, symbol: string) {
  const item = await startAnalysisRunItem({ runId, symbol }).catch(() => null);
  try {
    const result = await runStockAnalysis({
      userId,
      symbol,
      reason: "今日关注手动重新分析",
      inputHash: null,
      forceRefresh: true
    });
    const watchlistItem = await prisma.watchlistItem.findFirst({
      where: { symbol, watchlist: { userId } }
    });
    const history = await createDecisionHistoryFromAnalysis({
      userId,
      runId,
      analysisId: result.analysisId,
      symbol,
      source: "manual",
      riskLevel: watchlistItem?.riskLevel ?? null,
      outputJson: result.outputJson
    }).catch(() => null);
    await finishAnalysisRunItem({
      itemId: item?.id,
      runId,
      symbol,
      status: result.fromCache ? "skipped" : "success",
      decisionId: history?.id ?? null,
      aiStatus: isFallbackOutput(result.outputJson) ? "fallback" : "success",
      quoteStatus: "success",
      newsStatus: "success",
      durationMs: result.durationMs,
      aiDurationMs: "aiDurationMs" in result.timings ? result.timings.aiDurationMs : null,
      quoteDurationMs: result.timings?.quoteDurationMs ?? null,
      newsDurationMs: result.timings?.newsDurationMs ?? null,
      fallbackUsed: isFallbackOutput(result.outputJson)
    });
  } catch (error) {
    await finishAnalysisRunItem({
      itemId: item?.id,
      runId,
      symbol,
      status: "failed",
      aiStatus: "failed",
      quoteStatus: "failed",
      newsStatus: "skipped",
      errorMessage: error instanceof Error ? error.message : "未知错误"
    });
  }
}

function isFallbackOutput(output: unknown) {
  return Boolean(output && typeof output === "object" && "isFallback" in output && (output as { isFallback?: unknown }).isFallback);
}
