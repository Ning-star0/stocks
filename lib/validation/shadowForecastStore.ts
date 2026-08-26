import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { assertNoUnexplainedCorporateActionGap } from "@/lib/stock-data/corporateActions";
import { getStockDataProvider } from "@/lib/stock-data";
import type { ValuationPriceHistoryEvidence } from "@/lib/stock-data/types";
import type { AiAnalysisResult } from "@/lib/types";
import { toNumber } from "@/lib/utils";
import {
  buildForecastCalibrationReport,
  buildShadowForecastSnapshot,
  evaluateShadowForecast,
  type ForecastCalibrationReport,
  type ShadowForecastSnapshot
} from "@/lib/validation/shadowForecast";

const DEFAULT_REFRESH_LIMIT = 20;
const SUCCESS_RECHECK_HOURS = 12;
const FAILURE_RECHECK_HOURS = 6;

export type PersistAnalysisWithShadowForecastInput = {
  userId: string;
  symbol: string;
  inputJson: Prisma.InputJsonValue;
  outputJson: Prisma.InputJsonValue;
  analysis: AiAnalysisResult;
  evidenceHash: string;
  analysisAsOf: string;
  modelName: string | null;
};

export type ForecastCalibrationSummary = {
  generatedAt: string;
  counts: {
    pending: number;
    resolved: number;
    invalid: number;
    failedChecks: number;
  };
  firstForecastAt: string | null;
  latestResolvedAt: string | null;
  averageNetReturnPct: number | null;
  positiveNetReturnRate: number | null;
  recentFailures: Array<{ symbol: string; failure: string; checkedAt: string | null }>;
  overall: ForecastCalibrationReport;
  cohorts: Array<{
    cohortKey: string;
    decisionMode: string;
    averageNetReturnPct: number | null;
    report: ForecastCalibrationReport;
  }>;
};

type PriceHistoryLoader = (symbol: string) => Promise<ValuationPriceHistoryEvidence>;

export async function persistAnalysisWithShadowForecast(input: PersistAnalysisWithShadowForecastInput) {
  const snapshot = buildShadowForecastSnapshot({
    analysis: input.analysis,
    evidenceHash: input.evidenceHash,
    analysisAsOf: input.analysisAsOf
  });

  return prisma.$transaction(async (transaction) => {
    const analysis = await transaction.aiAnalysis.create({
      data: {
        userId: input.userId,
        symbol: input.symbol,
        inputJson: input.inputJson,
        outputJson: input.outputJson
      }
    });
    if (snapshot) {
      await transaction.shadowForecast.create({
        data: {
          userId: input.userId,
          analysisId: analysis.id,
          symbol: input.symbol,
          modelName: input.modelName,
          ...shadowForecastCreateData(snapshot)
        }
      });
    }
    return { analysis, shadowForecastCreated: Boolean(snapshot) };
  });
}

export async function refreshPendingShadowForecasts(options: {
  limit?: number;
  now?: Date;
  loadPriceHistory?: PriceHistoryLoader;
} = {}) {
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? DEFAULT_REFRESH_LIMIT)));
  const forecasts = await prisma.shadowForecast.findMany({
    where: { status: "pending", nextCheckAt: { lte: now } },
    orderBy: [{ nextCheckAt: "asc" }, { createdAt: "asc" }],
    take: limit
  });
  if (!forecasts.length) return { checked: 0, pending: 0, resolved: 0, invalid: 0, failed: 0 };

  const claimed = [] as typeof forecasts;
  for (const forecast of forecasts) {
    const claim = await prisma.shadowForecast.updateMany({
      where: { id: forecast.id, status: "pending", nextCheckAt: { lte: now } },
      data: { nextCheckAt: addHours(now, FAILURE_RECHECK_HOURS) }
    });
    if (claim.count === 1) claimed.push(forecast);
  }
  if (!claimed.length) return { checked: 0, pending: 0, resolved: 0, invalid: 0, failed: 0 };

  const loader = options.loadPriceHistory ?? defaultPriceHistoryLoader;
  const groups = new Map<string, typeof claimed>();
  for (const forecast of claimed) {
    const existing = groups.get(forecast.symbol) ?? [];
    existing.push(forecast);
    groups.set(forecast.symbol, existing);
  }

  const counts = { checked: claimed.length, pending: 0, resolved: 0, invalid: 0, failed: 0 };
  for (const [symbol, symbolForecasts] of groups) {
    let receipt: ValuationPriceHistoryEvidence;
    try {
      receipt = await loader(symbol);
      if (receipt.status !== "available" || receipt.adjustment !== "none" || !receipt.candles.length) {
        throw new Error(receipt.failure || "未取得未复权日线，影子结果暂不能更新。");
      }
    } catch (error) {
      const failure = errorMessage(error);
      await prisma.shadowForecast.updateMany({
        where: { id: { in: symbolForecasts.map((forecast) => forecast.id) }, status: "pending" },
        data: {
          lastCheckAt: now,
          lastCheckFailure: failure,
          nextCheckAt: addHours(now, FAILURE_RECHECK_HOURS)
        }
      });
      counts.failed += symbolForecasts.length;
      continue;
    }

    for (const forecast of symbolForecasts) {
      if (forecast.horizonTradingDays !== 20 && forecast.horizonTradingDays !== 63) {
        await prisma.shadowForecast.update({
          where: { id: forecast.id },
          data: {
            status: "invalid",
            invalidReason: `不支持的影子观察周期：${forecast.horizonTradingDays} 个交易日。`,
            lastCheckAt: now,
            lastCheckFailure: null,
            nextCheckAt: now
          }
        });
        counts.invalid += 1;
        continue;
      }
      try {
        const pathStart = forecast.analysisAsOf.getTime() - 15 * 24 * 60 * 60 * 1000;
        assertNoUnexplainedCorporateActionGap(symbol, receipt.candles.filter((candle) => Date.parse(candle.timestamp) >= pathStart));
      } catch (error) {
        await prisma.shadowForecast.update({
          where: { id: forecast.id },
          data: {
            status: "invalid",
            invalidReason: `观察期价格存在无法安全解释的公司行动：${errorMessage(error)}`,
            priceProvider: receipt.provider,
            priceSourceUrl: receipt.sourceUrl,
            lastCheckAt: now,
            lastCheckFailure: null,
            nextCheckAt: now
          }
        });
        counts.invalid += 1;
        continue;
      }
      const result = evaluateShadowForecast({
        forecast: {
          analysisAsOf: forecast.analysisAsOf.toISOString(),
          horizonTradingDays: forecast.horizonTradingDays,
          stopLossPrice: toNumber(forecast.stopLossPrice) ?? Number.NaN,
          takeProfitPrice: toNumber(forecast.takeProfitPrice) ?? Number.NaN,
          plannedShares: toNumber(forecast.plannedShares) ?? Number.NaN
        },
        candles: receipt.candles,
        evaluationAsOf: now.toISOString()
      });
      await prisma.shadowForecast.update({
        where: { id: forecast.id },
        data: {
          status: result.status,
          entryAt: asDate(result.entryAt),
          entryPrice: result.entryPrice,
          outcome: result.outcome,
          outcomeValue: result.outcomeValue,
          observedTradingDays: result.observedTradingDays,
          maxFavorablePct: result.maxFavorablePct,
          maxAdversePct: result.maxAdversePct,
          netReturnPct: result.netReturnPct,
          priceDataThrough: asDate(result.priceDataThrough),
          priceProvider: receipt.provider,
          priceSourceUrl: receipt.sourceUrl,
          resolvedAt: asDate(result.resolvedAt),
          invalidReason: result.invalidReason,
          lastCheckAt: now,
          lastCheckFailure: null,
          nextCheckAt: result.status === "pending" ? addHours(now, SUCCESS_RECHECK_HOURS) : now
        }
      });
      counts[result.status] += 1;
    }
  }
  return counts;
}

export async function getForecastCalibrationSummary(userId: string): Promise<ForecastCalibrationSummary> {
  const rows = await prisma.shadowForecast.findMany({
    where: { userId },
    select: {
      status: true,
      symbol: true,
      cohortKey: true,
      decisionMode: true,
      modelProbability: true,
      outcomeValue: true,
      netReturnPct: true,
      createdAt: true,
      resolvedAt: true,
      lastCheckAt: true,
      lastCheckFailure: true
    },
    orderBy: { createdAt: "asc" }
  });
  const resolved = rows.filter((row): row is typeof row & { outcomeValue: 0 | 1 } => (
    row.status === "resolved" && (row.outcomeValue === 0 || row.outcomeValue === 1)
  ));
  const observations = resolved.map((row) => ({
    probability: toNumber(row.modelProbability) ?? Number.NaN,
    outcome: row.outcomeValue,
    cohortKey: row.cohortKey
  }));
  const cohortKeys = [...new Set(resolved.map((row) => row.cohortKey))].sort();
  const netReturns = resolved.map((row) => toNumber(row.netReturnPct)).filter((value): value is number => value !== null);

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      pending: rows.filter((row) => row.status === "pending").length,
      resolved: resolved.length,
      invalid: rows.filter((row) => row.status === "invalid").length,
      failedChecks: rows.filter((row) => row.status === "pending" && Boolean(row.lastCheckFailure)).length
    },
    firstForecastAt: rows[0]?.createdAt.toISOString() ?? null,
    latestResolvedAt: maxTimestamp(resolved.map((row) => row.resolvedAt)),
    averageNetReturnPct: roundedAverage(netReturns),
    positiveNetReturnRate: netReturns.length ? round(netReturns.filter((value) => value > 0).length / netReturns.length, 4) : null,
    recentFailures: rows
      .filter((row): row is typeof row & { lastCheckFailure: string } => row.status === "pending" && Boolean(row.lastCheckFailure))
      .sort((left, right) => (right.lastCheckAt?.getTime() ?? 0) - (left.lastCheckAt?.getTime() ?? 0))
      .slice(0, 5)
      .map((row) => ({ symbol: row.symbol, failure: row.lastCheckFailure, checkedAt: row.lastCheckAt?.toISOString() ?? null })),
    overall: buildForecastCalibrationReport(observations),
    cohorts: cohortKeys.map((cohortKey) => {
      const cohortRows = resolved.filter((row) => row.cohortKey === cohortKey);
      const cohortReturns = cohortRows.map((row) => toNumber(row.netReturnPct)).filter((value): value is number => value !== null);
      return {
        cohortKey,
        decisionMode: cohortRows[0]?.decisionMode ?? "unknown",
        averageNetReturnPct: roundedAverage(cohortReturns),
        report: buildForecastCalibrationReport(observations.filter((item) => item.cohortKey === cohortKey))
      };
    })
  };
}

function shadowForecastCreateData(snapshot: ShadowForecastSnapshot) {
  return {
    schemaVersion: snapshot.schemaVersion,
    algorithmVersion: snapshot.algorithmVersion,
    cohortKey: snapshot.cohortKey,
    decisionMode: snapshot.decisionMode,
    analysisAsOf: new Date(snapshot.analysisAsOf),
    evidenceHash: snapshot.evidenceHash,
    modelProbability: snapshot.modelProbability,
    horizonTradingDays: snapshot.horizonTradingDays,
    priceBasis: snapshot.priceBasis,
    entryTriggerPrice: snapshot.entryTriggerPrice,
    stopLossPrice: snapshot.stopLossPrice,
    takeProfitPrice: snapshot.takeProfitPrice,
    plannedShares: snapshot.plannedShares,
    netProfitIfRight: snapshot.netProfitIfRight,
    netLossIfWrong: snapshot.netLossIfWrong
  };
}

async function defaultPriceHistoryLoader(symbol: string) {
  const provider = getStockDataProvider();
  if (!provider.getValuationPriceHistory) throw new Error("当前行情提供方不支持未复权历史价格。");
  return provider.getValuationPriceHistory(symbol, { adjustment: "none" });
}

function asDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addHours(value: Date, hours: number) {
  return new Date(value.getTime() + hours * 60 * 60 * 1000);
}

function maxTimestamp(values: Array<Date | null>) {
  const timestamps = values.filter((value): value is Date => value instanceof Date).map((value) => value.getTime());
  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;
}

function roundedAverage(values: number[]) {
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length, 6) : null;
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 1000) : "影子结果更新失败。";
}
