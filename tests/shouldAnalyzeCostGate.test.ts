import assert from "node:assert/strict";
import test from "node:test";

import {
  hasDecisionContextChanged,
  hasMaterialEvidenceChanged,
  shouldRunStockAnalysis
} from "@/lib/analysis/shouldAnalyze";
import type { AnalyzeStockInput } from "@/lib/ai/stockAnalysisTypes";
import type { IndicatorSnapshot, Quote } from "@/lib/types";

const quote = { price: 10 } as Quote;
const indicators = { rsi14: 55, macd: 0.2, macdSignal: 0.1, sma20: 9.8, sma50: 9.5, sma200: 8.8 } as IndicatorSnapshot;

test("scheduled refresh reuses recent analysis when only volatile timestamps and small price movement changed", () => {
  const previous = analysisInput();
  const current = analysisInput();
  current.analysisAsOf = "2026-08-27T14:30:00+08:00";
  current.evidencePackage!.analysisAsOf = current.analysisAsOf;
  current.evidencePackage!.fundamentals.fetchedAt = current.analysisAsOf;
  current.evidencePackage!.disclosures.checkedAt = current.analysisAsOf;

  assert.equal(hasMaterialEvidenceChanged(previous, current), false);
  assert.equal(hasDecisionContextChanged(previous, current), false);

  const gate = shouldRunStockAnalysis({
    latestAnalysis: { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), inputJson: previous, outputJson: {} },
    currentQuote: { ...quote, price: 10.2 },
    currentIndicators: indicators,
    highImpactNewsIds: ["news-1"],
    previousHighImpactNewsIds: ["news-1"],
    userContextHashChanged: false,
    materialEvidenceChanged: false
  });
  assert.equal(gate.shouldRun, false);
  assert.equal(gate.reason, "context_unchanged");
});

test("new disclosure content or portfolio change deterministically triggers a rerun", () => {
  const previous = analysisInput();
  const disclosureChanged = analysisInput();
  disclosureChanged.evidencePackage!.disclosures.items[0]!.contentHash = "new-hash";
  assert.equal(hasMaterialEvidenceChanged(previous, disclosureChanged), true);

  const capitalChanged = analysisInput();
  capitalChanged.userCapital = 80_000;
  assert.equal(hasDecisionContextChanged(previous, capitalChanged), true);

  const gate = shouldRunStockAnalysis({
    latestAnalysis: { createdAt: new Date(), inputJson: previous, outputJson: {} },
    currentQuote: quote,
    currentIndicators: indicators,
    highImpactNewsIds: ["news-1"],
    previousHighImpactNewsIds: ["news-1"],
    userContextHashChanged: false,
    materialEvidenceChanged: true
  });
  assert.equal(gate.shouldRun, true);
  assert.equal(gate.reason, "material_evidence_changed");
});

function analysisInput() {
  return {
    symbol: "600000.SH",
    quote,
    indicators,
    historySummary: {},
    userContext: { isHolding: false, timeHorizon: "swing_trade", riskLevel: "medium" },
    userCapital: 100_000,
    userMemory: "不追高",
    analysisAsOf: "2026-08-27T10:45:00+08:00",
    evidencePackage: {
      schemaVersion: "1.11.0",
      decisionPolicyVersion: "north-star-v2",
      marketDataRevision: "fixture",
      analysisAsOf: "2026-08-27T10:45:00+08:00",
      instrument: { instrumentType: "a_share_stock" },
      marketEnvironment: { status: "available", regime: "neutral", asOf: "2026-08-27T10:45:00+08:00" },
      fundamentals: { status: "available", fetchedAt: "2026-08-27T10:45:00+08:00", reportPeriod: "2026Q2", metrics: { roe: 12 } },
      disclosures: { status: "checked", checkedAt: "2026-08-27T10:45:00+08:00", items: [{ id: "d1", contentHash: "hash-1" }] },
      news: {
        window: "7d",
        refreshCompleted: true,
        quotaStatus: "available",
        sourceProviders: ["tianapi"],
        relevantCount: 1,
        highCount: 1,
        mediumCount: 0,
        analyzedCount: 1,
        fallbackAnalysisCount: 0,
        failedAnalysisCount: 0,
        pendingCriticalCount: 0,
        pendingRelevantCount: 0,
        deadlineExceeded: false,
        failures: [],
        items: [{ id: "news-1", title: "公告" }],
        timeline: { events: [{ eventId: "event-1" }], generatedAt: "2026-08-27T10:45:00+08:00" }
      },
      dataQuality: { status: "complete", entryBlockers: [] },
      sourceManifest: [{ kind: "fundamentals", provider: "fixture", status: "available", asOf: "2026-08-27T10:45:00+08:00" }]
    }
  } as unknown as AnalyzeStockInput;
}
