import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeAdjustedNetIncomeEvidence,
  parseAdjustedNetIncomeDisclosureFact,
  parsePeriodicReportPeriod
} from "@/lib/stock-data/adjustedNetIncomeEvidence";
import type {
  AdjustedNetIncomeDisclosureFact,
  DisclosureEvidence,
  DisclosureEvidenceItem,
  FinancialPeriodEvidence,
  FundamentalEvidence
} from "@/lib/stock-data/types";

test("CNINFO periodic table parser reads adjusted parent profit with period and unit", () => {
  const fact = parseAdjustedNetIncomeDisclosureFact({
    title: "贵州茅台2026年半年度报告",
    text: `贵州茅台酒股份有限公司2026 \t年半年度报告
      七、公司主要会计数据和财务指标
      (一) 主要会计数据
      单位：元 \t币种：人民币
      主要会计数据 本报告期（1－6月） 上年同期 本报告期比上年同期增减(%)
      归属于上市公司股东的净利润 \t44,516,880,421.86 \t45,402,962,298.10 \t-1.95
      归属于上市公司股东的扣除非经
      常性损益的净利润 44,464,207,646.01 \t45,390,247,623.82 \t-2.04`
  });

  assert.ok(fact);
  assert.equal(fact.periodEnd, "2026-06-30");
  assert.equal(fact.periodKind, "half_year");
  assert.equal(fact.sourceUnit, "CNY");
  assert.equal(fact.cumulativeValueCny10k, 4_446_420.7646);
  assert.equal(fact.priorComparableValueCny10k, 4_539_024.7624);
  assert.equal(fact.reportedParentNetIncomeCny10k, 4_451_688.0422);
});

test("adjusted profit parser refuses unknown units and mismatched report bodies", () => {
  const table = `某公司2026年半年度报告 主要会计数据
    归属于上市公司股东的净利润 100 90
    归属于上市公司股东的扣除非经常性损益的净利润 95 85`;

  assert.equal(parseAdjustedNetIncomeDisclosureFact({ title: "某公司2026年半年度报告", text: table }), null);
  assert.equal(parseAdjustedNetIncomeDisclosureFact({
    title: "某公司2026年半年度报告",
    text: `某公司2025年半年度报告 主要会计数据 单位：万元 币种：人民币
      归属于上市公司股东的净利润 100 90
      归属于上市公司股东的扣除非经常性损益的净利润 95 85`
  }), null);
  assert.equal(parsePeriodicReportPeriod("某公司2026年半年度报告摘要"), null);
});

test("third-quarter parser selects year-to-date instead of the standalone quarter column", () => {
  const fact = parseAdjustedNetIncomeDisclosureFact({
    title: "贵州茅台2025年第三季度报告",
    text: `贵州茅台酒股份有限公司2025年第三季度报告
      一、主要财务数据 （一）主要会计数据和财务指标
      单位：元 币种：人民币
      项目 本报告期 本报告期比上年同期增减(%) 年初至报告期末 年初至报告期末比上年同期增减(%)
      归属于上市公司股东的净利润 19,223,784,414.08 0.48 64,626,746,712.18 6.25
      归属于上市公司股东的扣除非经常性损益的净利润 19,290,368,807.38 0.95 64,680,616,431.20 6.42`
  });

  assert.ok(fact);
  assert.equal(fact.periodEnd, "2025-09-30");
  assert.equal(fact.cumulativeValueCny10k, 6_468_061.6431);
  assert.equal(fact.reportedParentNetIncomeCny10k, 6_462_674.6712);
  assert.equal(fact.priorComparableValueCny10k, null);
  assert.equal(fact.rawPriorComparableValue, null);
});

test("validated disclosure facts merge into standalone quarters and adjusted TTM", () => {
  const evidence = fundamentalFixture();
  const merged = mergeAdjustedNetIncomeEvidence(evidence, disclosureFixture([
    disclosure("2026-h1", "某公司2026年半年度报告", fact("2026-06-30", "half_year", 43, 44.5)),
    disclosure("2026-q1", "某公司2026年第一季度报告", fact("2026-03-31", "q1", 26, 27)),
    disclosure("2025-annual", "某公司2025年年度报告", fact("2025-12-31", "annual", 58, 60)),
    disclosure("2025-h1", "某公司2025年半年度报告", fact("2025-06-30", "half_year", 26, 27))
  ]));

  assert.equal(merged.annualPeriods[0].adjustedParentNetIncome, 58);
  assert.equal(merged.quarterlyPeriods.find((period) => period.periodEnd === "2026-03-31")?.adjustedParentNetIncome, 26);
  assert.equal(merged.quarterlyPeriods.find((period) => period.periodEnd === "2026-06-30")?.adjustedParentNetIncome, 17);
  assert.equal(merged.metrics.adjustedParentNetIncomeTtmCny10k, 75);
  assert.equal(merged.adjustedNetIncomeSources.length, 4);
  assert.ok(merged.missingFields.includes("adjustedNetIncome"));
  assert.ok(merged.missingFields.includes("fiveAnnualAdjustedNetIncomePeriods"));
});

test("parent-profit cross-check rejects a parsed value with shifted columns or wrong units", () => {
  const merged = mergeAdjustedNetIncomeEvidence(fundamentalFixture(), disclosureFixture([
    disclosure("bad-h1", "某公司2026年半年度报告", fact("2026-06-30", "half_year", 43, 4_450))
  ]));

  assert.equal(merged.adjustedNetIncomeSources.length, 0);
  assert.equal(merged.metrics.adjustedParentNetIncomeTtmCny10k, null);
  assert.ok(merged.conflictingFields.includes("adjustedNetIncomeParentCrossCheck:2026-06-30"));
  assert.ok(merged.missingFields.includes("adjustedNetIncome"));
});

function fundamentalFixture(): FundamentalEvidence {
  return {
    schemaVersion: "fundamental-evidence-v2",
    status: "partial",
    provider: "CNINFO",
    sourceUrl: "https://www.cninfo.com.cn/",
    fetchedAt: "2026-08-25T00:00:00.000Z",
    reportPeriod: "2026-06-30",
    annualPeriods: [period("2025-12-31", "annual", 60), period("2024-12-31", "annual", 55)],
    quarterlyPeriods: [
      period("2026-06-30", "quarter", 17.5),
      period("2026-03-31", "quarter", 27),
      period("2025-12-31", "quarter", 15),
      period("2025-09-30", "quarter", 18),
      period("2025-06-30", "quarter", 15),
      period("2025-03-31", "quarter", 12)
    ],
    adjustedNetIncomeSources: [],
    valuation: {
      asOf: "2026-08-25T00:00:00.000Z",
      price: 100,
      epsTtm: 10,
      peTtm: 10,
      bookValuePerShare: 20,
      pb: 5,
      historicalPercentile: null
    },
    metrics: {},
    missingFields: ["adjustedNetIncome", "valuationHistoricalPercentile", "peerValuation"],
    conflictingFields: [],
    failures: [],
    missingReason: "尚缺长期证据"
  };
}

function disclosureFixture(items: DisclosureEvidenceItem[]): DisclosureEvidence {
  return {
    schemaVersion: "disclosure-evidence-v2",
    status: "checked",
    provider: "CNINFO",
    queryUrl: "https://www.cninfo.com.cn/new/hisAnnouncement/query",
    checkedAt: "2026-08-25T00:00:00.000Z",
    windowFrom: "2020-01-01",
    windowTo: "2026-08-25",
    latestPublishedAt: items[0]?.publishedAt ?? null,
    totalCount: items.length,
    criticalUnreadCount: 0,
    items,
    failures: []
  };
}

function disclosure(id: string, title: string, adjustedNetIncomeFact: AdjustedNetIncomeDisclosureFact): DisclosureEvidenceItem {
  return {
    id,
    symbol: "600000.SH",
    companyName: "某公司",
    title,
    publishedAt: `${adjustedNetIncomeFact.periodEnd.slice(0, 4)}-08-20T00:00:00.000Z`,
    category: "periodic_report",
    source: "CNINFO",
    sourceUrl: `https://static.cninfo.com.cn/finalpage/2026-08-20/${id}.PDF`,
    contentStatus: "extracted",
    contentHash: `${id}-hash`,
    contentExcerpt: "法定报告原文片段",
    extractedCharacters: 1_000,
    extractionFailure: null,
    isCritical: false,
    isFundamentalSource: true,
    adjustedNetIncomeFact
  };
}

function fact(
  periodEnd: string,
  periodKind: AdjustedNetIncomeDisclosureFact["periodKind"],
  cumulativeValueCny10k: number,
  reportedParentNetIncomeCny10k: number
): AdjustedNetIncomeDisclosureFact {
  return {
    schemaVersion: "adjusted-net-income-fact-v1",
    parserVersion: "cninfo-periodic-table-v1",
    periodEnd,
    periodKind,
    currency: "CNY",
    sourceUnit: "CNY_10K",
    cumulativeValueCny10k,
    priorComparableValueCny10k: cumulativeValueCny10k - 1,
    reportedParentNetIncomeCny10k,
    rawCurrentValue: String(cumulativeValueCny10k),
    rawPriorComparableValue: String(cumulativeValueCny10k - 1)
  };
}

function period(periodEnd: string, periodType: FinancialPeriodEvidence["periodType"], parentNetIncome: number): FinancialPeriodEvidence {
  return {
    periodEnd,
    periodType,
    currency: "CNY",
    unit: "CNY_10K",
    revenue: parentNetIncome * 10,
    parentNetIncome,
    adjustedParentNetIncome: null,
    operatingCashFlow: parentNetIncome * 2,
    capitalExpenditure: parentNetIncome * 0.2,
    freeCashFlow: parentNetIncome * 1.8,
    eps: 1,
    bookValuePerShare: 10,
    roePct: 10,
    debtToAssetsPct: 40,
    grossMarginPct: 30,
    netMarginPct: 10,
    revenueGrowthPct: 5,
    netIncomeGrowthPct: 5
  };
}
