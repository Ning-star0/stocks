import assert from "node:assert/strict";
import test from "node:test";

import { buildEtfEvidence } from "@/lib/instruments/etfEvidence";
import { buildInstrumentProfile } from "@/lib/instruments/profile";
import type { Candle, Quote } from "@/lib/types";

test("ETF evidence derives only auditable identity and 20-session liquidity proxies", () => {
  const history = candles(25);
  const evidence = buildEtfEvidence({
    instrument: buildInstrumentProfile("515880.SH"),
    quote: quote(),
    history,
    quoteProvider: "fixture",
    analysisAsOf: history.at(-1)!.timestamp
  });

  assert.equal(evidence?.schemaVersion, "etf-evidence-v1");
  assert.equal(evidence?.productIdentity.status, "partial");
  assert.equal(evidence?.liquidity.status, "partial");
  assert.equal(evidence?.liquidity.sampleTradingDays, 20);
  assert.equal(evidence?.liquidity.averageDailyVolume20, 1_014_500);
  assert.equal(evidence?.status, "insufficient");
  assert.ok(evidence?.missingFields.includes("etfPremiumDiscount"));
  assert.ok(evidence?.entryBlockers.some((item) => item.includes("禁止新增仓位")));
});

test("ETF liquidity evidence excludes candles after the analysis cutoff", () => {
  const visible = candles(25);
  const future = { ...visible.at(-1)!, timestamp: "2026-09-30T15:00:00+08:00", volume: 999_999_999 };
  const evidence = buildEtfEvidence({
    instrument: buildInstrumentProfile("515880.SH"),
    quote: quote(),
    history: [...visible, future],
    quoteProvider: "fixture",
    analysisAsOf: visible.at(-1)!.timestamp
  });

  assert.equal(evidence?.liquidity.futureCandleExcludedCount, 1);
  assert.equal(evidence?.liquidity.averageDailyVolume20, 1_014_500);
  assert.equal(evidence?.liquidity.asOf, visible.at(-1)!.timestamp);
});

test("short history and non-ETF symbols cannot masquerade as complete ETF evidence", () => {
  const short = buildEtfEvidence({
    instrument: buildInstrumentProfile("159915.SZ"),
    quote: { ...quote(), symbol: "159915.SZ" },
    history: candles(8).map((candle) => ({ ...candle, symbol: "159915.SZ" })),
    quoteProvider: "fixture",
    analysisAsOf: "2026-08-27T15:00:00+08:00"
  });
  const stock = buildEtfEvidence({
    instrument: buildInstrumentProfile("600000.SH"),
    quote: { ...quote(), symbol: "600000.SH" },
    history: candles(25),
    quoteProvider: "fixture",
    analysisAsOf: "2026-08-27T15:00:00+08:00"
  });

  assert.equal(short?.liquidity.status, "unavailable");
  assert.ok(short?.missingFields.includes("etfMinimum20DailyLiquiditySamples"));
  assert.equal(short?.status, "insufficient");
  assert.equal(stock, null);
});

function quote(): Quote {
  return {
    symbol: "515880.SH",
    name: "通信ETF",
    currency: "CNY",
    price: 1.1,
    open: 1.09,
    high: 1.11,
    low: 1.08,
    close: 1.1,
    previousClose: 1.09,
    change: 0.01,
    changePercent: 0.92,
    volume: 1_025_000,
    timestamp: "2026-08-27T15:00:00+08:00"
  };
}

function candles(count: number): Candle[] {
  return Array.from({ length: count }, (_, index) => ({
    symbol: "515880.SH",
    open: 1 + index * 0.001,
    high: 1.02 + index * 0.001,
    low: 0.99 + index * 0.001,
    close: 1.01 + index * 0.001,
    volume: 1_000_000 + index * 1_000,
    timestamp: new Date(Date.UTC(2026, 6, 1 + index, 7)).toISOString()
  }));
}
