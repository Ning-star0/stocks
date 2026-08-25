import type {
  AdjustedNetIncomeDisclosureFact,
  AdjustedNetIncomeSource,
  DisclosureEvidence,
  FundamentalEvidence
} from "@/lib/stock-data/types";

const PARSER_VERSION = "cninfo-periodic-table-v1" as const;
const NUMBER_PATTERN = "[−－—-]?\\s*\\d[\\d,]*(?:\\.\\d+)?";
const ADJUSTED_LABELS = [
  "归属于上市公司股东的扣除非经常性损益的净利润",
  "归属于母公司所有者的扣除非经常性损益的净利润"
];
const PARENT_LABELS = [
  "归属于上市公司股东的净利润",
  "归属于母公司所有者的净利润"
];

export function parseAdjustedNetIncomeDisclosureFact(input: {
  title: string;
  text: string;
}): AdjustedNetIncomeDisclosureFact | null {
  const period = parsePeriodicReportPeriod(input.title);
  if (!period || /摘要|英文版|取消/.test(input.title)) return null;

  const text = normalizeForTableMatching(input.text);
  if (!reportBodyMatchesPeriod(text, period)) return null;
  const adjusted = findMetricValues(text, ADJUSTED_LABELS, period.periodKind);
  const parent = findMetricValues(text, PARENT_LABELS, period.periodKind);
  if (!adjusted || !parent) return null;

  const contextStart = Math.max(0, Math.min(adjusted.index, parent.index) - 2_500);
  const context = text.slice(contextStart, Math.max(adjusted.index, parent.index));
  if (!new RegExp(looseChineseLabel("主要会计数据")).test(context)) return null;
  const unit = findLastCurrencyUnit(context);
  if (!unit) return null;

  const cumulativeValueCny10k = convertToCny10k(adjusted.current, unit.factor);
  const priorComparableValueCny10k = adjusted.prior === null ? null : convertToCny10k(adjusted.prior, unit.factor);
  const reportedParentNetIncomeCny10k = convertToCny10k(parent.current, unit.factor);
  if (cumulativeValueCny10k === null || reportedParentNetIncomeCny10k === null) return null;

  return {
    schemaVersion: "adjusted-net-income-fact-v1",
    parserVersion: PARSER_VERSION,
    periodEnd: period.periodEnd,
    periodKind: period.periodKind,
    currency: "CNY",
    sourceUnit: unit.sourceUnit,
    cumulativeValueCny10k,
    priorComparableValueCny10k,
    reportedParentNetIncomeCny10k,
    rawCurrentValue: adjusted.current,
    rawPriorComparableValue: adjusted.prior
  };
}

export function mergeAdjustedNetIncomeEvidence(
  evidence: FundamentalEvidence,
  disclosures: DisclosureEvidence
): FundamentalEvidence {
  const grouped = new Map<string, Array<{ item: DisclosureEvidence["items"][number]; fact: AdjustedNetIncomeDisclosureFact }>>();
  for (const item of disclosures.items) {
    if (!item.adjustedNetIncomeFact || !item.contentHash) continue;
    const rows = grouped.get(item.adjustedNetIncomeFact.periodEnd) ?? [];
    rows.push({ item, fact: item.adjustedNetIncomeFact });
    grouped.set(item.adjustedNetIncomeFact.periodEnd, rows);
  }

  const acceptedSources: AdjustedNetIncomeSource[] = [];
  const newConflicts: string[] = [];
  for (const [periodEnd, candidates] of grouped) {
    const ordered = candidates.sort((a, b) => b.item.publishedAt.localeCompare(a.item.publishedAt));
    const selected = ordered[0];
    const conflictingRevision = ordered.slice(1).some(({ fact }) => !approximatelyEqual(
      fact.cumulativeValueCny10k,
      selected.fact.cumulativeValueCny10k
    ));
    if (conflictingRevision && !/修订|更正|更新/.test(selected.item.title)) {
      newConflicts.push(`adjustedNetIncomeDuplicate:${periodEnd}`);
      continue;
    }

    const expectedParentNetIncome = expectedCumulativeParentNetIncome(evidence, periodEnd);
    if (expectedParentNetIncome === null || !approximatelyEqual(selected.fact.reportedParentNetIncomeCny10k, expectedParentNetIncome)) {
      newConflicts.push(`adjustedNetIncomeParentCrossCheck:${periodEnd}`);
      continue;
    }

    acceptedSources.push({
      ...selected.fact,
      sourceDisclosureId: selected.item.id,
      sourceTitle: selected.item.title,
      sourceUrl: selected.item.sourceUrl,
      publishedAt: selected.item.publishedAt,
      contentHash: selected.item.contentHash!
    });
  }

  acceptedSources.sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || b.publishedAt.localeCompare(a.publishedAt));
  const cumulative = new Map(acceptedSources.map((source) => [source.periodEnd, source.cumulativeValueCny10k]));
  const annualPeriods = evidence.annualPeriods.map((period) => ({
    ...period,
    adjustedParentNetIncome: cumulative.get(period.periodEnd) ?? null
  }));
  const quarterlyPeriods = evidence.quarterlyPeriods.map((period) => ({
    ...period,
    adjustedParentNetIncome: standaloneAdjustedNetIncome(cumulative, period.periodEnd)
  }));
  const adjustedAnnualPeriodCount = annualPeriods.filter((period) => period.adjustedParentNetIncome !== null).length;
  const adjustedStandaloneQuarterCount = quarterlyPeriods.filter((period) => period.adjustedParentNetIncome !== null).length;
  const adjustedParentNetIncomeTtm = calculateAdjustedTtm(cumulative, evidence.reportPeriod);
  const missingFields = evidence.missingFields.filter((field) => ![
    "adjustedNetIncome",
    "adjustedNetIncomeTtm",
    "fiveAnnualAdjustedNetIncomePeriods",
    "eightStandaloneAdjustedNetIncomeQuarters"
  ].includes(field));
  if (adjustedAnnualPeriodCount < 5 || adjustedStandaloneQuarterCount < 8) missingFields.push("adjustedNetIncome");
  if (adjustedParentNetIncomeTtm === null) missingFields.push("adjustedNetIncomeTtm");
  if (adjustedAnnualPeriodCount < 5) missingFields.push("fiveAnnualAdjustedNetIncomePeriods");
  if (adjustedStandaloneQuarterCount < 8) missingFields.push("eightStandaloneAdjustedNetIncomeQuarters");
  const uniqueMissingFields = uniqueStrings(missingFields);
  const conflictingFields = uniqueStrings([...evidence.conflictingFields, ...newConflicts]);

  return {
    ...evidence,
    schemaVersion: "fundamental-evidence-v2",
    status: evidence.status === "unavailable" ? "unavailable" : uniqueMissingFields.length || conflictingFields.length ? "partial" : "available",
    annualPeriods,
    quarterlyPeriods,
    adjustedNetIncomeSources: acceptedSources,
    metrics: {
      ...evidence.metrics,
      latestAnnualAdjustedParentNetIncomeCny10k: annualPeriods[0]?.adjustedParentNetIncome ?? null,
      latestQuarterAdjustedParentNetIncomeCny10k: quarterlyPeriods[0]?.adjustedParentNetIncome ?? null,
      adjustedParentNetIncomeTtmCny10k: adjustedParentNetIncomeTtm,
      adjustedAnnualPeriodCount,
      adjustedStandaloneQuarterCount
    },
    missingFields: uniqueMissingFields,
    conflictingFields,
    missingReason: uniqueMissingFields.length ? `尚缺：${uniqueMissingFields.join("、")}` : null
  };
}

export function parsePeriodicReportPeriod(title: string) {
  if (/摘要|英文版|取消/.test(title)) return null;
  const yearMatch = title.match(/(20\d{2})\s*年/);
  if (!yearMatch) return null;
  const year = Number(yearMatch[1]);
  if (/第?一季度/.test(title)) return { periodEnd: `${year}-03-31`, periodKind: "q1" as const };
  if (/半年度/.test(title)) return { periodEnd: `${year}-06-30`, periodKind: "half_year" as const };
  if (/第?三季度/.test(title)) return { periodEnd: `${year}-09-30`, periodKind: "q3" as const };
  if (/年度报告/.test(title)) return { periodEnd: `${year}-12-31`, periodKind: "annual" as const };
  return null;
}

function findMetricValues(
  text: string,
  labels: string[],
  periodKind: AdjustedNetIncomeDisclosureFact["periodKind"]
) {
  for (const label of labels) {
    const pattern = new RegExp(looseChineseLabel(label));
    const match = pattern.exec(text);
    if (!match) continue;
    const following = text.slice(match.index + match[0].length, match.index + match[0].length + 320);
    const numbers = [...following.matchAll(new RegExp(NUMBER_PATTERN, "g"))].map((item) => item[0]);
    if (periodKind === "q3") {
      if (numbers.length >= 3) return { index: match.index, current: numbers[2], prior: null };
    } else if (numbers.length >= 2) {
      return { index: match.index, current: numbers[0], prior: numbers[1] };
    }
  }
  return null;
}

function findLastCurrencyUnit(context: string): { sourceUnit: AdjustedNetIncomeDisclosureFact["sourceUnit"]; factor: number } | null {
  const pattern = /单位\s*[:：]\s*(百万元|万元|千元|元)\s*币种\s*[:：]\s*人民币/g;
  const matches = [...context.matchAll(pattern)];
  const unit = matches.at(-1)?.[1];
  if (unit === "元") return { sourceUnit: "CNY", factor: 0.0001 };
  if (unit === "千元") return { sourceUnit: "CNY_1K", factor: 0.1 };
  if (unit === "万元") return { sourceUnit: "CNY_10K", factor: 1 };
  if (unit === "百万元") return { sourceUnit: "CNY_1M", factor: 100 };
  return null;
}

function reportBodyMatchesPeriod(text: string, period: NonNullable<ReturnType<typeof parsePeriodicReportPeriod>>) {
  const keyword = period.periodKind === "q1"
    ? "第一季度报告"
    : period.periodKind === "half_year"
      ? "半年度报告"
      : period.periodKind === "q3"
        ? "第三季度报告"
        : "年度报告";
  const year = period.periodEnd.slice(0, 4);
  return new RegExp(`${year}\\s*年\\s*${looseChineseLabel(keyword)}`).test(text.slice(0, 8_000));
}

function expectedCumulativeParentNetIncome(evidence: FundamentalEvidence, periodEnd: string) {
  if (periodEnd.endsWith("12-31")) {
    return evidence.annualPeriods.find((period) => period.periodEnd === periodEnd)?.parentNetIncome ?? null;
  }
  const year = periodEnd.slice(0, 4);
  const requiredSuffixes = periodEnd.endsWith("03-31")
    ? ["03-31"]
    : periodEnd.endsWith("06-30")
      ? ["03-31", "06-30"]
      : periodEnd.endsWith("09-30")
        ? ["03-31", "06-30", "09-30"]
        : [];
  const values = requiredSuffixes.map((suffix) => evidence.quarterlyPeriods.find((period) => period.periodEnd === `${year}-${suffix}`)?.parentNetIncome ?? null);
  if (!values.length || values.some((value) => value === null)) return null;
  return round(values.reduce<number>((sum, value) => sum + (value ?? 0), 0));
}

function standaloneAdjustedNetIncome(cumulative: Map<string, number>, periodEnd: string) {
  const current = cumulative.get(periodEnd);
  if (current === undefined) return null;
  if (periodEnd.endsWith("03-31")) return current;
  const year = periodEnd.slice(0, 4);
  const previousPeriod = periodEnd.endsWith("06-30")
    ? `${year}-03-31`
    : periodEnd.endsWith("09-30")
      ? `${year}-06-30`
      : periodEnd.endsWith("12-31")
        ? `${year}-09-30`
        : null;
  if (!previousPeriod) return null;
  const previous = cumulative.get(previousPeriod);
  return previous === undefined ? null : round(current - previous);
}

function calculateAdjustedTtm(cumulative: Map<string, number>, latestPeriod: string | null) {
  if (!latestPeriod) return null;
  const latest = cumulative.get(latestPeriod);
  if (latest === undefined) return null;
  if (latestPeriod.endsWith("12-31")) return latest;
  const year = Number(latestPeriod.slice(0, 4));
  const suffix = latestPeriod.slice(4);
  const previousAnnual = cumulative.get(`${year - 1}-12-31`);
  const previousComparable = cumulative.get(`${year - 1}${suffix}`);
  if (previousAnnual === undefined || previousComparable === undefined) return null;
  return round(latest + previousAnnual - previousComparable);
}

function approximatelyEqual(left: number, right: number) {
  return Math.abs(left - right) <= Math.max(1, Math.abs(right) * 0.0001);
}

function convertToCny10k(rawValue: string, factor: number) {
  const number = Number(rawValue.replace(/[\s,]/g, "").replace(/[−－—]/g, "-"));
  return Number.isFinite(number) ? round(number * factor) : null;
}

function normalizeForTableMatching(value: string) {
  return value.replace(/\u0000/g, "").replace(/[\t\f\v\r\n ]+/g, " ").trim();
}

function looseChineseLabel(value: string) {
  return [...value].map(escapeRegExp).join("\\s*");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function round(value: number, digits = 4) {
  return Number(value.toFixed(digits));
}
