import { createHash } from "node:crypto";

import type { IndicatorSnapshot, Quote } from "@/lib/types";

export type AnalysisContextHashInput = {
  symbol: string;
  quote: Pick<Quote, "price">;
  indicators: Pick<IndicatorSnapshot, "rsi14" | "macd" | "macdSignal" | "sma20" | "sma50" | "sma200">;
  importantNewsIds: string[];
  userContext: {
    holdingPrice?: number | null;
    targetPrice?: number | null;
    stopLoss?: number | null;
    positionOpenedAt?: string | null;
    timeHorizon?: string | null;
    riskLevel?: string | null;
  };
};

export function createAnalysisContextHash(input: AnalysisContextHashInput) {
  const stableContext = {
    analysisPromptVersion: 5,
    symbol: input.symbol.toUpperCase(),
    priceBucket: priceBucket(input.quote.price),
    trendState: trendState(input.quote.price, input.indicators),
    rsiState: rsiState(input.indicators.rsi14),
    macdState: macdState(input.indicators.macd, input.indicators.macdSignal),
    movingAverageState: movingAverageState(input.quote.price, input.indicators),
    importantNewsIds: [...new Set(input.importantNewsIds)].sort(),
    userContext: {
      holdingPrice: input.userContext.holdingPrice ?? null,
      targetPrice: input.userContext.targetPrice ?? null,
      stopLoss: input.userContext.stopLoss ?? null,
      positionOpenedAt: input.userContext.positionOpenedAt ?? null,
      timeHorizon: input.userContext.timeHorizon ?? null,
      riskLevel: input.userContext.riskLevel ?? null
    }
  };

  return createHash("sha256").update(JSON.stringify(stableContext)).digest("hex");
}

export function priceBucket(price: number) {
  if (!Number.isFinite(price) || price <= 0) return 0;
  return Math.round(Math.log(price) / Math.log(1.01));
}

export function rsiState(rsi: number | null | undefined) {
  if (rsi === null || rsi === undefined) return "unknown";
  if (rsi >= 70) return "overbought";
  if (rsi <= 30) return "oversold";
  return "normal";
}

export function macdState(macd: number | null | undefined, signal: number | null | undefined) {
  if (macd === null || macd === undefined || signal === null || signal === undefined) return "neutral";
  if (macd > signal) return "bullish";
  if (macd < signal) return "bearish";
  return "neutral";
}

export function movingAverageState(
  price: number,
  indicators: Pick<IndicatorSnapshot, "sma20" | "sma50" | "sma200">
) {
  return {
    vsSma20: compare(price, indicators.sma20),
    vsSma50: compare(price, indicators.sma50),
    vsSma200: compare(price, indicators.sma200),
    sma20vs50: compare(indicators.sma20, indicators.sma50),
    sma50vs200: compare(indicators.sma50, indicators.sma200)
  };
}

function trendState(price: number, indicators: Pick<IndicatorSnapshot, "sma20" | "sma50" | "sma200">) {
  const state = movingAverageState(price, indicators);
  if (state.vsSma20 === "above" && state.vsSma50 === "above" && state.sma50vs200 === "above") return "bullish";
  if (state.vsSma20 === "below" && state.vsSma50 === "below" && state.sma50vs200 === "below") return "bearish";
  return "neutral";
}

function compare(a: number | null | undefined, b: number | null | undefined) {
  if (a === null || a === undefined || b === null || b === undefined) return "unknown";
  if (a > b) return "above";
  if (a < b) return "below";
  return "equal";
}
