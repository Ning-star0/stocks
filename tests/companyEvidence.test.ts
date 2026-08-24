import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCninfoFundamentalEvidence,
  classifyCninfoDisclosureTitle,
  isCriticalCninfoDisclosure
} from "@/lib/stock-data/cninfoEvidence";

test("CNINFO cumulative statements are converted into standalone quarters with explicit units", () => {
  const evidence = buildCninfoFundamentalEvidence({
    symbol: "600000.SH",
    fetchedAt: "2026-08-25T01:00:00.000Z",
    sourceUrl: "https://www.cninfo.com.cn/",
    price: 23,
    priceAsOf: "2026-08-24T07:00:00.000Z",
    mainRecord: {
      one: indicatorRows("03-31", { 2026: [0.5, 11.2], 2025: [0.4, 10.2] }),
      middle: indicatorRows("06-30", { 2026: [1.2, 11.4], 2025: [1, 10.5] }),
      three: indicatorRows("09-30", { 2026: [1.8, 11.5], 2025: [1.5, 10.8], 2024: [1.2, 9.8] }),
      year: [
        indicator("2025-12-31", 2, 11),
        indicator("2024-12-31", 1.7, 10),
        indicator("2023-12-31", 1.5, 9),
        indicator("2022-12-31", 1.3, 8),
        indicator("2021-12-31", 1.1, 7)
      ]
    },
    incomeRecord: financialRecord(
      { 2026: 40, 2025: 36 },
      { 2026: 90, 2025: 80 },
      { 2026: 150, 2025: 132, 2024: 145 },
      { 2025: 220, 2024: 200, 2023: 180, 2022: 160, 2021: 140 },
      "营业收入",
      0.1
    ),
    cashFlowRecord: withSecondaryMetric(financialRecord(
      { 2026: 8, 2025: 7 },
      { 2026: 20, 2025: 18 },
      { 2026: 35, 2025: 31, 2024: 33 },
      { 2025: 52, 2024: 46, 2023: 40, 2022: 36, 2021: 30 },
      "经营活动产生的现金流量净额"
    ), "购建固定资产、无形资产和其他长期资产支付的现金", 0.25)
  });

  assert.equal(evidence.reportPeriod, "2026-09-30");
  assert.equal(evidence.annualPeriods.length, 5);
  assert.equal(evidence.quarterlyPeriods.length, 8);
  assert.equal(evidence.quarterlyPeriods[0].periodEnd, "2026-09-30");
  assert.equal(evidence.quarterlyPeriods[0].revenue, 60);
  assert.equal(evidence.quarterlyPeriods[0].parentNetIncome, 6);
  assert.equal(evidence.quarterlyPeriods[0].operatingCashFlow, 15);
  assert.equal(evidence.quarterlyPeriods[0].capitalExpenditure, 3.75);
  assert.equal(evidence.quarterlyPeriods[0].freeCashFlow, 11.25);
  assert.equal(evidence.quarterlyPeriods[0].eps, 0.6);
  assert.equal(evidence.quarterlyPeriods[1].revenue, 50);
  assert.equal(evidence.quarterlyPeriods[1].eps, 0.7);
  assert.equal(evidence.quarterlyPeriods[2].revenue, 40);
  assert.equal(evidence.quarterlyPeriods[2].eps, 0.5);
  assert.equal(evidence.quarterlyPeriods[0].unit, "CNY_10K");
  assert.equal(evidence.valuation.epsTtm, 2.3);
  assert.equal(evidence.valuation.peTtm, 10);
  assert.equal(evidence.valuation.pb, 2);
  assert.equal(evidence.annualPeriods[0].freeCashFlow, 39);
  assert.equal(evidence.metrics.freeCashFlowTtmCny10k, 42);
  assert.equal(evidence.missingFields.includes("freeCashFlow"), false);
});

test("critical statutory disclosure categories are deterministic", () => {
  assert.equal(classifyCninfoDisclosureTitle("2026年半年度报告"), "periodic_report");
  assert.equal(classifyCninfoDisclosureTitle("关于收到监管警示函的公告"), "regulatory");
  assert.equal(classifyCninfoDisclosureTitle("股票交易异常波动风险提示公告"), "risk_notice");
  assert.equal(classifyCninfoDisclosureTitle("公司章程（修订稿）"), "other");
  assert.equal(isCriticalCninfoDisclosure("earnings", "关于召开半年度业绩说明会的公告"), false);
  assert.equal(isCriticalCninfoDisclosure("periodic_report", "2026年半年度报告摘要"), false);
  assert.equal(isCriticalCninfoDisclosure("periodic_report", "2026年半年度报告"), true);
});

function indicatorRows(suffix: string, values: Record<number, [number, number]>) {
  return Object.entries(values).map(([year, [eps, bookValue]]) => indicator(`${year}-${suffix}`, eps, bookValue));
}

function indicator(periodEnd: string, eps: number, bookValuePerShare: number) {
  return {
    ENDDATE: periodEnd,
    F004N: eps,
    F008N: bookValuePerShare,
    F067N: 12,
    F041N: 42,
    F078N: 35,
    F017N: 10,
    F052N: 8,
    F053N: 9
  };
}

function financialRecord(
  one: Record<number, number>,
  middle: Record<number, number>,
  three: Record<number, number>,
  year: Record<number, number>,
  primaryLabel: string,
  parentNetIncomeRatio?: number
) {
  const bucket = (values: Record<number, number>) => {
    const rows: Array<Record<string, unknown>> = [{ index: primaryLabel, ...values }];
    if (parentNetIncomeRatio !== undefined) {
      rows.push({
        index: "归属于上市公司股东的净利润",
        ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value * parentNetIncomeRatio]))
      });
    }
    return rows;
  };
  return { one: bucket(one), middle: bucket(middle), three: bucket(three), year: bucket(year) };
}

function withSecondaryMetric<T extends Record<"one" | "middle" | "three" | "year", Array<Record<string, unknown>>>>(
  record: T,
  label: string,
  ratio: number
) {
  for (const rows of [record.one, record.middle, record.three, record.year]) {
    const primary = rows[0];
    rows.push({
      index: label,
      ...Object.fromEntries(Object.entries(primary).filter(([key]) => /^\d{4}$/.test(key)).map(([key, value]) => [key, Number(value) * ratio]))
    });
  }
  return record;
}
