import { macdState, movingAverageState, rsiState } from "@/lib/analysis/contextHash";
import type { IndicatorSnapshot, Quote } from "@/lib/types";

export type ShouldRunStockAnalysisInput = {
  forceRefresh?: boolean;
  latestAnalysis?: {
    createdAt: Date | string;
    inputJson?: unknown;
    outputJson?: unknown;
  } | null;
  currentQuote: Quote;
  currentIndicators: IndicatorSnapshot;
  highImpactNewsIds: string[];
  previousHighImpactNewsIds: string[];
  userContextHashChanged: boolean;
  importantAlertTriggered?: boolean;
};

export function shouldRunStockAnalysis(input: ShouldRunStockAnalysisInput) {
  if (input.forceRefresh) return result(true, "force_refresh", false);
  if (!input.latestAnalysis) return result(true, "no_historical_analysis", false);
  if (isFallbackAnalysis(input.latestAnalysis.outputJson)) return result(true, "previous_analysis_was_fallback", true);

  const latestCreatedAt = new Date(input.latestAnalysis.createdAt);
  if (Date.now() - latestCreatedAt.getTime() > 6 * 60 * 60 * 1000) return result(true, "analysis_older_than_6h", true);

  const previous = extractPreviousState(input.latestAnalysis.inputJson);
  if (!previous) return result(true, "previous_context_unavailable", true);

  const priceChange = Math.abs((input.currentQuote.price - previous.price) / previous.price) * 100;
  if (priceChange > 3) return result(true, "price_changed_more_than_3_percent", true);

  const currentRsiState = rsiState(input.currentIndicators.rsi14);
  if (currentRsiState !== previous.rsiState) return result(true, "rsi_state_changed", true);

  const currentMacdState = macdState(input.currentIndicators.macd, input.currentIndicators.macdSignal);
  if (currentMacdState !== previous.macdState) return result(true, "macd_state_changed", true);

  const currentMa = movingAverageState(input.currentQuote.price, input.currentIndicators);
  if (currentMa.vsSma50 !== previous.maState?.vsSma50 || currentMa.vsSma200 !== previous.maState?.vsSma200) {
    return result(true, "price_crossed_sma50_or_sma200", true);
  }

  const previousNews = new Set(input.previousHighImpactNewsIds);
  if (input.highImpactNewsIds.some((id) => !previousNews.has(id))) return result(true, "new_high_impact_news", true);

  if (input.userContextHashChanged) return result(true, "user_context_changed", true);
  if (input.importantAlertTriggered) return result(true, "important_alert_triggered", true);

  return result(false, "context_unchanged", true);
}

function isFallbackAnalysis(outputJson: unknown) {
  const output = outputJson as { isFallback?: boolean } | null;
  return Boolean(output?.isFallback);
}

function result(shouldRun: boolean, reason: string, staleAnalysisAllowed: boolean) {
  return { shouldRun, reason, staleAnalysisAllowed };
}

function extractPreviousState(inputJson: unknown) {
  const value = inputJson as {
    quote?: { price?: number };
    indicators?: IndicatorSnapshot;
    highImpactNewsIds?: string[];
  } | null;
  if (!value?.quote?.price || !value.indicators) return null;
  return {
    price: value.quote.price,
    rsiState: rsiState(value.indicators.rsi14),
    macdState: macdState(value.indicators.macd, value.indicators.macdSignal),
    maState: movingAverageState(value.quote.price, value.indicators),
    highImpactNewsIds: value.highImpactNewsIds ?? []
  };
}
