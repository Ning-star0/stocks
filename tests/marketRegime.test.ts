import assert from "node:assert/strict";
import test from "node:test";

import { buildBenchmarkMarketRegimeEvidence } from "@/lib/analysis/marketRegime";
import type { ValuationPriceHistoryEvidence } from "@/lib/stock-data/types";

test("CSI 300 regime uses only raw candles visible at the analysis cutoff", () => {
  const candles = Array.from({ length: 130 }, (_, index) => {
    const close = 3_000 + index * 10;
    return {
      symbol: "000300.SH",
      timestamp: new Date(Date.parse("2026-01-01T15:00:00+08:00") + index * 24 * 60 * 60 * 1000).toISOString(),
      open: close - 4,
      high: close + 8,
      low: close - 8,
      close,
      volume: 100_000_000 + index * 100_000
    };
  });
  const futureCrash = {
    ...candles.at(-1)!,
    timestamp: "2026-08-30T15:00:00+08:00",
    open: 2_000,
    high: 2_100,
    low: 1_800,
    close: 1_900
  };
  const evidence = buildBenchmarkMarketRegimeEvidence(receipt([...candles, futureCrash]), "2026-05-10T16:00:00+08:00");

  assert.equal(evidence.status, "available");
  assert.equal(evidence.regime, "risk_on");
  assert.equal(evidence.benchmarkSymbol, "000300.SH");
  assert.equal(evidence.priceBasis, "raw_unadjusted");
  assert.equal(evidence.asOf, candles.at(-1)?.timestamp);
  assert.match(evidence.evidenceHash ?? "", /^[a-f0-9]{64}$/);
});

test("stale or unavailable benchmark evidence is explicit and cannot claim a regime", () => {
  const short = buildBenchmarkMarketRegimeEvidence(receipt([]), "2026-05-10T16:00:00+08:00");
  assert.equal(short.status, "unavailable");
  assert.equal(short.regime, "unknown");
  assert.match(short.failure ?? "", /不足/);

  const rows = Array.from({ length: 120 }, (_, index) => ({
    symbol: "000300.SH",
    timestamp: new Date(Date.parse("2025-01-01T15:00:00+08:00") + index * 24 * 60 * 60 * 1000).toISOString(),
    open: 3_000,
    high: 3_010,
    low: 2_990,
    close: 3_000,
    volume: 100_000_000
  }));
  const stale = buildBenchmarkMarketRegimeEvidence(receipt(rows), "2026-05-10T16:00:00+08:00");
  assert.equal(stale.status, "stale");
  assert.equal(stale.regime, "unknown");
  assert.match(stale.failure ?? "", /超过 7 天/);
});

function receipt(candles: ValuationPriceHistoryEvidence["candles"]): ValuationPriceHistoryEvidence {
  return {
    schemaVersion: "valuation-price-history-v1",
    status: "available",
    provider: "FIXTURE_RAW",
    sourceUrl: "https://example.invalid/csi300",
    fetchedAt: "2026-05-10T16:00:00+08:00",
    adjustment: "none",
    candles,
    failure: null
  };
}
