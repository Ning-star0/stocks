import assert from "node:assert/strict";
import test from "node:test";

import { assessCandidateBuy, candidateSupportsSell } from "@/lib/focus/decisionCandidate";
import type { Candidate } from "@/lib/focus/decisionTypes";
import type { QuantSignal } from "@/lib/quant/strategy";

test("AI confidence, trend and Chinese advice cannot unlock a buy", () => {
  const candidate = candidateFixture({
    latestAnalysis: {
      ...eligibleAnalysis(),
      decisionStatus: "setup_wait",
      trend: "bullish",
      confidence: 0.99,
      entryAdvice: { action: "立即满仓买入", reason: "强烈看多" }
    }
  });

  const assessment = assessCandidateBuy(candidate);
  assert.equal(assessment.supported, false);
  assert.ok(assessment.blockerDetails.some((item) => item.code === "analysis_status_not_entry"));
});

test("bearish AI text cannot block an otherwise valid structured entry", () => {
  const candidate = candidateFixture({
    latestAnalysis: {
      ...eligibleAnalysis(),
      trend: "bearish",
      confidence: 0.01,
      entryAdvice: { action: "回避并离场", reason: "模型不喜欢" }
    }
  });

  assert.equal(assessCandidateBuy(candidate).supported, true);
});

test("unvalidated expected value remains a calibration hard blocker", () => {
  const analysis = eligibleAnalysis();
  analysis.tradePlan = {
    ...analysis.tradePlan!,
    entry: {
      ...analysis.tradePlan!.entry,
      status: "blocked",
      action: "avoid",
      expectedValueStatus: "not_calibrated",
      expectedValue: null,
      calibratedWinProbability: null,
      validationSampleSize: null,
      calibrationVersion: null
    }
  };
  const assessment = assessCandidateBuy(candidateFixture({ latestAnalysis: analysis }));

  assert.equal(assessment.supported, false);
  assert.ok(assessment.blockerDetails.some((item) => item.code === "expected_value_not_calibrated"));
  assert.ok(assessment.blockerDetails.some((item) => item.category === "calibration"));
});

test("Chinese sell advice cannot create a sell, but a structured exit can", () => {
  const textOnly = candidateFixture({
    isHolding: true,
    holdingShares: 100,
    latestAnalysis: {
      ...eligibleAnalysis(),
      decisionStatus: "manage_position",
      holdAdvice: { action: "立即止损清仓" },
      tradePlan: {
        ...eligibleAnalysis().tradePlan!,
        exit: { ...eligibleAnalysis().tradePlan!.exit, status: "watch", action: "watch", shares: null }
      }
    },
    quantSignal: quantFixture({ action: "hold", sellScore: 20, suggestedSellShares: 0, suggestedSellRatioPct: 0 })
  });
  assert.equal(candidateSupportsSell(textOnly), false);

  const structured = {
    ...textOnly,
    latestAnalysis: {
      ...textOnly.latestAnalysis,
      decisionStatus: "exit_risk" as const,
      tradePlan: {
        ...textOnly.latestAnalysis!.tradePlan!,
        exit: { ...textOnly.latestAnalysis!.tradePlan!.exit, status: "conditional" as const, action: "sell" as const, shares: 100 }
      }
    }
  };
  assert.equal(candidateSupportsSell(structured), true);
});

function candidateFixture(overrides: Partial<Candidate> = {}): Candidate {
  return {
    symbol: "515880.SH",
    name: "通信ETF",
    price: 1,
    changePct: 0.5,
    quoteTime: "2026-08-26T06:30:00.000Z",
    status: "normal",
    isHolding: false,
    holdingShares: null,
    latestAnalysis: eligibleAnalysis(),
    quantSignal: quantFixture(),
    ...overrides
  };
}

function eligibleAnalysis(): NonNullable<Candidate["latestAnalysis"]> {
  return {
    decisionStatus: "conditional_entry",
    isFallback: false,
    trend: "neutral",
    confidence: 0.5,
    dataQuality: {
      status: "complete",
      instrumentType: "a_share_stock",
      instrumentClassificationSource: "exchange_symbol",
      instrumentEvidencePolicyVersion: "instrument-evidence-policy-v1",
      instrumentEvidenceComplete: true,
      quoteFresh: true,
      klineFresh: true,
      latestDisclosureChecked: true,
      disclosuresFresh: true,
      criticalDisclosuresRead: true,
      fundamentalsAvailable: true,
      fundamentalsFresh: true,
      fundamentalsComplete: true,
      portfolioRiskEvaluated: true,
      newsRefreshCompleted: true,
      newsQuotaStatus: "available",
      criticalNewsAnalyzed: true,
      missingFields: [],
      staleFields: [],
      conflictingFields: [],
      fallbacksUsed: [],
      entryBlockers: []
    },
    tradePlan: {
      entry: {
        status: "conditional",
        action: "buy",
        shadowEligible: true,
        triggerPrice: 1,
        stopLossPrice: 0.9,
        takeProfitPrice: 1.3,
        shares: 100,
        amount: 100,
        estimatedFee: 5,
        totalCost: 105,
        maxLossAmount: 10,
        netMaxLossAmount: 20,
        riskRewardRatio: 3,
        netRiskRewardRatio: 1.5,
        expectedValueStatus: "positive",
        calibratedWinProbability: 0.6,
        expectedValue: 5,
        validationSampleSize: 120,
        calibrationVersion: "fixed-holdout-v1",
        reason: "结构化固定样本",
        constraints: []
      },
      exit: {
        status: "not_applicable",
        action: "watch",
        triggerPrice: 1,
        stopLossPrice: null,
        takeProfitPrice: null,
        shares: null,
        amount: null,
        estimatedFee: null,
        reason: "未持仓",
        constraints: []
      },
      feeRule: { rate: 0.0005, minimumFeeBase: 10000, minimumFee: 5, lotSize: 100, description: "固定样本" }
    }
  };
}

function quantFixture(overrides: Partial<QuantSignal> = {}): QuantSignal {
  return {
    action: "buy",
    trendScore: 80,
    momentumScore: 75,
    riskScore: 30,
    buyScore: 80,
    sellScore: 20,
    confidence: 0.8,
    volumeRatio: 1,
    supportDistancePct: 2,
    resistanceDistancePct: 10,
    stopDistancePct: 10,
    takeProfitDistancePct: 30,
    riskRewardRatio: 3,
    holdingReturnPct: null,
    suggestedBuyCapitalPct: 10,
    suggestedSellRatioPct: 0,
    suggestedSellShares: 0,
    adjustedBuyThreshold: 70,
    adjustedAddThreshold: 72,
    adjustedReduceThreshold: 62,
    adjustedSellThreshold: 76,
    holdingDays: null,
    newPositionProtection: false,
    marketRegime: "neutral",
    sectorBias: "neutral",
    entryZone: "1.00",
    stopLoss: "0.90",
    takeProfit: "1.30",
    entryPlan: "满足结构化条件后执行",
    exitPlan: "跌破止损退出",
    tradeConstraints: [],
    reasons: [],
    risks: [],
    ...overrides
  };
}
