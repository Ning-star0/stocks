import assert from "node:assert/strict";
import test from "node:test";

import { resolveAnalysisHistoryAction } from "@/lib/analysis/runRecords";

test("decision history uses structured status instead of Chinese advice text", () => {
  assert.equal(resolveAnalysisHistoryAction({
    decisionStatus: "insufficient_data",
    entryAdvice: { action: "立即满仓买入" },
    possibleActions: [{ action: "买入" }],
    tradePlan: { entry: { status: "blocked", action: "avoid" } }
  }), "insufficient_data");
});

test("legacy analysis history only accepts structured trade-plan enums", () => {
  assert.equal(resolveAnalysisHistoryAction({
    entryAdvice: { action: "强烈买入" },
    tradePlan: { entry: { status: "blocked", action: "avoid" } }
  }), "avoid");
  assert.equal(resolveAnalysisHistoryAction({ entryAdvice: { action: "强烈买入" } }), "watch");
});
