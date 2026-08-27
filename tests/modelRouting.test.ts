import assert from "node:assert/strict";
import test from "node:test";

import { routeStockAnalysisModel } from "@/lib/ai/modelRouting";
import type { AnalyzeStockInput } from "@/lib/ai/stockAnalysisTypes";

test("unheld stock research uses Flash", () => {
  const route = routeStockAnalysisModel(input({ isHolding: false }));
  assert.equal(route.tier, "standard");
  assert.equal(route.reason, "research_default_flash");
});

test("existing position review uses Pro", () => {
  const byFlag = routeStockAnalysisModel(input({ isHolding: true }));
  const byShares = routeStockAnalysisModel(input({ holdingShares: 500 }));
  assert.equal(byFlag.tier, "flagship");
  assert.equal(byShares.tier, "flagship");
  assert.equal(byFlag.reason, "existing_position_review");
});

test("missing evidence does not spend Pro because a larger model cannot replace missing facts", () => {
  const route = routeStockAnalysisModel(input({ isHolding: false }, "insufficient"));
  assert.equal(route.tier, "standard");
});

function input(userContext: Record<string, unknown>, dataQualityStatus = "complete") {
  return {
    symbol: "600000.SH",
    quote: {},
    indicators: {},
    historySummary: {},
    userContext,
    evidencePackage: {
      decisionMode: userContext.isHolding || Number(userContext.holdingShares) > 0 ? "position_management" : "swing_trade",
      dataQuality: { status: dataQualityStatus }
    }
  } as AnalyzeStockInput;
}
