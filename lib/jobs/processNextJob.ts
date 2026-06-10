import { randomUUID } from "node:crypto";

import { createDecisionHistoryFromAnalysis, finishAnalysisRunItem, startAnalysisRunItem } from "@/lib/analysis/runRecords";
import { estimateAiCost, getAiConfig, getFocusStockAnalysisConcurrency, selectAiModel } from "@/lib/ai/config";
import { analyzeNews } from "@/lib/ai/analyzeNews";
import { generateDailyBrief } from "@/lib/briefs/generateDailyBrief";
import { evaluateAllActiveAlerts } from "@/lib/alerts/evaluateAlerts";
import { runStockAnalysis } from "@/lib/analysis/stockAnalysisRunner";
import { getCache, setCache } from "@/lib/cache";
import { mapWithConcurrency } from "@/lib/concurrency/pLimit";
import { invalidateDashboardCache } from "@/lib/dashboardCache";
import { generateAndStoreFocusDecision } from "@/lib/focus/decision";
import { JOB_STATUS, JOB_TYPES } from "@/lib/jobs/jobTypes";
import { fetchNewsForSymbol } from "@/lib/news/fetchNewsForSymbol";
import { saveNewsAnalysis } from "@/lib/news/store";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getQuotesBatch } from "@/lib/services/quoteService";
import { stockSymbolVariants } from "@/lib/symbols";

const workerId = `${process.pid}-${randomUUID()}`;
let lastTimeoutSweepAt = 0;

export async function processNextJob() {
  await failTimedOutJobsIfDue();
  const job = await lockNextQueuedJob();
  if (!job) return null;

  try {
    const result = await runJob(job);
    if (isRequeuedJobResult(result)) return result.job;
    return prisma.analysisJob.update({
      where: { id: job.id },
      data: {
        status: result.skippedCached ? JOB_STATUS.SKIPPED_CACHED : JOB_STATUS.COMPLETED,
        resultId: result.resultId ?? null,
        completedAt: new Date(),
        lockedAt: null,
        lockedBy: null
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    const canRetry = job.attempts < job.maxAttempts;
    return prisma.analysisJob.update({
      where: { id: job.id },
      data: {
        status: canRetry ? JOB_STATUS.QUEUED : JOB_STATUS.FAILED,
        errorMessage: message,
        completedAt: canRetry ? null : new Date(),
        lockedAt: null,
        lockedBy: null
      }
    });
  }
}

function isRequeuedJobResult(result: Awaited<ReturnType<typeof runJob>>): result is { requeued: true; job: NonNullable<Awaited<ReturnType<typeof lockNextQueuedJob>>> } {
  return Boolean("requeued" in result && result.requeued);
}

async function failTimedOutJobsIfDue() {
  const now = Date.now();
  if (now - lastTimeoutSweepAt < numberEnv("JOB_TIMEOUT_SWEEP_INTERVAL_SECONDS", 60) * 1000) return;
  lastTimeoutSweepAt = now;
  await failTimedOutJobs();
}

async function lockNextQueuedJob() {
  const guarded = await lockQueuedJob({
    NOT: {
      jobType: JOB_TYPES.FOCUS_DECISION,
      payload: { path: ["runId"], not: Prisma.JsonNull }
    }
  });
  if (guarded) return guarded;
  return lockQueuedJob({ jobType: JOB_TYPES.FOCUS_DECISION });
}

async function lockQueuedJob(extraWhere: Prisma.AnalysisJobWhereInput) {
  const job = await prisma.analysisJob.findFirst({
    where: { status: JOB_STATUS.QUEUED, ...extraWhere },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }]
  });
  if (!job) return null;

  const locked = await prisma.analysisJob.updateMany({
    where: { id: job.id, status: JOB_STATUS.QUEUED },
    data: {
      status: JOB_STATUS.RUNNING,
      lockedAt: new Date(),
      lockedBy: workerId,
      startedAt: job.startedAt ?? new Date(),
      attempts: { increment: 1 }
    }
  });
  if (locked.count !== 1) return null;

  return prisma.analysisJob.findUnique({ where: { id: job.id } });
}

async function failTimedOutJobs() {
  const timeoutSeconds = numberEnv("JOB_TIMEOUT_SECONDS", 120);
  const cutoff = new Date(Date.now() - timeoutSeconds * 1000);
  const timedOut = await prisma.analysisJob.findMany({
    where: {
      status: JOB_STATUS.RUNNING,
      lockedAt: { lt: cutoff }
    },
    take: 10
  });

  for (const job of timedOut) {
    await prisma.analysisJob.update({
      where: { id: job.id },
      data: {
        status: job.attempts < job.maxAttempts ? JOB_STATUS.QUEUED : JOB_STATUS.FAILED,
        errorMessage: "job_timeout",
        lockedAt: null,
        lockedBy: null,
        completedAt: job.attempts < job.maxAttempts ? null : new Date()
      }
    });
  }
}

async function runJob(job: NonNullable<Awaited<ReturnType<typeof lockNextQueuedJob>>>) {
  if (job.jobType === JOB_TYPES.FOCUS_STOCK_BATCH) {
    const payload = job.payload as { symbols?: string[]; reason?: string; runId?: string } | null;
    const symbols = [...new Set((payload?.symbols ?? []).map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
    if (!symbols.length) throw new Error("今日关注批量分析缺少股票代码。");

    await getQuotesBatch(symbols, { forceRefresh: true, allowStale: true }).catch(() => null);
    await mapWithConcurrency(symbols, await getFocusStockAnalysisConcurrency(), async (symbol) => {
      const runItem = payload?.runId ? await startAnalysisRunItem({ runId: payload.runId, symbol }).catch(() => null) : null;
      try {
        await analyzeStockAndRecord({
          userId: job.userId,
          symbol,
          reason: payload?.reason ?? "关注板块定时分析",
          source: "scheduled",
          runId: payload?.runId ?? null,
          runItemId: runItem?.id ?? null,
          forceRefresh: true
        });
      } catch (error) {
        await finishAnalysisRunItem({
          itemId: runItem?.id,
          runId: payload?.runId ?? null,
          symbol,
          status: "failed",
          aiStatus: "failed",
          quoteStatus: "failed",
          newsStatus: "skipped",
          errorMessage: error instanceof Error ? error.message : "未知错误"
        });
      }
    });
    await invalidateDashboardCache(job.userId);
    return { resultId: payload?.runId ?? "focus_stock_batch", skippedCached: false };
  }

  if (job.jobType === JOB_TYPES.STOCK_ANALYSIS) {
    if (!job.symbol) throw new Error("股票分析任务缺少股票代码。");
    const payload = job.payload as { reason?: string; refreshNews?: boolean; runId?: string } | null;
    const runItem = payload?.runId
      ? await startAnalysisRunItem({ runId: payload.runId, symbol: job.symbol }).catch(() => null)
      : null;

    // 定时新闻抓取：先实际抓取新闻入库，再运行股票分析
    if (payload?.refreshNews) {
      try {
        await fetchNewsForSymbol(job.symbol, job.userId);
      } catch {
        // 新闻抓取失败不应阻断后续股票分析
      }
    }

    try {
      const result = await analyzeStockAndRecord({
        userId: job.userId,
        symbol: job.symbol,
        inputHash: job.inputHash,
        jobId: job.id,
        reason: payload?.reason ?? "job_queue",
        source: payload?.reason?.includes("定时") ? "scheduled" : "manual",
        runId: payload?.runId ?? null,
        runItemId: runItem?.id ?? null,
        forceRefresh: payload?.reason?.includes("关注板块定时分析") ?? false
      });
      await invalidateDashboardCache(job.userId);
      return { resultId: result.analysisId, skippedCached: result.fromCache };
    } catch (error) {
      // 行情不可用时保存 fallback 分析，避免任务失败后无任何分析记录
      const message = error instanceof Error ? error.message : "未知错误";
      const fallback = await saveFallbackAnalysisForFailedStock(job.userId, job.symbol, message);
      if (fallback) {
        const history = await createDecisionHistoryFromAnalysis({
          userId: job.userId,
          runId: payload?.runId ?? null,
          analysisId: fallback.id,
          symbol: job.symbol,
          source: payload?.reason?.includes("定时") ? "scheduled" : "manual",
          outputJson: fallback.outputJson
        }).catch(() => null);
        await finishAnalysisRunItem({
          itemId: runItem?.id,
          runId: payload?.runId ?? null,
          symbol: job.symbol,
          status: "success",
          decisionId: history?.id ?? null,
          aiStatus: "fallback",
          quoteStatus: "failed",
          newsStatus: "skipped",
          errorMessage: message,
          fallbackUsed: true
        });
        await invalidateDashboardCache(job.userId);
        return { resultId: fallback.id, skippedCached: false };
      }
      await finishAnalysisRunItem({
        itemId: runItem?.id,
        runId: payload?.runId ?? null,
        symbol: job.symbol,
        status: "failed",
        aiStatus: "failed",
        quoteStatus: "failed",
        newsStatus: "skipped",
        errorMessage: message
      });
      throw error;
    }
  }

  if (job.jobType === JOB_TYPES.NEWS_ANALYSIS) {
    const payload = job.payload as { newsItemId?: string } | null;
    if (!payload?.newsItemId) throw new Error("新闻分析任务缺少 newsItemId。");
    const newsItem = await prisma.newsItem.findUnique({ where: { id: payload.newsItemId } });
    if (!newsItem) throw new Error("未找到新闻。");
    const existing = await prisma.newsAnalysis.findFirst({ where: { newsItemId: newsItem.id } });
    if (existing) return { resultId: existing.id, skippedCached: true };
    const cacheKey = `ai_news:${newsItem.id}`;
    const cached = await getCache<{ analysisId: string }>(cacheKey);
    if (cached) return { resultId: cached.analysisId, skippedCached: true };
    const analysis = await analyzeNews({
      title: newsItem.title,
      source: newsItem.source,
      publishedAt: newsItem.publishedAt.toISOString(),
      content: truncate(newsItem.rawContent ?? newsItem.summary ?? newsItem.title, 12000),
      candidateSymbols: newsItem.symbols,
      candidateSectors: newsItem.sectors
    });
    const saved = await saveNewsAnalysis(newsItem.id, analysis);
    await setCache(cacheKey, { analysisId: saved.id }, 24 * 60 * 60);
    const aiConfig = await getAiConfig();
    const promptTokens = Math.ceil(JSON.stringify({ title: newsItem.title, summary: newsItem.summary }).length / 4);
    const completionTokens = Math.ceil(JSON.stringify(analysis).length / 4);
    await prisma.aiUsageLog.create({
      data: {
        userId: job.userId,
        symbol: newsItem.symbols[0] ?? null,
        jobType: JOB_TYPES.NEWS_ANALYSIS,
        provider: aiConfig.baseUrl.includes("deepseek.com") ? "deepseek" : "openai-compatible",
        model: selectAiModel(aiConfig, "standard"),
        inputHash: job.inputHash,
        promptTokens,
        completionTokens,
        estimatedCost: estimateAiCost({ config: aiConfig, tier: "standard", promptTokens, completionTokens }),
        cacheHit: false,
        reason: "high_importance_news"
      }
    });
    return { resultId: saved.id, skippedCached: false };
  }

  if (job.jobType === JOB_TYPES.FOCUS_DECISION) {
    const payload = job.payload as { scheduledFor?: string; runId?: string } | null;
    const waitResult = await waitForFocusStockAnalyses(job.id, payload?.runId ?? null);
    if (waitResult) return waitResult;
    const decision = await generateAndStoreFocusDecision({
      userId: job.userId,
      forceRefresh: true,
      source: "scheduled",
      scheduledFor: payload?.scheduledFor ?? null,
      runId: payload?.runId ?? null
    });
    const resultId = "decisionId" in decision ? String(decision.decisionId) : "focus_decision";
    return { resultId, skippedCached: false };
  }

  if (job.jobType === JOB_TYPES.ALERT_CHECK) {
    const results = await evaluateAllActiveAlerts();
    return { resultId: String(results.filter((result) => result.triggered).length), skippedCached: false };
  }

  if (job.jobType === JOB_TYPES.DAILY_BRIEF) {
    const [watchlists, sectorWatches, newsItems] = await Promise.all([
      prisma.watchlist.findMany({ where: { userId: job.userId }, include: { items: true } }),
      prisma.sectorWatch.findMany({ where: { userId: job.userId } }),
      prisma.newsItem.findMany({
        select: {
          id: true,
          title: true,
          url: true,
          source: true,
          publishedAt: true,
          summary: true,
          symbols: true,
          sectors: true,
          sentiment: true,
          importance: true
        },
        orderBy: { publishedAt: "desc" },
        take: 30
      })
    ]);
    const output = await generateDailyBrief({
      watchlistItems: watchlists.flatMap((watchlist) => watchlist.items),
      sectorWatches,
      newsItems
    });
    const today = new Date();
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const brief = await prisma.dailyMarketBrief.upsert({
      where: { userId_date: { userId: job.userId, date } },
      update: output,
      create: { userId: job.userId, date, ...output }
    });
    return { resultId: brief.id, skippedCached: false };
  }

  throw new Error(`未知任务类型：${job.jobType}`);
}

async function analyzeStockAndRecord(input: {
  userId: string;
  symbol: string;
  reason: string;
  source: "manual" | "scheduled";
  runId?: string | null;
  runItemId?: string | null;
  inputHash?: string | null;
  jobId?: string;
  forceRefresh?: boolean;
}) {
  const result = await runStockAnalysis({
    userId: input.userId,
    symbol: input.symbol,
    inputHash: input.inputHash,
    jobId: input.jobId,
    reason: input.reason,
    forceRefresh: input.forceRefresh
  });
  const watchlistItem = await prisma.watchlistItem.findFirst({
    where: { symbol: { in: stockSymbolVariants(input.symbol) }, watchlist: { userId: input.userId } }
  });
  const history = await createDecisionHistoryFromAnalysis({
    userId: input.userId,
    runId: input.runId ?? null,
    analysisId: result.analysisId,
    symbol: input.symbol,
    source: input.source,
    riskLevel: watchlistItem?.riskLevel ?? null,
    outputJson: result.outputJson
  }).catch(() => null);
  await finishAnalysisRunItem({
    itemId: input.runItemId,
    runId: input.runId ?? null,
    symbol: input.symbol,
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
  return result;
}

async function waitForFocusStockAnalyses(jobId: string, runId?: string | null) {
  if (!runId) return null;
  const run = await prisma.analysisRun.findUnique({
    where: { id: runId },
    include: { items: true }
  });
  if (!run) return null;

  const expectedTotal = Math.max(run.totalSymbols, 0);
  const finishedCount = run.items.filter((item) => item.status === "success" || item.status === "failed" || item.status === "skipped").length;
  const hasRunning = run.items.some((item) => item.status === "running");
  const pendingStockJobs = await prisma.analysisJob.count({
    where: {
      userId: run.userId,
      jobType: { in: [JOB_TYPES.STOCK_ANALYSIS, JOB_TYPES.FOCUS_STOCK_BATCH] },
      status: { in: [JOB_STATUS.QUEUED, JOB_STATUS.RUNNING] },
      payload: { path: ["runId"], equals: runId }
    }
  }).catch(() => 0);

  if (expectedTotal > 0 && (finishedCount < expectedTotal || hasRunning || pendingStockJobs > 0)) {
    const job = await prisma.analysisJob.update({
      where: { id: jobId },
      data: {
        status: JOB_STATUS.QUEUED,
        errorMessage: `等待本次 ${expectedTotal} 只关注标的完成分析后再生成 AI 策略观察`,
        lockedAt: null,
        lockedBy: null,
        startedAt: null,
        completedAt: null
      }
    });
    return { requeued: true as const, job };
  }

  return null;
}

async function saveFallbackAnalysisForFailedStock(userId: string, symbol: string, errorMessage: string) {
  try {
    const existing = await prisma.aiAnalysis.findFirst({
      where: { userId, symbol: { in: stockSymbolVariants(symbol) } },
      orderBy: { createdAt: "desc" }
    });

    const outputJson = {
      trend: "neutral",
      confidence: 0.3,
      analysisAsOf: new Date().toISOString(),
      isFallback: true,
      fallbackReason: `系统无法获取 ${symbol} 的行情数据（${errorMessage}），已生成占位分析。请检查数据源配置或股票代码是否正确。`,
      summary: `${symbol} 无法获取行情数据，已跳过 AI 分析。原因：${errorMessage}`,
      newsSummary: "",
      newsSentiment: "neutral",
      webSearchSummary: "",
      newsReferences: [],
      webSearchResults: [],
      catalystEvents: [],
      macroRisks: [],
      sectorRisks: [],
      keyLevels: { support: [], resistance: [] },
      riskFactors: [`行情数据不可用：${errorMessage}`],
      holdAdvice: {
        action: "继续持有观察",
        reason: `因行情数据不可用（${errorMessage}），无法提供基于数据的持仓建议。请先确认数据源配置正确。`,
        stopLoss: "请手动设置止损位。",
        takeProfit: "请手动设置止盈位。",
        positionManagement: "数据缺失期间建议不再加仓。",
        keyMonitorPoints: "确认股票代码正确，检查数据源 API 是否正常。",
        invalidIf: "行情数据恢复后需重新分析。"
      },
      entryAdvice: {
        action: "不建议入场",
        reason: `因行情数据不可用（${errorMessage}），无法提供入场建议。`,
        entryZone: "",
        timing: "",
        triggerCondition: "等待行情数据恢复后再评估。",
        firstPositionSize: "",
        stopLoss: "",
        takeProfit: "",
        invalidIf: "行情数据恢复后需重新分析。"
      },
      possibleActions: [
        {
          action: "watch",
          reason: `行情数据不可用：${errorMessage}。请检查数据源配置。`,
          timing: "持续观察",
          triggerCondition: "行情数据恢复后重新分析。",
          entryZone: "",
          stopLossPlan: "",
          takeProfitPlan: "",
          positionSizing: "",
          followUpCheck: "确认数据源 API 密钥、股票代码是否正确。",
          invalidIf: "行情数据恢复、股票代码变更。"
        }
      ],
      disclaimer: "系统无法获取该股票的行情数据，此占位分析仅供提示参考。"
    };

    if (existing) {
      return prisma.aiAnalysis.update({
        where: { id: existing.id },
        data: { outputJson: outputJson as Prisma.InputJsonValue }
      });
    }

    return prisma.aiAnalysis.create({
      data: {
        userId,
        symbol,
        inputJson: { symbol, error: errorMessage, fallback: true } as Prisma.InputJsonValue,
        outputJson: outputJson as Prisma.InputJsonValue
      }
    });
  } catch {
    return null;
  }
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function isFallbackOutput(value: unknown) {
  return Boolean(value && typeof value === "object" && "isFallback" in value && (value as { isFallback?: unknown }).isFallback);
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
