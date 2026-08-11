import assert from "node:assert/strict";
import test from "node:test";

import { evaluateStrategyHealth, type StrategyBacktestResult } from "@/lib/strategy/backtest";

test("small samples can reduce size but cannot hard-pause a symbol", () => {
  assert.equal(evaluateStrategyHealth(result({ closedTrades: 3, netReturnPct: -9, maxDrawdownPct: 20, profitFactor: 0.1 })).entryPermission, "reduce_size");
  assert.equal(evaluateStrategyHealth(result({ closedTrades: 5, netReturnPct: -20, maxDrawdownPct: 30, profitFactor: 0.1 })).entryPermission, "reduce_size");
});

test("the former 13-trade pause pattern is now a soft size reduction", () => {
  const health = evaluateStrategyHealth(result({ closedTrades: 13, netReturnPct: -3.75, maxDrawdownPct: 6.08, profitFactor: 0.8 }));
  assert.equal(health.strategyHealth, "watch");
  assert.equal(health.entryPermission, "reduce_size");
});

test("hard pause remains available for sufficiently sampled severe failure", () => {
  const health = evaluateStrategyHealth(result({ closedTrades: 12, netReturnPct: -8, maxDrawdownPct: 12, profitFactor: 0.5 }));
  assert.equal(health.strategyHealth, "pause");
  assert.equal(health.entryPermission, "pause");
});

test("positive validated results remain allowed", () => {
  const health = evaluateStrategyHealth(result({ closedTrades: 8, netReturnPct: 3, maxDrawdownPct: 4, profitFactor: 1.2 }));
  assert.equal(health.strategyHealth, "healthy");
  assert.equal(health.entryPermission, "allow");
});

function result(input: Pick<StrategyBacktestResult, "closedTrades" | "netReturnPct" | "maxDrawdownPct" | "profitFactor">) {
  return input as StrategyBacktestResult;
}
