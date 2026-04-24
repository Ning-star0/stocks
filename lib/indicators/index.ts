import type { Candle, IndicatorSnapshot } from "@/lib/types";
import { AppError } from "@/lib/errors";

const MIN_INDICATOR_CANDLES = 35;

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return average(slice);
}

export function emaSeries(values: number[], period: number): Array<number | null> {
  if (values.length < period) return values.map(() => null);
  const multiplier = 2 / (period + 1);
  const output: Array<number | null> = values.map(() => null);
  let previous = average(values.slice(0, period));
  output[period - 1] = previous;

  for (let i = period; i < values.length; i += 1) {
    previous = (values[i] - previous) * multiplier + previous;
    output[i] = previous;
  }

  return output;
}

export function ema(values: number[], period: number): number | null {
  const series = emaSeries(values, period);
  return series[series.length - 1] ?? null;
}

export function rsi(values: number[], period = 14): number | null {
  if (values.length <= period) return null;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const relativeStrength = avgGain / avgLoss;
  return 100 - 100 / (1 + relativeStrength);
}

export function macd(values: number[], fast = 12, slow = 26, signal = 9) {
  const fastSeries = emaSeries(values, fast);
  const slowSeries = emaSeries(values, slow);
  const macdLine = values.map((_, index) => {
    const fastValue = fastSeries[index];
    const slowValue = slowSeries[index];
    return fastValue === null || slowValue === null ? null : fastValue - slowValue;
  });
  const signalInput = macdLine.filter((value): value is number => value !== null);
  const signalSeries = emaSeries(signalInput, signal);
  return {
    macd: macdLine[macdLine.length - 1] ?? null,
    macdSignal: signalSeries[signalSeries.length - 1] ?? null
  };
}

export function bollingerBands(values: number[], period = 20, multiplier = 2) {
  if (values.length < period) {
    return { upper: null, middle: null, lower: null };
  }

  const slice = values.slice(-period);
  const middle = average(slice);
  const variance = average(slice.map((value) => Math.pow(value - middle, 2)));
  const deviation = Math.sqrt(variance);

  return {
    upper: middle + deviation * multiplier,
    middle,
    lower: middle - deviation * multiplier
  };
}

export function calculateIndicators(symbol: string, candles: Candle[]): IndicatorSnapshot {
  assertSufficientHistory(candles);

  const closes = candles.map((candle) => candle.close);
  const macdValues = macd(closes);
  const bands = bollingerBands(closes);
  const lastTimestamp = candles[candles.length - 1]?.timestamp ?? new Date().toISOString();

  return {
    symbol: symbol.toUpperCase(),
    rsi14: round(rsi(closes, 14)),
    macd: round(macdValues.macd),
    macdSignal: round(macdValues.macdSignal),
    sma20: round(sma(closes, 20)),
    sma50: round(sma(closes, 50)),
    sma200: round(sma(closes, 200)),
    ema20: round(ema(closes, 20)),
    bollingerUpper: round(bands.upper),
    bollingerMiddle: round(bands.middle),
    bollingerLower: round(bands.lower),
    timestamp: lastTimestamp
  };
}

export function assertSufficientHistory(candles: Candle[], minimum = MIN_INDICATOR_CANDLES) {
  if (candles.length < minimum) {
    throw new AppError("INSUFFICIENT_DATA", `At least ${minimum} candles are required to calculate indicators.`, {
      candles: candles.length,
      minimum
    });
  }
}

export function summarizeHistory(candles: Candle[]) {
  if (!candles.length) {
    return {
      bars: 0,
      start: null,
      end: null,
      changePercent: null,
      high: null,
      low: null,
      averageVolume: null,
      recentVolume: null
    };
  }

  const first = candles[0];
  const last = candles[candles.length - 1];
  return {
    bars: candles.length,
    start: first.timestamp,
    end: last.timestamp,
    changePercent: round(((last.close - first.close) / first.close) * 100),
    high: round(Math.max(...candles.map((candle) => candle.high))),
    low: round(Math.min(...candles.map((candle) => candle.low))),
    averageVolume: Math.round(average(candles.map((candle) => candle.volume))),
    recentVolume: last.volume
  };
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number | null, digits = 4) {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}
