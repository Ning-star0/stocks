import assert from "node:assert/strict";
import test from "node:test";

import { assessNewsEvidenceCoverage, planNewsEvidenceAnalysis, type NewsEvidenceCandidate } from "../lib/news/evidencePolicy";

const candidates: NewsEvidenceCandidate[] = [
  { id: "high-verified", importance: "high", publishedAt: "2026-08-25T08:00:00Z", analysisState: "verified" },
  { id: "high-fallback", importance: "high", publishedAt: "2026-08-25T09:00:00Z", analysisState: "fallback" },
  { id: "high-missing", importance: "high", publishedAt: "2026-08-25T10:00:00Z", analysisState: "missing" },
  { id: "medium-new", importance: "medium", publishedAt: "2026-08-25T11:00:00Z", analysisState: "missing" },
  { id: "medium-old", importance: "medium", publishedAt: "2026-08-24T11:00:00Z", analysisState: "failed" }
];

test("news evidence plan retries fallback items and prioritizes all critical news", () => {
  const plan = planNewsEvidenceAnalysis(candidates, { maxCritical: 10, maxMedium: 1 });

  assert.deepEqual(plan.selectedIds, ["high-missing", "high-fallback", "medium-new"]);
  assert.deepEqual(plan.deferredCriticalIds, []);
  assert.deepEqual(plan.deferredMediumIds, ["medium-old"]);
});

test("fallback news never counts as verified evidence and keeps critical coverage open", () => {
  const coverage = assessNewsEvidenceCoverage(candidates);

  assert.equal(coverage.relevantCount, 5);
  assert.equal(coverage.verifiedAnalyzedCount, 1);
  assert.equal(coverage.fallbackAnalysisCount, 1);
  assert.equal(coverage.failedAnalysisCount, 1);
  assert.equal(coverage.pendingCriticalCount, 2);
  assert.equal(coverage.pendingRelevantCount, 4);
});

test("critical analysis cap is explicit instead of silently dropping news", () => {
  const plan = planNewsEvidenceAnalysis(candidates, { maxCritical: 1, maxMedium: 0 });

  assert.deepEqual(plan.selectedIds, ["high-missing"]);
  assert.deepEqual(plan.deferredCriticalIds, ["high-fallback"]);
  assert.deepEqual(plan.deferredMediumIds, ["medium-new", "medium-old"]);
});
