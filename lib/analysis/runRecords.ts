import type { Prisma } from "@prisma/client";

import { getAiConfig } from "@/lib/ai/config";
import { buildDecisionChange } from "@/lib/decision/change";
import { prisma } from "@/lib/prisma";

type RunStatus = "running" | "success" | "partial_failed" | "failed";
type RunItemStatus = "running" | "success" | "failed" | "skipped";
type RunType = "manual" | "scheduled";

type AnalysisOutput = {
  trend?: string;
  confidence?: number;
  summary?: string;
  isFallback?: boolean;
  fallbackReason?: string;
  riskFactors?: unknown;
  holdAdvice?: Record<string, unknown>;
  entryAdvice?: Record<string, unknown>;
  possibleActions?: Array<Record<string, unknown>>;
};

export async function createAnalysisRun(input: {
  userId: string;
  runType: RunType;
  totalSymbols: number;
  nextRunAt?: Date | null;
}) {
  return prisma.analysisRun.create({
    data: {
      userId: input.userId,
      runType: input.runType,
      totalSymbols: input.totalSymbols,
      nextRunAt: input.nextRunAt ?? null,
      status: "running"
    }
  });
}

export async function startAnalysisRunItem(input: {
  runId: string;
  symbol: string;
  stockName?: string | null;
}) {
  return prisma.analysisRunItem.create({
    data: {
      runId: input.runId,
      symbol: input.symbol,
      stockName: input.stockName ?? null,
      status: "running"
    }
  });
}

export async function finishAnalysisRunItem(input: {
  itemId?: string | null;
  runId?: string | null;
  symbol?: string | null;
  status: RunItemStatus;
  decisionId?: string | null;
  aiStatus?: string | null;
  quoteStatus?: string | null;
  newsStatus?: string | null;
  errorMessage?: string | null;
  durationMs?: number | null;
  aiDurationMs?: number | null;
  quoteDurationMs?: number | null;
  newsDurationMs?: number | null;
  fallbackUsed?: boolean;
}) {
  if (!input.itemId && (!input.runId || !input.symbol)) return null;

  const data = {
    status: input.status,
    decisionId: input.decisionId ?? null,
    aiStatus: input.aiStatus ?? null,
    quoteStatus: input.quoteStatus ?? null,
    newsStatus: input.newsStatus ?? null,
    errorMessage: toUserFacingError(input.errorMessage),
    durationMs: input.durationMs ?? null,
    aiDurationMs: input.aiDurationMs ?? null,
    quoteDurationMs: input.quoteDurationMs ?? null,
    newsDurationMs: input.newsDurationMs ?? null,
    fallbackUsed: Boolean(input.fallbackUsed)
  };

  const row = input.itemId
    ? await prisma.analysisRunItem.update({ where: { id: input.itemId }, data })
    : await prisma.analysisRunItem.upsert({
        where: {
          id: "__never__"
        },
        update: data,
        create: {
          runId: input.runId as string,
          symbol: input.symbol as string,
          ...data
        }
      }).catch(async () => {
        return prisma.analysisRunItem.create({
          data: {
            runId: input.runId as string,
            symbol: input.symbol as string,
            ...data
          }
        });
      });

  await refreshAnalysisRun(row.runId);
  return row;
}

export async function refreshAnalysisRun(runId?: string | null) {
  if (!runId) return null;
  const run = await prisma.analysisRun.findUnique({
    where: { id: runId },
    include: { items: true }
  });
  if (!run) return null;

  const successCount = run.items.filter((item) => item.status === "success" || item.status === "skipped").length;
  const failedCount = run.items.filter((item) => item.status === "failed").length;
  const runningCount = run.items.filter((item) => item.status === "running").length;
  const fallbackUsed = run.items.some((item) => item.fallbackUsed);
  const expectedTotal = Math.max(run.totalSymbols, run.items.length);
  const finished = runningCount === 0 && run.items.length >= expectedTotal;
  const status: RunStatus = !finished
    ? "running"
    : failedCount === 0
      ? "success"
      : successCount > 0
        ? "partial_failed"
        : "failed";
  const finishedAt = finished ? run.finishedAt ?? new Date() : null;
  const errorSummary = buildErrorSummary(run.items.map((item) => item.errorMessage).filter(Boolean));

  return prisma.analysisRun.update({
    where: { id: runId },
    data: {
      status,
      totalSymbols: expectedTotal,
      successCount,
      failedCount,
      fallbackUsed,
      errorSummary,
      finishedAt,
      durationMs: finishedAt ? Math.max(0, finishedAt.getTime() - run.startedAt.getTime()) : null
    }
  });
}

export async function createDecisionHistoryFromAnalysis(input: {
  userId: string;
  runId?: string | null;
  analysisId?: string | null;
  symbol: string;
  stockName?: string | null;
  source: "manual" | "scheduled";
  riskLevel?: string | null;
  outputJson: unknown;
}) {
  const output = asRecord(input.outputJson) as AnalysisOutput;
  const firstAction = Array.isArray(output.possibleActions) ? output.possibleActions[0] : null;
  const actionText = stringValue(firstAction?.action) || stringValue(output.entryAdvice?.action) || stringValue(output.holdAdvice?.action);
  const action = normalizeAction(actionText);
  const previous = await prisma.decisionHistory.findFirst({
    where: { userId: input.userId, symbol: input.symbol },
    orderBy: { decisionTime: "desc" }
  });
  const strategyDirection = normalizeTrend(output.trend);
  const keyReasons = normalizeReasons(output.riskFactors, output.summary);
  const model = await getModelName();

  return prisma.decisionHistory.create({
    data: {
      userId: input.userId,
      runId: input.runId ?? null,
      analysisId: input.analysisId ?? null,
      symbol: input.symbol,
      stockName: input.stockName ?? null,
      decisionTime: new Date(),
      source: input.source,
      strategyDirection,
      action,
      riskLevel: input.riskLevel ?? null,
      confidence: typeof output.confidence === "number" ? output.confidence : null,
      summary: output.summary || "暂无摘要。",
      keyReasons: keyReasons as Prisma.InputJsonValue,
      entryRange: stringValue(output.entryAdvice?.entryZone) || stringValue(firstAction?.entryZone),
      stopLoss: stringValue(output.entryAdvice?.stopLoss) || stringValue(output.holdAdvice?.stopLoss) || stringValue(firstAction?.stopLossPlan),
      takeProfit: stringValue(output.entryAdvice?.takeProfit) || stringValue(output.holdAdvice?.takeProfit) || stringValue(firstAction?.takeProfitPlan),
      invalidationCondition: stringValue(output.entryAdvice?.invalidIf) || stringValue(output.holdAdvice?.invalidIf) || stringValue(firstAction?.invalidIf),
      fallbackUsed: Boolean(output.isFallback || output.fallbackReason),
      rawModelName: model,
      previousAction: previous?.action ?? null,
      previousStrategyDirection: previous?.strategyDirection ?? null,
      changeSummary: buildDecisionChange(toDecisionSnapshot(previous), {
        action,
        strategyDirection,
        riskLevel: input.riskLevel ?? null,
        confidence: typeof output.confidence === "number" ? output.confidence : null
      }).summary
    }
  });
}

export async function createDecisionHistoryFromFocusDecision(input: {
  userId: string;
  runId?: string | null;
  source: "manual" | "scheduled";
  decision: unknown;
  candidates?: Array<{ symbol: string; name?: string | null; riskLevel?: string | null; latestAnalysis?: { confidence?: number; trend?: string } | null }>;
  createRunItems?: boolean;
}) {
  const decision = asRecord(input.decision);
  const ranking = Array.isArray(decision.ranking) ? decision.ranking.filter(asRecord) : [];
  const orders = Array.isArray(decision.orders) ? decision.orders.filter(asRecord) : [];
  const sellOrders = Array.isArray(decision.sellOrders) ? decision.sellOrders.filter(asRecord) : [];
  const model = await getModelName();
  const created = [];

  for (const row of ranking) {
    const symbol = stringValue(row.symbol);
    if (!symbol) continue;
    const candidate = input.candidates?.find((item) => sameSymbol(item.symbol, symbol));
    const order = orders.find((item) => sameSymbol(stringValue(item.symbol), symbol));
    const sellOrder = sellOrders.find((item) => sameSymbol(stringValue(item.symbol), symbol));
    const action = normalizeAction(stringValue(sellOrder?.action) || stringValue(order?.action) || stringValue(row.view));
    const previous = await prisma.decisionHistory.findFirst({
      where: { userId: input.userId, symbol },
      orderBy: { decisionTime: "desc" }
    });
    const strategyDirection = normalizeTrend(candidate?.latestAnalysis?.trend ?? stringValue(row.view));
    const fallbackUsed = Boolean(decision.fallbackReason);
    const history = await prisma.decisionHistory.create({
      data: {
        userId: input.userId,
        runId: input.runId ?? null,
        symbol,
        stockName: candidate?.name ?? null,
        decisionTime: new Date(),
        source: input.source,
        strategyDirection,
        action,
        riskLevel: candidate?.riskLevel ?? null,
        confidence: typeof candidate?.latestAnalysis?.confidence === "number" ? candidate.latestAnalysis.confidence : null,
        summary: stringValue(row.reason) || stringValue(decision.summary) || "暂无摘要。",
        keyReasons: normalizeReasons([], stringValue(row.reason) || stringValue(decision.summary)) as Prisma.InputJsonValue,
        entryRange: stringValue(order?.entryRange),
        stopLoss: stringValue(sellOrder?.riskControl) || stringValue(order?.riskControl),
        takeProfit: null,
        invalidationCondition: stringValue(sellOrder?.invalidIf) || stringValue(order?.invalidIf),
        fallbackUsed,
        rawModelName: model,
        previousAction: previous?.action ?? null,
        previousStrategyDirection: previous?.strategyDirection ?? null,
        changeSummary: buildDecisionChange(toDecisionSnapshot(previous), {
          action,
          strategyDirection,
          riskLevel: candidate?.riskLevel ?? null,
          confidence: typeof candidate?.latestAnalysis?.confidence === "number" ? candidate.latestAnalysis.confidence : null
        }).summary
      }
    });
    created.push(history);

    if (input.runId && input.createRunItems) {
      await prisma.analysisRunItem.create({
        data: {
          runId: input.runId,
          symbol,
          stockName: candidate?.name ?? null,
          status: "success",
          decisionId: history.id,
          aiStatus: fallbackUsed ? "fallback" : "success",
          quoteStatus: "success",
          newsStatus: "success",
          fallbackUsed
        }
      }).catch(() => null);
    }
  }

  if (input.runId && input.createRunItems) await refreshAnalysisRun(input.runId);

  return created;
}

function normalizeAction(value?: string | null) {
  const text = value || "";
  if (/减仓|reduce|sell|卖出|止盈/.test(text)) return "reduce";
  if (/持有|hold|加仓|增持/.test(text)) return "hold";
  if (/回避|avoid|止损|离场|不建议/.test(text)) return "avoid";
  if (/等待|回调|wait|观望/.test(text)) return "wait_pullback";
  return "watch";
}

function normalizeTrend(value?: string | null) {
  const text = value || "";
  if (/bullish|偏多|强|优先/.test(text)) return "bullish";
  if (/bearish|偏空|弱|回避/.test(text)) return "bearish";
  if (/neutral|中性/.test(text)) return "neutral";
  return "watch";
}

function normalizeReasons(value: unknown, fallback?: string) {
  const fromArray = Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
  if (fromArray.length) return fromArray.slice(0, 4);
  return splitReason(fallback || "暂无关键理由。").slice(0, 4);
}

function splitReason(value: string) {
  return value.split(/[。；;，,\n]/).map((item) => item.trim()).filter(Boolean);
}

function buildErrorSummary(messages: Array<string | null | undefined>) {
  const unique = [...new Set(messages.filter(Boolean).map((item) => item as string))];
  return unique.length ? unique.slice(0, 3).join("；") : null;
}

function toUserFacingError(value?: string | null) {
  if (!value) return null;
  if (/timeout|aborted|超时/i.test(value)) return "AI 接口超时";
  if (/JSON|schema|parse|校验|格式/i.test(value)) return "AI 返回格式异常，已使用本地规则兜底";
  if (/行情|quote|DATA_PROVIDER/i.test(value)) return "行情数据缺失";
  if (/新闻|news/i.test(value)) return "新闻数据获取失败";
  return value.length > 120 ? `${value.slice(0, 120)}...` : value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sameSymbol(a?: string | null, b?: string | null) {
  return normalizeSymbol(a) === normalizeSymbol(b);
}

function normalizeSymbol(value?: string | null) {
  return (value || "").toUpperCase().replace(/\.(SH|SZ|BJ)$/, "");
}

function toDecisionSnapshot(value?: { action?: string | null; strategyDirection?: string | null; riskLevel?: string | null; confidence?: Prisma.Decimal | number | null } | null) {
  if (!value) return null;
  return {
    action: value.action ?? null,
    strategyDirection: value.strategyDirection ?? null,
    riskLevel: value.riskLevel ?? null,
    confidence: decimalToNumber(value.confidence)
  };
}

function decimalToNumber(value?: Prisma.Decimal | number | null) {
  if (value === null || value === undefined) return null;
  return typeof value === "number" ? value : Number(value);
}

async function getModelName() {
  try {
    const config = await getAiConfig();
    return config.flagshipModel || config.model || null;
  } catch {
    return process.env.OPENAI_MODEL || "deepseek-v4-pro";
  }
}
