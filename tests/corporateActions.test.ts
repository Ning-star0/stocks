import assert from "node:assert/strict";
import test from "node:test";

import {
  adjustTencentHistoryForCorporateActions,
  assertNoUnexplainedCorporateActionGap
} from "@/lib/stock-data/corporateActions";
import type { Candle } from "@/lib/types";

test("forward-adjusts every confirmed 515880 split onto the latest price basis", () => {
  const candles = [
    candle("515880.SH", "2026-02-02", 3, 3, 100),
    candle("515880.SH", "2026-02-03", 1, 1.02, 300),
    candle("515880.SH", "2026-07-03", 1.6, 1.6, 200),
    candle("515880.SH", "2026-07-06", 0.8, 0.81, 400)
  ];

  const adjusted = adjustTencentHistoryForCorporateActions("515880.SH", candles);

  assert.equal(adjusted[0].open, 0.5);
  assert.equal(adjusted[0].close, 0.5);
  assert.equal(adjusted[0].volume, 600);
  assert.equal(adjusted[1].open, 0.5);
  assert.equal(adjusted[1].close, 0.51);
  assert.equal(adjusted[2].close, 0.8);
  assert.equal(adjusted[3].open, 0.8);
});

test("rejects an unregistered gap that resembles a raw split", () => {
  const candles = [
    candle("513999.SH", "2026-07-01", 2, 2, 100),
    candle("513999.SH", "2026-07-02", 1, 1.01, 200)
  ];

  assert.throws(
    () => assertNoUnexplainedCorporateActionGap("513999.SH", candles),
    /疑似未复权/
  );
});

test("does not reject an ordinary market decline", () => {
  const candles = [
    candle("513999.SH", "2026-07-01", 2, 2, 100),
    candle("513999.SH", "2026-07-02", 1.65, 1.68, 200)
  ];

  assert.doesNotThrow(() => assertNoUnexplainedCorporateActionGap("513999.SH", candles));
});

function candle(symbol: string, date: string, open: number, close: number, volume: number): Candle {
  return {
    symbol,
    open,
    high: Math.max(open, close),
    low: Math.min(open, close),
    close,
    volume,
    timestamp: `${date}T15:00:00+08:00`
  };
}
