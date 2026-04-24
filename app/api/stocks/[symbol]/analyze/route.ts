import { NextRequest, NextResponse } from "next/server";

import { createAnalysisContextHash } from "@/lib/analysis/contextHash";
import { buildStockAnalysisContext } from "@/lib/analysis/stockAnalysisRunner";
import { shouldRunStockAnalysis } from "@/lib/analysis/shouldAnalyze";
import { getCache } from "@/lib/cache";
import { getCurrentUser } from "@/lib/currentUser";
import { apiError } from "@/lib/errors";
import { enqueueJob } from "@/lib/jobs/enqueueJob";
import { JOB_PRIORITY, JOB_TYPES } from "@/lib/jobs/jobTypes";
import { prisma } from "@/lib/prisma";
import { symbolSchema } from "@/lib/schemas";
import { toNumber } from "@/lib/utils";

export async function POST(request: NextRequest, context: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol } = await context.params;
    const normalized = symbolSchema.parse(symbol);
    const user = await getCurrentUser();
    const body = await request.json().catch(() => ({}));
    const forceRefresh = Boolean(body.forceRefresh);
    const analysisContext = await buildStockAnalysisContext(user.id, normalized);
    const canonicalSymbol = analysisContext.quote.symbol;
    const latestAnalysis = await prisma.aiAnalysis.findFirst({
      where: { userId: user.id, symbol: { in: [normalized, canonicalSymbol] } },
      orderBy: { createdAt: "desc" }
    });
    const watchlistItem = await prisma.watchlistItem.findFirst({
      where: { symbol: { in: [normalized, canonicalSymbol] }, watchlist: { userId: user.id } }
    });
    const contextHash = createAnalysisContextHash({
      symbol: canonicalSymbol,
      quote: analysisContext.quote,
      indicators: analysisContext.indicators,
      importantNewsIds: analysisContext.highImpactNewsIds,
      userContext: {
        holdingPrice: toNumber(watchlistItem?.holdingPrice),
        targetPrice: toNumber(watchlistItem?.targetPrice),
        stopLoss: toNumber(watchlistItem?.stopLoss),
        timeHorizon: watchlistItem?.timeHorizon ?? null,
        riskLevel: watchlistItem?.riskLevel ?? null
      }
    });
    const cacheKey = `ai_analysis:${canonicalSymbol}:${contextHash}`;
    const cached = await getCache<{ analysisId: string; outputJson: unknown }>(cacheKey);
    if (cached) {
      await logCacheHit(user.id, canonicalSymbol, contextHash, "stock_analysis_cache_hit");
      return NextResponse.json({
        analysis: {
          id: cached.analysisId,
          outputJson: cached.outputJson
        },
        fromCache: true,
        skippedReason: "context_hash_cache_hit",
        refreshing: false,
        contextHash
      });
    }
    const existingByHash = await findAnalysisByContextHash(user.id, canonicalSymbol, contextHash);
    if (existingByHash) {
      return NextResponse.json({
        analysis: { id: existingByHash.id, createdAt: existingByHash.createdAt, outputJson: existingByHash.outputJson },
        fromCache: true,
        skippedReason: "context_hash_existing_analysis",
        refreshing: false,
        contextHash
      });
    }

    const previousHighImpactNewsIds = extractPreviousHighImpactNewsIds(latestAnalysis?.inputJson);
    const gate = shouldRunStockAnalysis({
      forceRefresh,
      latestAnalysis,
      currentQuote: analysisContext.quote,
      currentIndicators: analysisContext.indicators,
      highImpactNewsIds: analysisContext.highImpactNewsIds,
      previousHighImpactNewsIds,
      userContextHashChanged: latestAnalysis ? contextHash !== extractPreviousContextHash(latestAnalysis.inputJson) : true,
      importantAlertTriggered: await hasImportantAlertTriggered(user.id, canonicalSymbol)
    });

    if (!gate.shouldRun && latestAnalysis && !forceRefresh) {
      return NextResponse.json({
        analysis: { id: latestAnalysis.id, createdAt: latestAnalysis.createdAt, outputJson: latestAnalysis.outputJson },
        fromCache: true,
        skippedReason: gate.reason,
        refreshing: false,
        contextHash
      });
    }

    const job = await enqueueJob({
      userId: user.id,
      symbol: canonicalSymbol,
      jobType: JOB_TYPES.STOCK_ANALYSIS,
      priority: forceRefresh ? JOB_PRIORITY.USER_MANUAL_ANALYSIS : priorityForReason(gate.reason),
      inputHash: contextHash,
      payload: { reason: gate.reason, forceRefresh }
    });

    if (forceRefresh) {
      return NextResponse.json({ jobId: job.id, status: job.status, refreshing: true, contextHash }, { status: 202 });
    }

    return NextResponse.json(
      {
        analysis: latestAnalysis ? { id: latestAnalysis.id, createdAt: latestAnalysis.createdAt, outputJson: latestAnalysis.outputJson } : null,
        fromCache: Boolean(latestAnalysis),
        skippedReason: latestAnalysis ? "returned_stale_while_refreshing" : "queued_initial_analysis",
        refreshing: true,
        jobId: job.id,
        contextHash
      },
      { status: 202 }
    );
  } catch (error) {
    return apiError(error);
  }
}

function extractPreviousHighImpactNewsIds(inputJson: unknown) {
  const value = inputJson as { highImpactNewsIds?: string[] } | null;
  return value?.highImpactNewsIds ?? [];
}

function extractPreviousContextHash(inputJson: unknown) {
  const value = inputJson as { contextHash?: string } | null;
  return value?.contextHash ?? null;
}

async function hasImportantAlertTriggered(userId: string, symbol: string) {
  const recent = await prisma.alert.findFirst({
    where: {
      userId,
      symbol,
      triggeredAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) }
    }
  });
  return Boolean(recent);
}

async function findAnalysisByContextHash(userId: string, symbol: string, contextHash: string) {
  const rows = await prisma.aiAnalysis.findMany({
    where: { userId, symbol },
    orderBy: { createdAt: "desc" },
    take: 20
  });
  return rows.find((row) => {
    const input = row.inputJson as { contextHash?: string } | null;
    return input?.contextHash === contextHash;
  }) ?? null;
}

function priorityForReason(reason: string) {
  if (reason.includes("news")) return JOB_PRIORITY.HIGH_IMPORTANCE_NEWS;
  if (reason.includes("price")) return JOB_PRIORITY.PRICE_MOVE;
  if (reason.includes("alert")) return JOB_PRIORITY.ALERT_CHECK;
  return JOB_PRIORITY.SCHEDULED_REFRESH;
}

async function logCacheHit(userId: string, symbol: string, inputHash: string, reason: string) {
  await prisma.aiUsageLog.create({
    data: {
      userId,
      symbol,
      jobType: JOB_TYPES.STOCK_ANALYSIS,
      provider: process.env.OPENAI_BASE_URL ? "openai-compatible" : "openai",
      model: process.env.OPENAI_MODEL || "deepseek-v4-flash",
      inputHash,
      promptTokens: null,
      completionTokens: null,
      estimatedCost: null,
      cacheHit: true,
      reason
    }
  });
}
