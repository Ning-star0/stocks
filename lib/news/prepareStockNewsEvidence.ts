import { analyzeNews } from "@/lib/ai/analyzeNews";
import { fetchNewsForSymbol, type FetchNewsForSymbolResult } from "@/lib/news/fetchNewsForSymbol";
import {
  assessNewsEvidenceCoverage,
  planNewsEvidenceAnalysis,
  type NewsEvidenceAnalysisState,
  type NewsEvidenceCandidate,
  type NewsEvidenceCoverage
} from "@/lib/news/evidencePolicy";
import { saveNewsAnalysis } from "@/lib/news/store";
import { prisma } from "@/lib/prisma";
import { stockSymbolVariants } from "@/lib/symbols";
import type { Prisma } from "@prisma/client";
import type { ApiQuotaPriority } from "@/lib/apiQuota";
import type { NewsBatchContext } from "@/lib/news/batchCoordinator";
import { parseNewsEventContext } from "@/lib/news/eventTimeline";

export type StockNewsEvidenceRefresh = {
  schemaVersion: "news-evidence-refresh-v4";
  symbol: string;
  startedAt: string;
  completedAt: string;
  refreshCompleted: boolean;
  deadlineExceeded: boolean;
  fetch: FetchNewsForSymbolResult | null;
  coverage: NewsEvidenceCoverage;
  analyzedNowCount: number;
  reusedVerifiedCount: number;
  failures: string[];
};

type RelevantNewsRow = Awaited<ReturnType<typeof loadRelevantNews>>[number];

export async function prepareStockNewsEvidence(input: {
  userId: string;
  symbol: string;
  now?: Date;
  maxWaitMs?: number;
  maxCritical?: number;
  maxMedium?: number;
  quotaPriority?: ApiQuotaPriority;
  requestBatchId?: string;
  batchContext?: NewsBatchContext;
  forceCriticalRefresh?: boolean;
}): Promise<StockNewsEvidenceRefresh> {
  const now = input.now ?? new Date();
  const startedAt = now.toISOString();
  const startedMs = Date.now();
  const maxWaitMs = positiveInteger(input.maxWaitMs, numberEnv("NEWS_EVIDENCE_WAIT_TIMEOUT_MS", 90_000));
  const deadline = startedMs + maxWaitMs;
  const failures: string[] = [];
  let fetch: FetchNewsForSymbolResult | null = null;

  try {
    fetch = await fetchNewsForSymbol(input.symbol, input.userId, {
      priority: input.quotaPriority ?? "routine",
      requestBatchId: input.requestBatchId,
      batchContext: input.batchContext,
      forceCriticalRefresh: input.forceCriticalRefresh
    });
    failures.push(...fetch.failures);
  } catch (error) {
    failures.push(`新闻刷新失败：${errorMessage(error)}`);
  }

  let rows: RelevantNewsRow[] = [];
  try {
    rows = await loadRelevantNews(input.symbol);
  } catch (error) {
    failures.push(`新闻覆盖统计失败：${errorMessage(error)}`);
  }

  const candidateStates = new Map(rows.map((row) => [row.id, initialAnalysisState(row)]));
  const candidates = () => rows.map((row) => toPolicyCandidate(row, candidateStates.get(row.id) ?? "missing"));
  const initialCoverage = assessNewsEvidenceCoverage(candidates());
  const plan = planNewsEvidenceAnalysis(candidates(), {
    maxCritical: positiveInteger(input.maxCritical, numberEnv("NEWS_EVIDENCE_MAX_CRITICAL", 20)),
    maxMedium: positiveInteger(input.maxMedium, numberEnv("NEWS_EVIDENCE_MAX_MEDIUM", 8))
  });

  let analyzedNowCount = 0;
  let deadlineExceeded = false;
  for (const newsItemId of plan.selectedIds) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      deadlineExceeded = true;
      break;
    }
    const row = rows.find((item) => item.id === newsItemId);
    if (!row) continue;
    try {
      const analysis = await analyzeNews({
        title: row.title,
        url: row.url,
        source: row.source,
        publishedAt: row.publishedAt.toISOString(),
        content: truncate(row.rawContent ?? row.summary ?? row.title, 12_000),
        candidateSymbols: row.symbols,
        candidateSectors: row.sectors,
        timeoutMs: Math.max(1_000, remainingMs)
      });
      await saveNewsAnalysis(row.id, analysis);
      candidateStates.set(row.id, analysis.isFallback ? "fallback" : "verified");
      analyzedNowCount += 1;
      if (analysis.isFallback) failures.push(`新闻“${truncate(row.title, 60)}”仅得到本地兜底精读：${analysis.fallbackReason ?? "原因未记录"}`);
    } catch (error) {
      candidateStates.set(row.id, "failed");
      failures.push(`新闻“${truncate(row.title, 60)}”精读失败：${errorMessage(error)}`);
    }
  }

  if (Date.now() >= deadline && assessNewsEvidenceCoverage(candidates()).pendingRelevantCount > 0) deadlineExceeded = true;
  const coverage = assessNewsEvidenceCoverage(candidates());
  if (plan.deferredCriticalIds.length) failures.push(`有 ${plan.deferredCriticalIds.length} 条高影响新闻超过本轮精读上限。`);
  if (plan.deferredMediumIds.length) failures.push(`有 ${plan.deferredMediumIds.length} 条中影响相关新闻超过本轮精读上限。`);
  if (deadlineExceeded) failures.push(`新闻精读等待超过 ${Math.round(maxWaitMs / 1000)} 秒，已按证据不足继续。`);

  const receipt: StockNewsEvidenceRefresh = {
    schemaVersion: "news-evidence-refresh-v4",
    symbol: input.symbol.toUpperCase(),
    startedAt,
    completedAt: new Date().toISOString(),
    refreshCompleted: Boolean(fetch?.completed),
    deadlineExceeded,
    fetch,
    coverage,
    analyzedNowCount,
    reusedVerifiedCount: initialCoverage.verifiedAnalyzedCount,
    failures: uniqueStrings(failures)
  };

  try {
    await prisma.stockEvidenceState.upsert({
      where: { userId_symbol: { userId: input.userId, symbol: receipt.symbol } },
      update: {
        newsRefreshAt: new Date(receipt.completedAt),
        newsRefreshJson: toJson(receipt)
      },
      create: {
        userId: input.userId,
        symbol: receipt.symbol,
        newsRefreshAt: new Date(receipt.completedAt),
        newsRefreshJson: toJson(receipt)
      }
    });
  } catch (error) {
    receipt.failures = uniqueStrings([...receipt.failures, `新闻证据状态保存失败：${errorMessage(error)}`]);
  }

  return receipt;
}

export async function getStoredStockNewsEvidenceRefresh(userId: string, symbol: string) {
  const variants = stockSymbolVariants(symbol);
  const row = await prisma.stockEvidenceState.findFirst({
    where: { userId, symbol: { in: variants } },
    orderBy: { newsRefreshAt: "desc" }
  });
  return parseStoredReceipt(row?.newsRefreshJson);
}

async function loadRelevantNews(symbol: string) {
  const variants = stockSymbolVariants(symbol);
  const last7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return prisma.newsItem.findMany({
    where: {
      publishedAt: { gte: last7d },
      importance: { in: ["high", "medium"] },
      OR: variants.map((variant) => ({ symbols: { has: variant } }))
    },
    include: { analyses: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { publishedAt: "desc" },
    take: 50
  });
}

function initialAnalysisState(row: RelevantNewsRow): NewsEvidenceAnalysisState {
  const latest = row.analyses[0];
  if (!latest) return "missing";
  // v4 要求已验证精读同时具备结构化事件/预期回执；旧分析必须逐步重读，不能伪装成已闭合。
  if (!parseNewsEventContext(latest.eventContextJson)) return "missing";
  return latest.isFallback ? "fallback" : "verified";
}

function toPolicyCandidate(row: RelevantNewsRow, analysisState: NewsEvidenceAnalysisState): NewsEvidenceCandidate {
  return {
    id: row.id,
    importance: row.importance === "high" ? "high" : "medium",
    publishedAt: row.publishedAt.toISOString(),
    analysisState
  };
}

function positiveInteger(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : fallback;
}

function numberEnv(name: string, fallback: number) {
  return positiveInteger(Number(process.env[name]), fallback);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}

function truncate(value: string, maxLength: number) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function toJson(value: StockNewsEvidenceRefresh) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function parseStoredReceipt(value: unknown): StockNewsEvidenceRefresh | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<StockNewsEvidenceRefresh>;
  const schemaVersion = (value as { schemaVersion?: unknown }).schemaVersion;
  if (!["news-evidence-refresh-v1", "news-evidence-refresh-v2", "news-evidence-refresh-v3", "news-evidence-refresh-v4"].includes(String(schemaVersion))) return null;
  if (typeof record.symbol !== "string") return null;
  if (typeof record.startedAt !== "string" || typeof record.completedAt !== "string") return null;
  if (!record.coverage || !Array.isArray(record.failures)) return null;
  return { ...(record as StockNewsEvidenceRefresh), schemaVersion: "news-evidence-refresh-v4" };
}
