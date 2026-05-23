import { randomUUID } from "node:crypto";

import { analyzeNews } from "@/lib/ai/analyzeNews";
import { generateDailyBrief } from "@/lib/briefs/generateDailyBrief";
import { evaluateAllActiveAlerts } from "@/lib/alerts/evaluateAlerts";
import { runStockAnalysis } from "@/lib/analysis/stockAnalysisRunner";
import { getCache, setCache } from "@/lib/cache";
import { generateAndStoreFocusDecision } from "@/lib/focus/decision";
import { JOB_STATUS, JOB_TYPES } from "@/lib/jobs/jobTypes";
import { fetchNewsForSymbol } from "@/lib/news/fetchNewsForSymbol";
import { saveNewsAnalysis } from "@/lib/news/store";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const workerId = `${process.pid}-${randomUUID()}`;
let lastTimeoutSweepAt = 0;

export async function processNextJob() {
  await failTimedOutJobsIfDue();
  const job = await lockNextQueuedJob();
  if (!job) return null;

  try {
    const result = await runJob(job);
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

async function failTimedOutJobsIfDue() {
  const now = Date.now();
  if (now - lastTimeoutSweepAt < numberEnv("JOB_TIMEOUT_SWEEP_INTERVAL_SECONDS", 60) * 1000) return;
  lastTimeoutSweepAt = now;
  await failTimedOutJobs();
}

async function lockNextQueuedJob() {
  const job = await prisma.analysisJob.findFirst({
    where: { status: JOB_STATUS.QUEUED },
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
  if (job.jobType === JOB_TYPES.STOCK_ANALYSIS) {
    if (!job.symbol) throw new Error("股票分析任务缺少股票代码。");
    const payload = job.payload as { reason?: string; refreshNews?: boolean } | null;

    // 定时新闻抓取：先实际抓取新闻入库，再运行股票分析
    if (payload?.refreshNews) {
      try {
        await fetchNewsForSymbol(job.symbol, job.userId);
      } catch {
        // 新闻抓取失败不应阻断后续股票分析
      }
    }

    try {
      const result = await runStockAnalysis({
        userId: job.userId,
        symbol: job.symbol,
        inputHash: job.inputHash,
        jobId: job.id,
        reason: payload?.reason ?? "job_queue"
      });
      return { resultId: result.analysisId, skippedCached: result.fromCache };
    } catch (error) {
      // 行情不可用时保存 fallback 分析，避免任务失败后无任何分析记录
      const message = error instanceof Error ? error.message : "未知错误";
      const fallback = await saveFallbackAnalysisForFailedStock(job.userId, job.symbol, message);
      if (fallback) {
        return { resultId: fallback.id, skippedCached: false };
      }
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
    await prisma.aiUsageLog.create({
      data: {
        userId: job.userId,
        symbol: newsItem.symbols[0] ?? null,
        jobType: JOB_TYPES.NEWS_ANALYSIS,
        provider: process.env.OPENAI_BASE_URL ? "openai-compatible" : "openai",
        model: process.env.OPENAI_MODEL || "deepseek-v4-pro",
        inputHash: job.inputHash,
        promptTokens: Math.ceil(JSON.stringify({ title: newsItem.title, summary: newsItem.summary }).length / 4),
        completionTokens: null,
        estimatedCost: null,
        cacheHit: false,
        reason: "high_importance_news"
      }
    });
    return { resultId: saved.id, skippedCached: false };
  }

  if (job.jobType === JOB_TYPES.FOCUS_DECISION) {
    const payload = job.payload as { scheduledFor?: string } | null;
    const decision = await generateAndStoreFocusDecision({
      userId: job.userId,
      forceRefresh: true,
      source: "scheduled",
      scheduledFor: payload?.scheduledFor ?? null
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

async function saveFallbackAnalysisForFailedStock(userId: string, symbol: string, errorMessage: string) {
  try {
    const existing = await prisma.aiAnalysis.findFirst({
      where: { userId, symbol },
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

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
