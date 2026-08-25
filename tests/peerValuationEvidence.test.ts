import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEastMoneyPeerValuationEvidence,
  fetchEastMoneyPeerValuationEvidence,
  isPeerValuationFresh,
  mergePeerValuationEvidence
} from "@/lib/stock-data/peerValuationEvidence";
import type { FundamentalEvidence } from "@/lib/stock-data/types";

test("peer valuation keeps one-provider PE(TTM)/PB(MRQ), excludes non-positive multiples, and cross-checks CNINFO", () => {
  const raw = buildPeerEvidence();
  const merged = mergePeerValuationEvidence(fundamentals(22.5, 3.4), raw);
  const peer = merged.valuation.peerEvidence!;

  assert.equal(peer.status, "available");
  assert.equal(peer.industryName, "测试行业-细分行业");
  assert.equal(peer.peBasis, "PE_TTM");
  assert.equal(peer.pbBasis, "PB_MRQ");
  assert.equal(peer.comparables.length, 5);
  assert.equal(peer.peComparison?.sampleSize, 5);
  assert.equal(peer.peComparison?.sampleMedian, 20);
  assert.equal(peer.peComparison?.percentile, 60);
  assert.equal(peer.peComparison?.premiumDiscountPct, 10);
  assert.equal(peer.pbComparison?.sampleMedian, 3);
  assert.equal(peer.crossCheck.peMatched, true);
  assert.equal(peer.crossCheck.pbMatched, true);
  assert.equal(peer.contentHash?.length, 64);
  assert.equal(merged.missingFields.includes("peerValuation"), false);
  assert.equal(merged.metrics.peerValuationSampleSize, 5);
});

test("peer valuation remains partial when a positive-multiple sample is short", () => {
  const raw = buildPeerEvidence({ peerPeValues: [10, 15, 20, 25, -30] });
  const merged = mergePeerValuationEvidence(fundamentals(22, 3.5), raw);
  const peer = merged.valuation.peerEvidence!;

  assert.equal(peer.status, "partial");
  assert.equal(peer.peComparison?.sampleSize, 4);
  assert.equal(peer.pbComparison?.sampleSize, 5);
  assert.ok(merged.missingFields.includes("peerValuation"));
  assert.match(peer.missingReason ?? "", /PE\(TTM\).*4\/5/);
});

test("peer valuation becomes conflicted when provider and deterministic current multiples diverge", () => {
  const merged = mergePeerValuationEvidence(fundamentals(40, 3.5), buildPeerEvidence());
  const peer = merged.valuation.peerEvidence!;

  assert.equal(peer.status, "conflicted");
  assert.equal(peer.crossCheck.peMatched, false);
  assert.ok(merged.missingFields.includes("peerValuation"));
  assert.ok(merged.conflictingFields.includes("peerValuationCurrentMultipleMismatch"));
  assert.match(peer.missingReason ?? "", /跨源差异/);
});

test("peer valuation source failures are explicit and failed responses are not cached", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("upstream unavailable", { status: 503 });
  };
  try {
    const first = await fetchEastMoneyPeerValuationEvidence({ symbol: "601399.SH", forceRefresh: true });
    const second = await fetchEastMoneyPeerValuationEvidence({ symbol: "601399.SH", forceRefresh: true });
    assert.equal(first.status, "unavailable");
    assert.equal(second.status, "unavailable");
    assert.match(first.missingReason ?? "", /503/);
    assert.equal(calls, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("peer valuation exposes a 24-hour freshness gate for the cached snapshot", () => {
  const evidence = buildPeerEvidence();
  assert.equal(evidence.maximumAgeHours, 24);
  assert.equal(isPeerValuationFresh(evidence, new Date(Date.parse(evidence.fetchedAt) + 23 * 60 * 60 * 1000)), true);
  assert.equal(isPeerValuationFresh(evidence, new Date(Date.parse(evidence.fetchedAt) + 25 * 60 * 60 * 1000)), false);
});

function buildPeerEvidence(options: { peerPeValues?: number[] } = {}) {
  return buildEastMoneyPeerValuationEvidence({
    targetSymbol: "601398.SH",
    fetchedAt: "2026-08-25T02:00:00.000Z",
    sourceUrl: "https://emweb.securities.eastmoney.com/PC_HSF10/IndustryAnalysis/PageAjax?code=SH601398",
    classificationSourceUrl: "https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/PageAjax?code=SH601398",
    peerPayload: peerPayload(options.peerPeValues),
    surveyPayload: {
      jbzl: {
        SECUCODE: "601398.SH",
        SECURITY_NAME_ABBR: "目标公司",
        EM2016: "测试行业-细分行业"
      }
    }
  });
}

function peerPayload(peerPeValues = [10, 15, 20, 25, 30]) {
  const peers = peerPeValues.map((pe, index) => ({
    SECUCODE: "601398.SH",
    SECURITY_CODE: "601398",
    CORRE_SECUCODE: `60000${index + 1}.SH`,
    CORRE_SECURITY_NAME: `同行${index + 1}`,
    PE_TTM: pe,
    PB_MRQ: index + 1,
    PAIMING: index + 1,
    REPORT_DATE: "2025-12-31 00:00:00"
  }));
  return {
    gzbj: [
      { CORRE_SECUCODE: "行业平均", CORRE_SECURITY_NAME: "行业平均", PE_TTM: -8, PB_MRQ: 2.8 },
      { CORRE_SECUCODE: "行业中值", CORRE_SECURITY_NAME: "行业中值", PE_TTM: 18, PB_MRQ: 2.5 },
      ...peers,
      {
        SECUCODE: "601398.SH",
        SECURITY_CODE: "601398",
        CORRE_SECUCODE: "601398.SH",
        CORRE_SECURITY_NAME: "目标公司",
        PE_TTM: 22,
        PB_MRQ: 3.5,
        PAIMING: 8,
        REPORT_DATE: "2025-12-31 00:00:00"
      }
    ]
  };
}

function fundamentals(peTtm: number, pb: number): FundamentalEvidence {
  return {
    schemaVersion: "fundamental-evidence-v2",
    status: "partial",
    provider: "CNINFO",
    sourceUrl: "https://www.cninfo.com.cn/",
    fetchedAt: "2026-08-25T02:00:00.000Z",
    reportPeriod: "2025-12-31",
    annualPeriods: [],
    quarterlyPeriods: [],
    adjustedNetIncomeSources: [],
    valuation: {
      asOf: "2026-08-25T02:00:00.000Z",
      price: 22,
      epsTtm: 1,
      peTtm,
      bookValuePerShare: 6.2857,
      pb,
      historicalPercentile: null,
      historicalEvidence: null,
      peerEvidence: null
    },
    metrics: {},
    missingFields: ["adjustedNetIncome", "valuationHistoricalPercentile", "peerValuation"],
    conflictingFields: [],
    failures: [],
    missingReason: "尚缺关键估值证据"
  };
}
