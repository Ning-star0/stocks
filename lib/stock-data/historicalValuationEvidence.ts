import { createHash } from "node:crypto";

import { parsePeriodicReportPeriod } from "@/lib/stock-data/adjustedNetIncomeEvidence";
import type {
  DisclosureEvidence,
  FinancialPeriodEvidence,
  FundamentalEvidence,
  HistoricalValuationEvidence,
  HistoricalValuationReportSource,
  ValuationPriceHistoryEvidence
} from "@/lib/stock-data/types";

const MINIMUM_TRADING_DAYS = 252;
const MINIMUM_REPORT_SOURCES = 4;
const MINIMUM_WINDOW_DAYS = 365;
const MAX_PE = 10_000;
const MAX_PB = 1_000;

export function mergeHistoricalValuationEvidence(
  fundamentals: FundamentalEvidence,
  disclosures: DisclosureEvidence,
  priceHistory: ValuationPriceHistoryEvidence
): FundamentalEvidence {
  const historicalEvidence = buildHistoricalValuationEvidence(fundamentals, disclosures, priceHistory);
  const missingFields = fundamentals.missingFields.filter((field) => field !== "valuationHistoricalPercentile");
  if (historicalEvidence.status !== "available") missingFields.push("valuationHistoricalPercentile");
  const uniqueMissingFields = uniqueStrings(missingFields);
  const failures = uniqueStrings([
    ...fundamentals.failures,
    ...(priceHistory.failure ? [`历史估值价格序列：${priceHistory.failure}`] : [])
  ]);
  return {
    ...fundamentals,
    status: fundamentals.status === "unavailable"
      ? "unavailable"
      : uniqueMissingFields.length || fundamentals.conflictingFields.length
        ? "partial"
        : "available",
    valuation: {
      ...fundamentals.valuation,
      historicalPercentile: historicalEvidence.compositePercentile,
      historicalEvidence
    },
    metrics: {
      ...fundamentals.metrics,
      historicalValuationPercentile: historicalEvidence.compositePercentile,
      historicalPePercentile: historicalEvidence.pePercentile,
      historicalPbPercentile: historicalEvidence.pbPercentile,
      historicalPeSampleSize: historicalEvidence.peSampleSize,
      historicalPbSampleSize: historicalEvidence.pbSampleSize,
      historicalValuationReportSourceCount: historicalEvidence.reportSourceCount
    },
    missingFields: uniqueMissingFields,
    failures,
    missingReason: uniqueMissingFields.length ? `尚缺：${uniqueMissingFields.join("、")}` : null
  };
}

export function buildHistoricalValuationEvidence(
  fundamentals: FundamentalEvidence,
  disclosures: DisclosureEvidence,
  priceHistory: ValuationPriceHistoryEvidence
): HistoricalValuationEvidence {
  const base = emptyHistoricalEvidence(priceHistory);
  if (fundamentals.status === "unavailable") {
    return { ...base, missingReason: "基本面数据不可用，无法构造历史估值。" };
  }
  if (priceHistory.status !== "available" || !priceHistory.candles.length) {
    return { ...base, missingReason: priceHistory.failure ?? "未取得未复权历史价格。" };
  }

  const asOfDate = fundamentals.valuation.asOf ? shanghaiDateKey(fundamentals.valuation.asOf) : null;
  const asOfSessionCompleted = fundamentals.valuation.asOf ? shanghaiSessionCompleted(fundamentals.valuation.asOf) : false;
  const candles = priceHistory.candles
    .filter((candle) => Number.isFinite(candle.close) && candle.close > 0)
    .map((candle) => ({ date: shanghaiDateKey(candle.timestamp), close: candle.close }))
    .filter((candle) => !asOfDate || candle.date < asOfDate || (candle.date === asOfDate && asOfSessionCompleted))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!candles.length) return { ...base, missingReason: "未复权价格序列在估值截止日前没有有效交易日。" };

  const reportSources = buildReportSources(fundamentals, disclosures, candles.map((candle) => candle.date));
  if (!reportSources.length) {
    return {
      ...base,
      asOf: fundamentals.valuation.asOf,
      windowStart: candles[0].date,
      windowEnd: candles.at(-1)!.date,
      priceSeriesHash: priceSeriesHash(candles),
      missingReason: "未找到能与财务期匹配的正式报告发布日期，禁止用报告期末日期代替披露日。"
    };
  }

  const peSamples: number[] = [];
  const pbSamples: number[] = [];
  const usedReportIds = new Set<string>();
  let sourceIndex = -1;
  for (const candle of candles) {
    while (sourceIndex + 1 < reportSources.length && reportSources[sourceIndex + 1].effectiveFrom <= candle.date) {
      sourceIndex += 1;
    }
    if (sourceIndex < 0) continue;
    const source = reportSources[sourceIndex];
    const pe = positiveRatio(candle.close, source.epsTtm, MAX_PE);
    const pb = positiveRatio(candle.close, source.bookValuePerShare, MAX_PB);
    if (pe !== null) peSamples.push(pe);
    if (pb !== null) pbSamples.push(pb);
    if (pe !== null || pb !== null) usedReportIds.add(source.disclosureId);
  }

  const windowStart = candles[0].date;
  const windowEnd = candles.at(-1)!.date;
  const priceStalenessDays = asOfDate ? daysBetween(windowEnd, asOfDate) : null;
  const priceSeriesFresh = priceStalenessDays !== null && priceStalenessDays >= 0 && priceStalenessDays <= 7;
  const enoughWindow = daysBetween(windowStart, windowEnd) >= MINIMUM_WINDOW_DAYS;
  const enoughReports = usedReportIds.size >= MINIMUM_REPORT_SOURCES;
  const peQualified = priceSeriesFresh && enoughWindow && enoughReports && peSamples.length >= MINIMUM_TRADING_DAYS;
  const pbQualified = priceSeriesFresh && enoughWindow && enoughReports && pbSamples.length >= MINIMUM_TRADING_DAYS;
  const pePercentile = peQualified
    ? percentileRank(peSamples, fundamentals.valuation.peTtm)
    : null;
  const pbPercentile = pbQualified
    ? percentileRank(pbSamples, fundamentals.valuation.pb)
    : null;
  const availablePercentiles = [pePercentile, pbPercentile].filter((value): value is number => value !== null);
  const compositePercentile = availablePercentiles.length
    ? round(availablePercentiles.reduce((sum, value) => sum + value, 0) / availablePercentiles.length, 2)
    : null;
  const status = compositePercentile !== null
    ? "available"
    : peSamples.length || pbSamples.length
      ? "partial"
      : "unavailable";
  const missingReason = status === "available"
    ? null
    : historicalMissingReason({
        enoughWindow,
        priceSeriesFresh,
        priceStalenessDays,
        reportCount: usedReportIds.size,
        peSampleSize: peSamples.length,
        pbSampleSize: pbSamples.length,
        currentPe: fundamentals.valuation.peTtm,
        currentPb: fundamentals.valuation.pb
      });

  return {
    schemaVersion: "historical-valuation-v1",
    algorithmVersion: "publication-gated-current-series-v1",
    status,
    asOf: fundamentals.valuation.asOf,
    windowStart,
    windowEnd,
    priceProvider: priceHistory.provider,
    priceSourceUrl: priceHistory.sourceUrl,
    priceAdjustment: "none",
    priceSeriesHash: priceSeriesHash(candles),
    priceSeriesFresh,
    priceStalenessDays,
    reportSourceCount: usedReportIds.size,
    minimumTradingDays: MINIMUM_TRADING_DAYS,
    peSampleSize: peSamples.length,
    pbSampleSize: pbSamples.length,
    pePercentile,
    pbPercentile,
    compositePercentile,
    reportSources,
    missingReason
  };
}

function buildReportSources(
  fundamentals: FundamentalEvidence,
  disclosures: DisclosureEvidence,
  tradingDates: string[]
) {
  const reportsByPeriod = new Map<string, DisclosureEvidence["items"][number]>();
  for (const item of disclosures.items) {
    if (!item.isFundamentalSource || item.category !== "periodic_report") continue;
    const period = parsePeriodicReportPeriod(item.title);
    if (!period) continue;
    const previous = reportsByPeriod.get(period.periodEnd);
    // 结构化财务接口反映当前修订口径；存在修订时只允许在最后一版报告发布后使用，
    // 不能把修订后的数字回填到更早交易日。
    if (!previous || item.publishedAt > previous.publishedAt) reportsByPeriod.set(period.periodEnd, item);
  }

  const annualByEnd = new Map(fundamentals.annualPeriods.map((period) => [period.periodEnd, period]));
  const quarterlyByEnd = new Map(fundamentals.quarterlyPeriods.map((period) => [period.periodEnd, period]));
  const output: HistoricalValuationReportSource[] = [];
  for (const [periodEnd, item] of reportsByPeriod) {
    const publishedDate = shanghaiDateKey(item.publishedAt);
    const effectiveFrom = tradingDates.find((date) => date > publishedDate);
    if (!effectiveFrom) continue;
    const period = periodEnd.endsWith("12-31") ? annualByEnd.get(periodEnd) : quarterlyByEnd.get(periodEnd);
    const epsTtm = periodEnd.endsWith("12-31")
      ? positiveNumber(annualByEnd.get(periodEnd)?.eps)
      : trailingFourQuarterEps(fundamentals.quarterlyPeriods, periodEnd);
    const bookValuePerShare = positiveNumber(period?.bookValuePerShare);
    if (epsTtm === null && bookValuePerShare === null) continue;
    output.push({
      periodEnd,
      publishedAt: item.publishedAt,
      effectiveFrom,
      epsTtm,
      bookValuePerShare,
      disclosureId: item.id,
      title: item.title,
      url: item.sourceUrl
    });
  }
  return output.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.periodEnd.localeCompare(b.periodEnd));
}

function trailingFourQuarterEps(periods: FinancialPeriodEvidence[], periodEnd: string) {
  const ordered = periods
    .filter((period) => period.periodEnd <= periodEnd)
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))
    .slice(0, 4);
  if (ordered.length !== 4 || ordered.some((period) => positiveNumber(period.eps) === null)) return null;
  const indexes = ordered.map((period) => quarterIndex(period.periodEnd));
  if (indexes.some((value) => value === null)) return null;
  for (let index = 1; index < indexes.length; index += 1) {
    if (indexes[index - 1]! - indexes[index]! !== 1) return null;
  }
  return round(ordered.reduce((sum, period) => sum + (period.eps ?? 0), 0));
}

function quarterIndex(periodEnd: string) {
  const year = Number(periodEnd.slice(0, 4));
  const suffix = periodEnd.slice(5);
  const quarter = suffix === "03-31" ? 1 : suffix === "06-30" ? 2 : suffix === "09-30" ? 3 : suffix === "12-31" ? 4 : null;
  return Number.isInteger(year) && quarter ? year * 4 + quarter : null;
}

function percentileRank(samples: number[], current: number | null) {
  if (current === null || !Number.isFinite(current) || current <= 0) return null;
  let less = 0;
  let equal = 0;
  for (const sample of samples) {
    if (sample < current) less += 1;
    else if (Math.abs(sample - current) <= Math.max(1e-8, Math.abs(current) * 1e-8)) equal += 1;
  }
  return round(((less + equal * 0.5) / samples.length) * 100, 2);
}

function emptyHistoricalEvidence(priceHistory: ValuationPriceHistoryEvidence): HistoricalValuationEvidence {
  return {
    schemaVersion: "historical-valuation-v1",
    algorithmVersion: "publication-gated-current-series-v1",
    status: "unavailable",
    asOf: null,
    windowStart: null,
    windowEnd: null,
    priceProvider: priceHistory.provider,
    priceSourceUrl: priceHistory.sourceUrl,
    priceAdjustment: "none",
    priceSeriesHash: null,
    priceSeriesFresh: false,
    priceStalenessDays: null,
    reportSourceCount: 0,
    minimumTradingDays: MINIMUM_TRADING_DAYS,
    peSampleSize: 0,
    pbSampleSize: 0,
    pePercentile: null,
    pbPercentile: null,
    compositePercentile: null,
    reportSources: [],
    missingReason: null
  };
}

function historicalMissingReason(input: {
  enoughWindow: boolean;
  priceSeriesFresh: boolean;
  priceStalenessDays: number | null;
  reportCount: number;
  peSampleSize: number;
  pbSampleSize: number;
  currentPe: number | null;
  currentPb: number | null;
}) {
  const reasons = [
    ...(!input.priceSeriesFresh ? [`未复权价格截止日落后估值截止日 ${input.priceStalenessDays ?? "未知"} 天`] : []),
    ...(!input.enoughWindow ? [`有效窗口不足 ${MINIMUM_WINDOW_DAYS} 个自然日`] : []),
    ...(input.reportCount < MINIMUM_REPORT_SOURCES ? [`已生效正式报告仅 ${input.reportCount}/${MINIMUM_REPORT_SOURCES} 份`] : []),
    ...(input.currentPe === null && input.currentPb === null ? ["当前 PE/PB 均不可用"] : []),
    ...(input.currentPe !== null && input.peSampleSize < MINIMUM_TRADING_DAYS ? [`PE 样本 ${input.peSampleSize}/${MINIMUM_TRADING_DAYS}`] : []),
    ...(input.currentPb !== null && input.pbSampleSize < MINIMUM_TRADING_DAYS ? [`PB 样本 ${input.pbSampleSize}/${MINIMUM_TRADING_DAYS}`] : [])
  ];
  return reasons.length ? reasons.join("；") : "没有满足口径的历史估值样本。";
}

function priceSeriesHash(candles: Array<{ date: string; close: number }>) {
  return createHash("sha256").update(JSON.stringify(candles)).digest("hex");
}

function positiveRatio(numerator: number, denominator: number | null, maximum: number) {
  if (denominator === null || denominator <= 0) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) && value > 0 && value <= maximum ? value : null;
}

function positiveNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function shanghaiDateKey(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value.slice(0, 10);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shanghaiSessionCompleted(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return false;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const minutes = Number(values.hour) * 60 + Number(values.minute);
  return Number.isFinite(minutes) && minutes >= 15 * 60;
}

function daysBetween(from: string, to: string) {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function round(value: number, digits = 4) {
  return Number(value.toFixed(digits));
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
