import { AppError } from "@/lib/errors";
import type { Candle } from "@/lib/types";

/**
 * Bump this revision whenever the adjustment table or validation rules change.
 * It is part of the AI-analysis and strategy-gate cache keys so contaminated
 * analyses cannot be reused after a market-data repair.
 */
export const MARKET_DATA_REVISION = "cn-corporate-actions-2026-08-11-v1";

export type CorporateAction = {
  symbol: string;
  effectiveDate: string;
  splitFactor: number;
  label: string;
  sourceUrl: string;
};

/**
 * Tencent's fallback K-line endpoint returns raw, unadjusted bars. These
 * confirmed fund-share splits are therefore applied on that path only.
 * effectiveDate is the first trading day on the post-split price basis.
 */
export const CONFIRMED_CORPORATE_ACTIONS: readonly CorporateAction[] = [
  {
    symbol: "515880.SH",
    effectiveDate: "2026-02-03",
    splitFactor: 3,
    label: "基金份额拆分 1:3",
    sourceUrl: "https://pdf.dfcfw.com/pdf/H2_AN202602031819506989_1.pdf"
  },
  {
    symbol: "561380.SH",
    effectiveDate: "2026-06-25",
    splitFactor: 2.5,
    label: "基金份额拆分 1:2.5",
    sourceUrl: "https://notice.10jqka.com.cn/api/pdf/4e421b2066f64cf5.pdf"
  },
  {
    symbol: "512480.SH",
    effectiveDate: "2026-07-03",
    splitFactor: 2,
    label: "基金份额拆分 1:2",
    sourceUrl: "https://www.sse.com.cn/disclosure/fund/announcement/c/new/2026-07-03/512480_20260703_WPHJ.pdf"
  },
  {
    symbol: "515880.SH",
    effectiveDate: "2026-07-06",
    splitFactor: 2,
    label: "基金份额拆分 1:2",
    sourceUrl: "https://www.sse.com.cn/disclosure/fund/announcement/c/new/2026-07-06/515880_20260706_PYMW.pdf"
  }
] as const;

export function adjustTencentHistoryForCorporateActions(symbol: string, candles: Candle[]) {
  const canonical = symbol.trim().toUpperCase();
  const actions = CONFIRMED_CORPORATE_ACTIONS
    .filter((action) => action.symbol === canonical)
    .sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate));
  const ordered = [...candles].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  const adjusted = ordered.map((candle) => {
    const date = candleDate(candle.timestamp);
    const factor = actions
      .filter((action) => date < action.effectiveDate)
      .reduce((product, action) => product * action.splitFactor, 1);
    if (factor === 1) return { ...candle, symbol: canonical };
    return {
      ...candle,
      symbol: canonical,
      open: roundPrice(candle.open / factor),
      high: roundPrice(candle.high / factor),
      low: roundPrice(candle.low / factor),
      close: roundPrice(candle.close / factor),
      // Express historical turnover in current shares as well, so volume
      // ratios do not acquire an artificial discontinuity at the split.
      volume: Math.round(candle.volume * factor)
    };
  });
  assertNoUnexplainedCorporateActionGap(canonical, adjusted);
  return adjusted;
}

/**
 * Refuse to feed a likely unadjusted split into indicators or a backtest.
 * A-share funds normally cannot make a genuine one-session move of this size;
 * matching a common split ratio makes the check specific enough to fail safe.
 */
export function assertNoUnexplainedCorporateActionGap(symbol: string, candles: Candle[]) {
  const commonSplitFactors = [1.5, 5 / 3, 2, 2.5, 3, 4, 5, 10];
  for (let index = 1; index < candles.length; index += 1) {
    const previous = candles[index - 1];
    const current = candles[index];
    if (!isFinitePositive(previous.close) || !isFinitePositive(current.open)) continue;
    const elapsedDays = (Date.parse(current.timestamp) - Date.parse(previous.timestamp)) / (24 * 60 * 60 * 1000);
    // Sparse ranges and long suspensions are not adjacent market sessions, so
    // their price difference cannot be classified as a one-day split gap.
    if (!Number.isFinite(elapsedDays) || elapsedDays <= 0 || elapsedDays > 14) continue;
    const ratio = previous.close / current.open;
    const inverseRatio = current.open / previous.close;
    const factor = commonSplitFactors.find((candidate) => nearRatio(ratio, candidate) || nearRatio(inverseRatio, candidate));
    const gapPct = Math.abs(current.open / previous.close - 1) * 100;
    if (gapPct < 32 || !factor) continue;
    throw new AppError(
      "DATA_PROVIDER_ERROR",
      `${symbol} 在 ${candleDate(current.timestamp)} 出现疑似未复权的 ${factor}:1 价格断层，已停止使用该组 K 线。`,
      {
        symbol,
        previousDate: candleDate(previous.timestamp),
        currentDate: candleDate(current.timestamp),
        previousClose: previous.close,
        currentOpen: current.open,
        suspectedFactor: factor,
        marketDataRevision: MARKET_DATA_REVISION
      }
    );
  }
}

function candleDate(timestamp: string) {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return timestamp.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(parsed);
}

function nearRatio(value: number, target: number) {
  return Number.isFinite(value) && Math.abs(value / target - 1) <= 0.08;
}

function isFinitePositive(value: number) {
  return Number.isFinite(value) && value > 0;
}

function roundPrice(value: number) {
  return Number(value.toFixed(6));
}
