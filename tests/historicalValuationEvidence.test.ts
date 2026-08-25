import assert from "node:assert/strict";
import test from "node:test";

import { AShareEastMoneyProvider } from "@/lib/stock-data/a-share";
import {
  buildHistoricalValuationEvidence,
  mergeHistoricalValuationEvidence
} from "@/lib/stock-data/historicalValuationEvidence";
import type {
  DisclosureEvidence,
  FinancialPeriodEvidence,
  FundamentalEvidence,
  ValuationPriceHistoryEvidence
} from "@/lib/stock-data/types";

test("historical valuation uses unadjusted prices only after statutory report publication", () => {
  const fundamentals = fixtureFundamentals();
  const disclosures = fixtureDisclosures();
  const prices = fixturePrices();
  const historical = buildHistoricalValuationEvidence(fundamentals, disclosures, prices);

  assert.equal(historical.status, "available");
  assert.equal(historical.priceAdjustment, "none");
  assert.equal(historical.priceProvider, "EASTMONEY");
  assert.ok(historical.priceSeriesHash?.length === 64);
  assert.ok(historical.peSampleSize >= 252);
  assert.ok(historical.pbSampleSize >= 252);
  assert.ok(historical.reportSourceCount >= 4);
  assert.ok(historical.pePercentile !== null);
  assert.ok(historical.pbPercentile !== null);
  assert.ok(historical.compositePercentile !== null);
  assert.equal(historical.reportSources[0].periodEnd, "2023-12-31");
  assert.equal(historical.reportSources[0].effectiveFrom, "2024-03-26");
  assert.ok(historical.reportSources.every((source) => source.effectiveFrom > shanghaiDate(source.publishedAt)));

  const intradayFundamentals = fixtureFundamentals();
  intradayFundamentals.valuation.asOf = "2026-06-30T06:59:00.000Z";
  const intraday = buildHistoricalValuationEvidence(intradayFundamentals, disclosures, prices);
  assert.equal(intraday.windowEnd, "2026-06-29");

  const merged = mergeHistoricalValuationEvidence(fundamentals, disclosures, prices);
  assert.equal(merged.missingFields.includes("valuationHistoricalPercentile"), false);
  assert.equal(merged.valuation.historicalPercentile, historical.compositePercentile);
  assert.equal(merged.metrics.historicalPeSampleSize, historical.peSampleSize);
});

test("historical valuation stays partial when samples are short and unavailable when the price source fails", () => {
  const shortPrices = fixturePrices().candles.slice(-100);
  const partial = buildHistoricalValuationEvidence(fixtureFundamentals(), fixtureDisclosures(), {
    ...fixturePrices(),
    candles: shortPrices
  });
  assert.equal(partial.status, "partial");
  assert.equal(partial.compositePercentile, null);
  assert.match(partial.missingReason ?? "", /不足|样本/);

  const failedPrices: ValuationPriceHistoryEvidence = {
    schemaVersion: "valuation-price-history-v1",
    status: "unavailable",
    provider: "EASTMONEY_TENCENT",
    sourceUrl: "",
    fetchedAt: "2026-06-30T08:00:00.000Z",
    adjustment: "none",
    candles: [],
    failure: "上游不可用"
  };
  const unavailable = mergeHistoricalValuationEvidence(fixtureFundamentals(), fixtureDisclosures(), failedPrices);
  assert.equal(unavailable.valuation.historicalEvidence?.status, "unavailable");
  assert.equal(unavailable.valuation.historicalPercentile, null);
  assert.ok(unavailable.missingFields.includes("valuationHistoricalPercentile"));
  assert.ok(unavailable.failures.some((failure) => failure.includes("上游不可用")));

  const staleFundamentals = fixtureFundamentals();
  staleFundamentals.valuation.asOf = "2026-08-30T07:00:00.000Z";
  const stale = buildHistoricalValuationEvidence(staleFundamentals, fixtureDisclosures(), fixturePrices());
  assert.equal(stale.status, "partial");
  assert.equal(stale.priceSeriesFresh, false);
  assert.match(stale.missingReason ?? "", /截止日落后/);
});

test("A-share valuation history requests raw prices and records the exact upstream URL", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({
      rc: 0,
      data: {
        klines: [
          "2026-06-27,10,11,12,9,100",
          "2026-06-30,11,12,13,10,120"
        ]
      }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const receipt = await new AShareEastMoneyProvider().getValuationPriceHistory("600519.SH");
    assert.equal(receipt.status, "available");
    assert.equal(receipt.provider, "EASTMONEY");
    assert.equal(receipt.adjustment, "none");
    assert.equal(receipt.candles.length, 2);
    assert.equal(new URL(requestedUrl).searchParams.get("fqt"), "0");
    assert.equal(new URL(receipt.sourceUrl).searchParams.get("fqt"), "0");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("A-share valuation history fallback remains raw and records Tencent as the actual source", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response("preferred unavailable", { status: 503 });
    return new Response(JSON.stringify({
      code: 0,
      data: {
        sh600519: {
          day: [
            ["2026-06-27", "100", "101", "102", "99", "1000"],
            ["2026-06-30", "50", "51", "52", "49", "1200"]
          ]
        }
      }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const receipt = await new AShareEastMoneyProvider().getValuationPriceHistory("600519.SH");
    assert.equal(receipt.status, "available");
    assert.equal(receipt.provider, "TENCENT");
    assert.equal(receipt.adjustment, "none");
    assert.deepEqual(receipt.candles.map((candle) => candle.close), [101, 51]);
    assert.match(receipt.sourceUrl, /proxy\.finance\.qq\.com/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function fixtureFundamentals(): FundamentalEvidence {
  const quarterlyPeriods = [
    period("2025-12-31", 0.7, 8.2),
    period("2025-09-30", 0.6, 8),
    period("2025-06-30", 0.55, 7.8),
    period("2025-03-31", 0.5, 7.5),
    period("2024-12-31", 0.55, 7.2),
    period("2024-09-30", 0.5, 7),
    period("2024-06-30", 0.45, 6.8),
    period("2024-03-31", 0.4, 6.5),
    period("2023-12-31", 0.45, 6.2),
    period("2023-09-30", 0.4, 6),
    period("2023-06-30", 0.35, 5.8),
    period("2023-03-31", 0.3, 5.5)
  ];
  return {
    schemaVersion: "fundamental-evidence-v2",
    status: "partial",
    provider: "CNINFO",
    sourceUrl: "https://www.cninfo.com.cn/data20/financialData/getMainIndicators",
    fetchedAt: "2026-06-30T08:00:00.000Z",
    reportPeriod: "2025-12-31",
    annualPeriods: [
      period("2025-12-31", 2.35, 8.2, "annual"),
      period("2024-12-31", 1.9, 7.2, "annual"),
      period("2023-12-31", 1.5, 6.2, "annual")
    ],
    quarterlyPeriods,
    adjustedNetIncomeSources: [],
    valuation: {
      asOf: "2026-06-30T07:00:00.000Z",
      price: 23.5,
      epsTtm: 2.35,
      peTtm: 10,
      bookValuePerShare: 8.2,
      pb: 2.8659,
      historicalPercentile: null,
      historicalEvidence: null
    },
    metrics: {},
    missingFields: ["adjustedNetIncome", "valuationHistoricalPercentile", "peerValuation"],
    conflictingFields: [],
    failures: [],
    missingReason: "尚缺关键证据"
  };
}

function fixtureDisclosures(): DisclosureEvidence {
  const reports = [
    ["2023", "年度报告", "2024-03-25T08:00:00.000Z"],
    ["2024", "第一季度报告", "2024-04-25T08:00:00.000Z"],
    ["2024", "半年度报告", "2024-08-25T08:00:00.000Z"],
    ["2024", "第三季度报告", "2024-10-25T08:00:00.000Z"],
    ["2024", "年度报告", "2025-03-25T08:00:00.000Z"],
    ["2025", "第一季度报告", "2025-04-25T08:00:00.000Z"],
    ["2025", "半年度报告", "2025-08-25T08:00:00.000Z"],
    ["2025", "第三季度报告", "2025-10-25T08:00:00.000Z"],
    ["2025", "年度报告", "2026-03-25T08:00:00.000Z"]
  ];
  return {
    schemaVersion: "disclosure-evidence-v2",
    status: "checked",
    provider: "CNINFO",
    queryUrl: "https://www.cninfo.com.cn/new/hisAnnouncement/query",
    checkedAt: "2026-06-30T08:00:00.000Z",
    windowFrom: "2020-01-01",
    windowTo: "2026-06-30",
    latestPublishedAt: reports.at(-1)![2],
    totalCount: reports.length,
    criticalUnreadCount: 0,
    items: reports.map(([year, kind, publishedAt], index) => ({
      id: `report-${index}`,
      symbol: "600000.SH",
      companyName: "测试公司",
      title: `${year}年${kind}`,
      publishedAt,
      category: "periodic_report" as const,
      source: "CNINFO",
      sourceUrl: `https://static.cninfo.com.cn/finalpage/report-${index}.PDF`,
      contentStatus: "metadata_only" as const,
      contentHash: null,
      contentExcerpt: null,
      extractedCharacters: 0,
      extractionFailure: null,
      isCritical: false,
      isFundamentalSource: true,
      adjustedNetIncomeFact: null
    })),
    failures: []
  };
}

function fixturePrices(): ValuationPriceHistoryEvidence {
  return {
    schemaVersion: "valuation-price-history-v1",
    status: "available",
    provider: "EASTMONEY",
    sourceUrl: "http://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.600000&fqt=0",
    fetchedAt: "2026-06-30T08:00:00.000Z",
    adjustment: "none",
    candles: businessDayCandles("2024-01-02", "2026-06-30"),
    failure: null
  };
}

function businessDayCandles(from: string, to: string) {
  const output = [];
  let index = 0;
  for (let time = Date.parse(`${from}T07:00:00Z`); time <= Date.parse(`${to}T07:00:00Z`); time += 86_400_000) {
    const date = new Date(time);
    const day = date.getUTCDay();
    if (day === 0 || day === 6) continue;
    const close = 15 + (index % 200) * 0.05;
    output.push({
      symbol: "600000.SH",
      open: close - 0.1,
      high: close + 0.2,
      low: close - 0.2,
      close,
      volume: 1_000_000,
      timestamp: date.toISOString()
    });
    index += 1;
  }
  return output;
}

function period(periodEnd: string, eps: number, bookValuePerShare: number, periodType: "quarter" | "annual" = "quarter"): FinancialPeriodEvidence {
  return {
    periodEnd,
    periodType,
    currency: "CNY",
    unit: "CNY_10K",
    revenue: 100,
    parentNetIncome: 10,
    adjustedParentNetIncome: null,
    operatingCashFlow: 12,
    capitalExpenditure: 2,
    freeCashFlow: 10,
    eps,
    bookValuePerShare,
    roePct: 10,
    debtToAssetsPct: 30,
    grossMarginPct: 40,
    netMarginPct: 10,
    revenueGrowthPct: 5,
    netIncomeGrowthPct: 5
  };
}

function shanghaiDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}
