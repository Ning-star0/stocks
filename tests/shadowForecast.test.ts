import assert from "node:assert/strict";
import test from "node:test";

import {
  buildForecastCalibrationReport,
  buildShadowForecastSnapshot,
  evaluateShadowForecast
} from "@/lib/validation/shadowForecast";
import type { AiAnalysisResult, Candle } from "@/lib/types";

test("shadow snapshot records a subjective probability without using it for sizing", () => {
  const snapshot = buildShadowForecastSnapshot({
    analysis: analysisFixture(0.73),
    evidenceHash: "a".repeat(64),
    analysisAsOf: "2026-08-25T07:10:00.000Z"
  });

  assert.ok(snapshot);
  assert.equal(snapshot.modelProbability, 0.73);
  assert.equal(snapshot.horizonTradingDays, 20);
  assert.equal(snapshot.plannedShares, 100);
  assert.equal(buildShadowForecastSnapshot({
    analysis: { ...analysisFixture(0.73), tradePlan: { ...analysisFixture(0.73).tradePlan!, entry: { ...analysisFixture(0.73).tradePlan!.entry, shadowEligible: false } } },
    evidenceHash: "a".repeat(64),
    analysisAsOf: "2026-08-25T07:10:00.000Z"
  }), null);
});

test("shadow outcome starts at the next full session and never reads past evaluation cutoff", () => {
  const forecast = snapshotFixture();
  const result = evaluateShadowForecast({
    forecast,
    candles: [
      candle("2026-08-25T07:00:00.000Z", 12, 14.5, 10.5, 13),
      candle("2026-08-26T07:00:00.000Z", 12, 12.8, 11.5, 12.5),
      candle("2026-08-27T07:00:00.000Z", 12.5, 14.2, 12.2, 14),
      candle("2026-08-28T07:00:00.000Z", 14, 14.5, 13.8, 14.2)
    ],
    evaluationAsOf: "2026-08-27T08:00:00.000Z"
  });

  assert.equal(result.status, "resolved");
  assert.equal(result.entryAt, "2026-08-26T07:00:00.000Z");
  assert.equal(result.outcome, "target_before_stop");
  assert.equal(result.outcomeValue, 1);
  assert.equal(result.observedTradingDays, 2);
  assert.equal(result.priceDataThrough, "2026-08-27T07:00:00.000Z");
  assert.ok((result.netReturnPct ?? 0) > 0);
});

test("same-session target and stop is conservatively recorded as a loss", () => {
  const result = evaluateShadowForecast({
    forecast: snapshotFixture(),
    candles: [candle("2026-08-26T07:00:00.000Z", 12, 14.2, 10.8, 12.5)],
    evaluationAsOf: "2026-08-26T08:00:00.000Z"
  });

  assert.equal(result.status, "resolved");
  assert.equal(result.outcome, "ambiguous_same_session_stop_assumed");
  assert.equal(result.outcomeValue, 0);
  assert.ok((result.netReturnPct ?? 0) < 0);
});

test("calibration report computes Brier score and remains shadow-only", () => {
  const observations = Array.from({ length: 100 }, (_, index) => ({
    probability: index < 50 ? 0.2 : 0.8,
    outcome: (index % 2 === 0 ? 1 : 0) as 0 | 1,
    cohortKey: "swing_trade:bullish:20d"
  }));
  const report = buildForecastCalibrationReport(observations);

  assert.equal(report.sampleSize, 100);
  assert.equal(report.status, "shadow_only");
  assert.equal(report.observedWinRate, 0.5);
  assert.equal(report.brierScore, 0.34);
  assert.equal(report.baselineBrierScore, 0.25);
  assert.equal(report.decisionUseAllowed, false);
  assert.equal(report.bins.length, 2);
});

function analysisFixture(probability: number): AiAnalysisResult {
  return {
    decisionMode: "swing_trade",
    decisionStatus: "rejected",
    trend: "bullish",
    confidence: 0.99,
    entryOutcomeForecast: {
      schemaVersion: "entry-outcome-forecast-v1",
      status: "subjective_unvalidated",
      targetBeforeStopProbability: probability,
      horizonTradingDays: 20,
      definition: "固定样本定义",
      reasoning: "支持与反对证据并存。"
    },
    summary: "测试",
    keyLevels: { support: [11], resistance: [14] },
    riskFactors: [],
    newsSummary: "测试",
    newsSentiment: "neutral",
    webSearchSummary: "",
    newsReferences: [],
    webSearchResults: [],
    catalystEvents: [],
    macroRisks: [],
    sectorRisks: [],
    possibleActions: [{ action: "watch", reason: "测试", timing: "", triggerCondition: "", entryZone: "", stopLossPlan: "", takeProfitPlan: "", positionSizing: "", followUpCheck: "", invalidIf: "测试" }],
    holdAdvice: null,
    entryAdvice: null,
    tradePlan: {
      entry: {
        status: "blocked",
        action: "avoid",
        shadowEligible: true,
        triggerPrice: 12,
        stopLossPrice: 11,
        takeProfitPrice: 14,
        shares: 100,
        amount: 1200,
        estimatedFee: 5,
        netExpectedProfit: 190,
        netMaxLossAmount: 110,
        reason: "影子观察",
        constraints: ["尚未校准"]
      },
      exit: {
        status: "not_applicable",
        action: "watch",
        triggerPrice: null,
        stopLossPrice: null,
        takeProfitPrice: null,
        shares: null,
        amount: null,
        estimatedFee: null,
        reason: "不适用",
        constraints: []
      },
      feeRule: { rate: 0.0005, minimumFeeBase: 10000, minimumFee: 5, lotSize: 100, description: "测试" }
    },
    disclaimer: "测试"
  };
}

function snapshotFixture() {
  return {
    analysisAsOf: "2026-08-25T07:10:00.000Z",
    horizonTradingDays: 20 as const,
    stopLossPrice: 11,
    takeProfitPrice: 14,
    plannedShares: 100
  };
}

function candle(timestamp: string, open: number, high: number, low: number, close: number): Candle {
  return { symbol: "600000.SH", timestamp, open, high, low, close, volume: 1000 };
}
