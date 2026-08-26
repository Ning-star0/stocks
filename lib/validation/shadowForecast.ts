import type { AiAnalysisResult, Candle } from "@/lib/types";
import type { DeterministicMarketFeatures } from "@/lib/analysis/evidence";
import { calculateTradingFee } from "@/lib/trading/rules";

export const SHADOW_FORECAST_SCHEMA_VERSION = "shadow-forecast-v1" as const;
export const SHADOW_FORECAST_ALGORITHM_VERSION = "next-session-open-target-before-stop-v1" as const;
export const SHADOW_FORECAST_PRICE_BASIS = "raw_unadjusted" as const;
export const SHADOW_PRICE_REGIME_ALGORITHM_VERSION = "instrument-price-regime-v1" as const;
export const SHADOW_BENCHMARK_ALGORITHM_VERSION = "same-entry-fixed-horizon-buy-hold-v1" as const;
export const FORECAST_CALIBRATION_SCHEMA_VERSION = "forecast-calibration-v1" as const;
export const MIN_CALIBRATION_SAMPLE_SIZE = 100;

export type ShadowForecastSnapshot = {
  schemaVersion: typeof SHADOW_FORECAST_SCHEMA_VERSION;
  algorithmVersion: typeof SHADOW_FORECAST_ALGORITHM_VERSION;
  cohortKey: string;
  priceRegime: "risk_on" | "neutral" | "risk_off" | "unknown";
  priceRegimeAlgorithmVersion: typeof SHADOW_PRICE_REGIME_ALGORITHM_VERSION;
  benchmarkAlgorithmVersion: typeof SHADOW_BENCHMARK_ALGORITHM_VERSION;
  decisionMode: "swing_trade" | "long_term";
  analysisAsOf: string;
  evidenceHash: string;
  modelProbability: number;
  horizonTradingDays: 20 | 63;
  priceBasis: typeof SHADOW_FORECAST_PRICE_BASIS;
  entryTriggerPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  plannedShares: number;
  netProfitIfRight: number;
  netLossIfWrong: number;
};

export type ShadowForecastEvaluation = {
  status: "pending" | "resolved" | "invalid";
  entryAt: string | null;
  entryPrice: number | null;
  exitAt: string | null;
  exitPrice: number | null;
  outcome: "target_before_stop" | "stop_before_target" | "ambiguous_same_session_stop_assumed" | "horizon_without_target" | null;
  outcomeValue: 0 | 1 | null;
  observedTradingDays: number;
  maxFavorablePct: number | null;
  maxAdversePct: number | null;
  netReturnPct: number | null;
  priceDataThrough: string | null;
  resolvedAt: string | null;
  invalidReason: string | null;
};

export type ShadowBenchmarkEvaluation = {
  status: "pending" | "resolved" | "invalid";
  entryAt: string | null;
  entryPrice: number | null;
  exitAt: string | null;
  exitPrice: number | null;
  observedTradingDays: number;
  netReturnPct: number | null;
  priceDataThrough: string | null;
  invalidReason: string | null;
};

export type CalibrationObservation = {
  probability: number;
  outcome: 0 | 1;
  cohortKey: string;
};

export type ForecastCalibrationReport = {
  schemaVersion: typeof FORECAST_CALIBRATION_SCHEMA_VERSION;
  status: "insufficient" | "shadow_only";
  sampleSize: number;
  minimumSampleSize: number;
  brierScore: number | null;
  baselineBrierScore: number | null;
  expectedCalibrationError: number | null;
  observedWinRate: number | null;
  decisionUseAllowed: false;
  limitations: string[];
  bins: Array<{
    lowerBound: number;
    upperBound: number;
    sampleSize: number;
    averageForecast: number;
    observedWinRate: number;
  }>;
};

export function buildShadowForecastSnapshot(input: {
  analysis: AiAnalysisResult;
  evidenceHash: string;
  analysisAsOf: string;
  marketFeatures?: DeterministicMarketFeatures | null;
}): ShadowForecastSnapshot | null {
  const mode = input.analysis.decisionMode;
  const forecast = input.analysis.entryOutcomeForecast;
  const entry = input.analysis.tradePlan?.entry;
  if (mode !== "swing_trade" && mode !== "long_term") return null;
  if (!forecast || forecast.status !== "subjective_unvalidated" || forecast.targetBeforeStopProbability === null) return null;
  if (!entry?.shadowEligible) return null;

  const horizonTradingDays = mode === "swing_trade" ? 20 : 63;
  const values = {
    entryTriggerPrice: finitePositive(entry.triggerPrice),
    stopLossPrice: finitePositive(entry.stopLossPrice),
    takeProfitPrice: finitePositive(entry.takeProfitPrice),
    plannedShares: finitePositive(entry.shares),
    netProfitIfRight: finitePositive(entry.netExpectedProfit),
    netLossIfWrong: finitePositive(entry.netMaxLossAmount)
  };
  if (Object.values(values).some((value) => value === null)) return null;
  if (values.stopLossPrice! >= values.entryTriggerPrice! || values.takeProfitPrice! <= values.entryTriggerPrice!) return null;
  const analysisAsOf = normalizeTimestamp(input.analysisAsOf);
  if (!analysisAsOf || !/^[a-f0-9]{64}$/i.test(input.evidenceHash)) return null;
  const priceRegime = classifyShadowPriceRegime(input.marketFeatures);

  return {
    schemaVersion: SHADOW_FORECAST_SCHEMA_VERSION,
    algorithmVersion: SHADOW_FORECAST_ALGORITHM_VERSION,
    cohortKey: `${mode}:price_${priceRegime}:${horizonTradingDays}d`,
    priceRegime,
    priceRegimeAlgorithmVersion: SHADOW_PRICE_REGIME_ALGORITHM_VERSION,
    benchmarkAlgorithmVersion: SHADOW_BENCHMARK_ALGORITHM_VERSION,
    decisionMode: mode,
    analysisAsOf,
    evidenceHash: input.evidenceHash.toLowerCase(),
    modelProbability: round(Math.min(0.95, Math.max(0.05, forecast.targetBeforeStopProbability)), 4),
    horizonTradingDays,
    priceBasis: SHADOW_FORECAST_PRICE_BASIS,
    entryTriggerPrice: values.entryTriggerPrice!,
    stopLossPrice: values.stopLossPrice!,
    takeProfitPrice: values.takeProfitPrice!,
    plannedShares: values.plannedShares!,
    netProfitIfRight: values.netProfitIfRight!,
    netLossIfWrong: values.netLossIfWrong!
  };
}

export function evaluateShadowForecast(input: {
  forecast: Pick<ShadowForecastSnapshot, "analysisAsOf" | "horizonTradingDays" | "stopLossPrice" | "takeProfitPrice" | "plannedShares">;
  candles: Candle[];
  evaluationAsOf: string;
}): ShadowForecastEvaluation {
  const evaluationAsOfMs = Date.parse(input.evaluationAsOf);
  const analysisDate = shanghaiDateKey(input.forecast.analysisAsOf);
  const usable = input.candles
    .filter((candle) => validCandle(candle) && (!Number.isFinite(evaluationAsOfMs) || Date.parse(candle.timestamp) <= evaluationAsOfMs))
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    .filter((candle) => shanghaiDateKey(candle.timestamp) > analysisDate);
  const entry = usable[0];
  if (!entry) return pendingEvaluation(0, null);
  if (entry.open <= input.forecast.stopLossPrice || entry.open >= input.forecast.takeProfitPrice) {
    return {
      ...pendingEvaluation(0, entry.timestamp),
      status: "invalid",
      entryAt: entry.timestamp,
      entryPrice: entry.open,
      invalidReason: "下一完整交易日开盘价已经越过止损或止盈，原计划无法按统一影子规则执行。"
    };
  }

  const horizon = usable.slice(0, input.forecast.horizonTradingDays);
  let maxHigh = entry.open;
  let minLow = entry.open;
  for (let index = 0; index < horizon.length; index += 1) {
    const candle = horizon[index];
    maxHigh = Math.max(maxHigh, candle.high);
    minLow = Math.min(minLow, candle.low);
    const hitTarget = candle.high >= input.forecast.takeProfitPrice;
    const hitStop = candle.low <= input.forecast.stopLossPrice;
    if (hitTarget || hitStop) {
      const conservativeLoss = hitStop;
      const exitPrice = conservativeLoss ? input.forecast.stopLossPrice : input.forecast.takeProfitPrice;
      return resolvedEvaluation({
        entry,
        exit: candle,
        entryPrice: entry.open,
        exitPrice,
        shares: input.forecast.plannedShares,
        observedTradingDays: index + 1,
        maxHigh,
        minLow,
        outcome: hitTarget && hitStop ? "ambiguous_same_session_stop_assumed" : hitStop ? "stop_before_target" : "target_before_stop",
        outcomeValue: conservativeLoss ? 0 : 1
      });
    }
  }

  if (horizon.length < input.forecast.horizonTradingDays) {
    return {
      ...pendingEvaluation(horizon.length, horizon.at(-1)?.timestamp ?? entry.timestamp),
      entryAt: entry.timestamp,
      entryPrice: entry.open,
      maxFavorablePct: pct(maxHigh, entry.open),
      maxAdversePct: pct(minLow, entry.open)
    };
  }
  const exit = horizon.at(-1)!;
  return resolvedEvaluation({
    entry,
    exit,
    entryPrice: entry.open,
    exitPrice: exit.close,
    shares: input.forecast.plannedShares,
    observedTradingDays: horizon.length,
    maxHigh,
    minLow,
    outcome: "horizon_without_target",
    outcomeValue: 0
  });
}

export function evaluateShadowBenchmark(input: {
  forecast: Pick<ShadowForecastSnapshot, "analysisAsOf" | "horizonTradingDays" | "stopLossPrice" | "takeProfitPrice" | "plannedShares">;
  candles: Candle[];
  evaluationAsOf: string;
}): ShadowBenchmarkEvaluation {
  const usable = usablePostAnalysisCandles(input.forecast.analysisAsOf, input.candles, input.evaluationAsOf);
  const entry = usable[0];
  if (!entry) return pendingBenchmark(0, null);
  if (entry.open <= input.forecast.stopLossPrice || entry.open >= input.forecast.takeProfitPrice) {
    return {
      ...pendingBenchmark(0, entry.timestamp),
      status: "invalid",
      entryAt: entry.timestamp,
      entryPrice: round(entry.open, 4),
      invalidReason: "下一完整交易日开盘价已经越过止损或止盈，基准与影子计划都无法使用统一入场事件。"
    };
  }
  const horizon = usable.slice(0, input.forecast.horizonTradingDays);
  if (horizon.length < input.forecast.horizonTradingDays) {
    return {
      ...pendingBenchmark(horizon.length, horizon.at(-1)?.timestamp ?? entry.timestamp),
      entryAt: entry.timestamp,
      entryPrice: round(entry.open, 4)
    };
  }
  const exit = horizon.at(-1)!;
  return {
    status: "resolved",
    entryAt: entry.timestamp,
    entryPrice: round(entry.open, 4),
    exitAt: exit.timestamp,
    exitPrice: round(exit.close, 4),
    observedTradingDays: horizon.length,
    netReturnPct: netReturnPct(entry.open, exit.close, input.forecast.plannedShares),
    priceDataThrough: exit.timestamp,
    invalidReason: null
  };
}

export function classifyShadowPriceRegime(features?: DeterministicMarketFeatures | null): ShadowForecastSnapshot["priceRegime"] {
  if (!features) return "unknown";
  const values = [features.return20dPct, features.return60dPct, features.maxDrawdown60dPct, features.pricePosition60dPct];
  if (values.every((value) => value === null || !Number.isFinite(value))) return "unknown";
  if ((features.return20dPct ?? 0) <= -5 || (features.maxDrawdown60dPct ?? 0) >= 12 || (features.pricePosition60dPct ?? 50) <= 25) {
    return "risk_off";
  }
  if ((features.return20dPct ?? 0) >= 3
    && (features.return60dPct ?? 0) >= 0
    && (features.maxDrawdown60dPct ?? 100) < 10
    && (features.pricePosition60dPct ?? 0) >= 55) {
    return "risk_on";
  }
  return "neutral";
}

export function buildForecastCalibrationReport(observations: CalibrationObservation[]): ForecastCalibrationReport {
  const valid = observations.filter((item) => Number.isFinite(item.probability)
    && item.probability >= 0
    && item.probability <= 1
    && (item.outcome === 0 || item.outcome === 1));
  if (!valid.length) return emptyCalibrationReport();
  const observedWinRate = average(valid.map((item) => item.outcome));
  const brierScore = average(valid.map((item) => (item.probability - item.outcome) ** 2));
  const baselineBrierScore = average(valid.map((item) => (observedWinRate - item.outcome) ** 2));
  const bins = Array.from({ length: 10 }, (_, index) => {
    const lowerBound = index / 10;
    const upperBound = (index + 1) / 10;
    const items = valid.filter((item) => item.probability >= lowerBound && (index === 9 ? item.probability <= upperBound : item.probability < upperBound));
    return items.length ? {
      lowerBound,
      upperBound,
      sampleSize: items.length,
      averageForecast: round(average(items.map((item) => item.probability)), 4),
      observedWinRate: round(average(items.map((item) => item.outcome)), 4)
    } : null;
  }).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const expectedCalibrationError = bins.reduce((sum, bin) => (
    sum + (bin.sampleSize / valid.length) * Math.abs(bin.averageForecast - bin.observedWinRate)
  ), 0);

  return {
    schemaVersion: FORECAST_CALIBRATION_SCHEMA_VERSION,
    status: valid.length >= MIN_CALIBRATION_SAMPLE_SIZE ? "shadow_only" : "insufficient",
    sampleSize: valid.length,
    minimumSampleSize: MIN_CALIBRATION_SAMPLE_SIZE,
    brierScore: round(brierScore, 6),
    baselineBrierScore: round(baselineBrierScore, 6),
    expectedCalibrationError: round(expectedCalibrationError, 6),
    observedWinRate: round(observedWinRate, 4),
    decisionUseAllowed: false,
    limitations: [
      "当前报告只评估影子计划，不会解锁真实买入或放大仓位。",
      "当前只按标的自身的确定性价格环境分组；仍需补充宽基市场环境、独立保留测试集、公司行动与现金分红口径后，才可评估是否用于扣费后期望值。",
      "同期买入持有基准必须等待完整 20/63 个交易日，并按同样股数计入双边手续费，不能拿尚未走完的区间比较。",
      "同一交易日同时触及止损和止盈时按止损处理，避免用未知盘中顺序美化结果。"
    ],
    bins
  };
}

function resolvedEvaluation(input: {
  entry: Candle;
  exit: Candle;
  entryPrice: number;
  exitPrice: number;
  shares: number;
  observedTradingDays: number;
  maxHigh: number;
  minLow: number;
  outcome: NonNullable<ShadowForecastEvaluation["outcome"]>;
  outcomeValue: 0 | 1;
}): ShadowForecastEvaluation {
  return {
    status: "resolved",
    entryAt: input.entry.timestamp,
    entryPrice: round(input.entryPrice, 4),
    exitAt: input.exit.timestamp,
    exitPrice: round(input.exitPrice, 4),
    outcome: input.outcome,
    outcomeValue: input.outcomeValue,
    observedTradingDays: input.observedTradingDays,
    maxFavorablePct: pct(input.maxHigh, input.entryPrice),
    maxAdversePct: pct(input.minLow, input.entryPrice),
    netReturnPct: netReturnPct(input.entryPrice, input.exitPrice, input.shares),
    priceDataThrough: input.exit.timestamp,
    resolvedAt: input.exit.timestamp,
    invalidReason: null
  };
}

function pendingEvaluation(observedTradingDays: number, priceDataThrough: string | null): ShadowForecastEvaluation {
  return {
    status: "pending",
    entryAt: null,
    entryPrice: null,
    exitAt: null,
    exitPrice: null,
    outcome: null,
    outcomeValue: null,
    observedTradingDays,
    maxFavorablePct: null,
    maxAdversePct: null,
    netReturnPct: null,
    priceDataThrough,
    resolvedAt: null,
    invalidReason: null
  };
}

function pendingBenchmark(observedTradingDays: number, priceDataThrough: string | null): ShadowBenchmarkEvaluation {
  return {
    status: "pending",
    entryAt: null,
    entryPrice: null,
    exitAt: null,
    exitPrice: null,
    observedTradingDays,
    netReturnPct: null,
    priceDataThrough,
    invalidReason: null
  };
}

function usablePostAnalysisCandles(analysisAsOf: string, candles: Candle[], evaluationAsOf: string) {
  const evaluationAsOfMs = Date.parse(evaluationAsOf);
  const analysisDate = shanghaiDateKey(analysisAsOf);
  return candles
    .filter((candle) => validCandle(candle) && (!Number.isFinite(evaluationAsOfMs) || Date.parse(candle.timestamp) <= evaluationAsOfMs))
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    .filter((candle) => shanghaiDateKey(candle.timestamp) > analysisDate);
}

function netReturnPct(entryPrice: number, exitPrice: number, shares: number) {
  const entryAmount = entryPrice * shares;
  const exitAmount = exitPrice * shares;
  const netPnl = exitAmount - calculateTradingFee(exitAmount) - entryAmount - calculateTradingFee(entryAmount);
  return round((netPnl / (entryAmount + calculateTradingFee(entryAmount))) * 100, 6);
}

function emptyCalibrationReport(): ForecastCalibrationReport {
  return {
    schemaVersion: FORECAST_CALIBRATION_SCHEMA_VERSION,
    status: "insufficient",
    sampleSize: 0,
    minimumSampleSize: MIN_CALIBRATION_SAMPLE_SIZE,
    brierScore: null,
    baselineBrierScore: null,
    expectedCalibrationError: null,
    observedWinRate: null,
    decisionUseAllowed: false,
    limitations: [
      "尚无已结算影子计划，不能计算校准胜率或扣费后期望值。",
      "当前报告不会解锁真实买入或放大仓位。"
    ],
    bins: []
  };
}

function validCandle(candle: Candle) {
  return Number.isFinite(Date.parse(candle.timestamp))
    && finitePositive(candle.open) !== null
    && finitePositive(candle.high) !== null
    && finitePositive(candle.low) !== null
    && finitePositive(candle.close) !== null
    && candle.high >= candle.low;
}

function finitePositive(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeTimestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function shanghaiDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function pct(value: number, reference: number) {
  return round((value / reference - 1) * 100, 6);
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
