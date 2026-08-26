import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { prisma } from "@/lib/prisma";
import type { ValuationPriceHistoryEvidence } from "@/lib/stock-data/types";
import type { AiAnalysisResult } from "@/lib/types";
import {
  getForecastCalibrationSummary,
  persistAnalysisWithShadowForecast,
  refreshPendingShadowForecasts
} from "@/lib/validation/shadowForecastStore";

const runDbTests = process.env.RUN_DB_E2E_TESTS === "true";
const symbol = "600519.SH";

test.after(async () => {
  await prisma.$disconnect();
});

test("analysis and shadow forecast persist atomically, resolve from later raw candles, and feed calibration", {
  skip: !runDbTests
}, async () => {
  const user = await prisma.user.create({ data: { email: `shadow-${Date.now()}-${randomUUID()}@db-e2e.invalid` } });
  try {
    const analysisAsOf = "2026-01-05T15:30:00+08:00";
    const output = analysisFixture(0.7);
    const saved = await persistAnalysisWithShadowForecast({
      userId: user.id,
      symbol,
      inputJson: { contextHash: "db-shadow-fixture" },
      outputJson: JSON.parse(JSON.stringify(output)),
      analysis: output,
      evidenceHash: "a".repeat(64),
      analysisAsOf,
      modelName: "fixture-model"
    });
    assert.equal(saved.shadowForecastCreated, true);

    const persisted = await prisma.aiAnalysis.findUnique({
      where: { id: saved.analysis.id },
      include: { shadowForecast: true }
    });
    assert.equal(persisted?.shadowForecast?.modelName, "fixture-model");
    assert.equal(Number(persisted?.shadowForecast?.modelProbability), 0.7);

    const refresh = await refreshPendingShadowForecasts({
      now: new Date("2026-01-08T16:00:00+08:00"),
      loadPriceHistory: async () => priceReceipt([
        candle("2026-01-05T15:00:00+08:00", 10, 10.2, 9.8, 10),
        candle("2026-01-06T15:00:00+08:00", 10, 11.2, 9.8, 11)
      ])
    });
    assert.deepEqual(refresh, { checked: 1, pending: 0, resolved: 1, invalid: 0, failed: 0 });

    const resolved = await prisma.shadowForecast.findUnique({ where: { analysisId: saved.analysis.id } });
    assert.equal(resolved?.status, "resolved");
    assert.equal(resolved?.outcome, "target_before_stop");
    assert.equal(resolved?.outcomeValue, 1);
    assert.equal(resolved?.priceProvider, "FIXTURE_RAW");
    assert.equal(resolved?.lastCheckFailure, null);

    const summary = await getForecastCalibrationSummary(user.id);
    assert.deepEqual(summary.counts, { pending: 0, resolved: 1, invalid: 0, failedChecks: 0 });
    assert.equal(summary.overall.sampleSize, 1);
    assert.equal(summary.overall.brierScore, 0.09);
    assert.equal(summary.overall.decisionUseAllowed, false);
    assert.equal(summary.cohorts[0]?.cohortKey, "swing_trade:bullish:20d");
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => null);
  }
});

test("price provider failure stays pending and records a retryable audit failure", {
  skip: !runDbTests
}, async () => {
  const user = await prisma.user.create({ data: { email: `shadow-failure-${Date.now()}-${randomUUID()}@db-e2e.invalid` } });
  try {
    const saved = await persistAnalysisWithShadowForecast({
      userId: user.id,
      symbol,
      inputJson: { contextHash: "db-shadow-failure-fixture" },
      outputJson: JSON.parse(JSON.stringify(analysisFixture(0.6))),
      analysis: analysisFixture(0.6),
      evidenceHash: "b".repeat(64),
      analysisAsOf: "2026-01-05T15:30:00+08:00",
      modelName: "fixture-model"
    });
    const refresh = await refreshPendingShadowForecasts({
      now: new Date("2026-01-06T16:00:00+08:00"),
      loadPriceHistory: async () => { throw new Error("固定样本行情不可用"); }
    });
    assert.deepEqual(refresh, { checked: 1, pending: 0, resolved: 0, invalid: 0, failed: 1 });
    const forecast = await prisma.shadowForecast.findUnique({ where: { analysisId: saved.analysis.id } });
    assert.equal(forecast?.status, "pending");
    assert.match(forecast?.lastCheckFailure ?? "", /固定样本行情不可用/);
    assert.ok((forecast?.nextCheckAt.getTime() ?? 0) > new Date("2026-01-06T16:00:00+08:00").getTime());
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => null);
  }
});

function analysisFixture(probability: number) {
  return {
    decisionMode: "swing_trade",
    trend: "bullish",
    entryOutcomeForecast: {
      schemaVersion: "entry-outcome-forecast-v1",
      status: "subjective_unvalidated",
      targetBeforeStopProbability: probability,
      horizonTradingDays: 20,
      definition: "下一完整交易日开盘进入影子观察，20 个交易日内止盈先于止损。",
      reasoning: "固定样本。"
    },
    tradePlan: {
      entry: {
        shadowEligible: true,
        triggerPrice: 10,
        stopLossPrice: 9,
        takeProfitPrice: 11,
        shares: 100,
        netExpectedProfit: 94.5,
        netMaxLossAmount: 105.5
      }
    }
  } as AiAnalysisResult;
}

function candle(timestamp: string, open: number, high: number, low: number, close: number) {
  return { symbol, timestamp: new Date(timestamp).toISOString(), open, high, low, close, volume: 1_000_000 };
}

function priceReceipt(candles: ReturnType<typeof candle>[]): ValuationPriceHistoryEvidence {
  return {
    schemaVersion: "valuation-price-history-v1",
    status: "available",
    provider: "FIXTURE_RAW",
    sourceUrl: "https://example.invalid/raw-history",
    fetchedAt: "2026-01-08T16:00:00+08:00",
    adjustment: "none",
    candles,
    failure: null
  };
}
