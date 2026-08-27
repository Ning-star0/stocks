import assert from "node:assert/strict";
import test from "node:test";

import { buildInstrumentProfile } from "@/lib/instruments/profile";

test("classifies the current ETF symbol families without using AI text", () => {
  for (const symbol of ["515880.SH", "513870.SH", "561380.SH", "512480.SH", "159937.SZ", "159206.SZ"]) {
    assert.equal(buildInstrumentProfile(symbol).instrumentType, "etf", symbol);
  }
});

test("separates A-share stocks, indices and unknown instruments", () => {
  assert.equal(buildInstrumentProfile("600519.SH").instrumentType, "a_share_stock");
  assert.equal(buildInstrumentProfile("300750.SZ").instrumentType, "a_share_stock");
  assert.equal(buildInstrumentProfile("000001.SH").instrumentType, "index");
  assert.equal(buildInstrumentProfile("399001.SZ").instrumentType, "index");
  assert.equal(buildInstrumentProfile("AAPL.US").instrumentType, "unknown");
});
