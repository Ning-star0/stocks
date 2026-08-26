import { createHash } from "node:crypto";

import { calculateDeterministicMarketFeatures, type DeterministicMarketFeatures } from "@/lib/analysis/evidence";
import { getCache, setCache } from "@/lib/cache";
import { getStockDataProvider } from "@/lib/stock-data";
import type { StockDataProvider, ValuationPriceHistoryEvidence } from "@/lib/stock-data/types";
import { classifyShadowPriceRegime } from "@/lib/validation/shadowForecast";

export const MARKET_REGIME_SCHEMA_VERSION = "benchmark-market-regime-v1" as const;
export const MARKET_REGIME_ALGORITHM_VERSION = "csi300-raw-price-regime-v1" as const;
export const MARKET_REGIME_BENCHMARK_SYMBOL = "000300.SH" as const;
const MARKET_REGIME_CACHE_KEY = "market_regime:v1:000300.SH";
const MIN_MARKET_CANDLES = 120;
const CACHE_SECONDS = 60 * 60;
const FAILURE_CACHE_SECONDS = 5 * 60;

export type BenchmarkMarketRegimeEvidence = {
  schemaVersion: typeof MARKET_REGIME_SCHEMA_VERSION;
  algorithmVersion: typeof MARKET_REGIME_ALGORITHM_VERSION;
  status: "available" | "stale" | "unavailable";
  regime: "risk_on" | "neutral" | "risk_off" | "unknown";
  benchmarkSymbol: typeof MARKET_REGIME_BENCHMARK_SYMBOL;
  provider: string;
  sourceUrl: string;
  priceBasis: "raw_unadjusted";
  fetchedAt: string | null;
  asOf: string | null;
  candleCount: number;
  features: DeterministicMarketFeatures | null;
  evidenceHash: string | null;
  failure: string | null;
};

let inFlight: Promise<BenchmarkMarketRegimeEvidence> | null = null;

export async function loadBenchmarkMarketRegimeEvidence(options: {
  provider?: StockDataProvider;
  analysisAsOf?: string;
} = {}): Promise<BenchmarkMarketRegimeEvidence> {
  const analysisAsOf = normalizeTimestamp(options.analysisAsOf) ?? new Date().toISOString();
  const cached = await getCache<BenchmarkMarketRegimeEvidence>(MARKET_REGIME_CACHE_KEY).catch(() => null);
  if (cached && evidenceIsAvailableAt(cached, analysisAsOf)) return reevaluateFreshness(cached, analysisAsOf);
  if (inFlight) {
    const pending = await inFlight;
    if (evidenceIsAvailableAt(pending, analysisAsOf)) return reevaluateFreshness(pending, analysisAsOf);
  }
  const provider = options.provider ?? getStockDataProvider();
  inFlight = fetchBenchmarkEvidence(provider, analysisAsOf).finally(() => { inFlight = null; });
  const evidence = await inFlight;
  if (Date.parse(analysisAsOf) >= Date.now() - 60 * 60 * 1000) {
    await setCache(MARKET_REGIME_CACHE_KEY, evidence, evidence.status === "unavailable" ? FAILURE_CACHE_SECONDS : CACHE_SECONDS).catch(() => null);
  }
  return evidence;
}

export function buildBenchmarkMarketRegimeEvidence(
  receipt: ValuationPriceHistoryEvidence,
  analysisAsOf: string
): BenchmarkMarketRegimeEvidence {
  const cutoff = Date.parse(analysisAsOf);
  if (receipt.status !== "available" || receipt.adjustment !== "none") {
    return unavailableEvidence(receipt.failure || "沪深 300 未复权日线不可用。", receipt);
  }
  const candles = receipt.candles
    .filter((candle) => Number.isFinite(Date.parse(candle.timestamp)) && (!Number.isFinite(cutoff) || Date.parse(candle.timestamp) <= cutoff))
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    .slice(-252);
  const asOf = candles.at(-1)?.timestamp ?? null;
  if (candles.length < MIN_MARKET_CANDLES || !asOf) {
    return unavailableEvidence(`沪深 300 可用日线不足 ${MIN_MARKET_CANDLES} 根。`, receipt, candles.length, asOf);
  }
  const features = calculateDeterministicMarketFeatures(candles);
  const classifiedRegime = classifyShadowPriceRegime(features);
  const stale = Date.parse(analysisAsOf) - Date.parse(asOf) > 7 * 24 * 60 * 60 * 1000;
  const evidenceHash = createHash("sha256").update(JSON.stringify({
    schemaVersion: MARKET_REGIME_SCHEMA_VERSION,
    algorithmVersion: MARKET_REGIME_ALGORITHM_VERSION,
    benchmarkSymbol: MARKET_REGIME_BENCHMARK_SYMBOL,
    provider: receipt.provider,
    priceBasis: "raw_unadjusted",
    candles: candles.map((candle) => ({ timestamp: candle.timestamp, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume })),
    classifiedRegime,
    features
  })).digest("hex");
  return {
    schemaVersion: MARKET_REGIME_SCHEMA_VERSION,
    algorithmVersion: MARKET_REGIME_ALGORITHM_VERSION,
    status: stale ? "stale" : "available",
    regime: stale ? "unknown" : classifiedRegime,
    benchmarkSymbol: MARKET_REGIME_BENCHMARK_SYMBOL,
    provider: receipt.provider,
    sourceUrl: receipt.sourceUrl,
    priceBasis: "raw_unadjusted",
    fetchedAt: receipt.fetchedAt,
    asOf,
    candleCount: candles.length,
    features,
    evidenceHash,
    failure: stale ? "沪深 300 日线距分析时点超过 7 天，市场环境只能作为过期证据。" : null
  };
}

function fetchBenchmarkEvidence(provider: StockDataProvider, analysisAsOf: string) {
  if (!provider.getValuationPriceHistory) {
    return Promise.resolve(unavailableEvidence("当前行情提供方不支持未复权宽基历史价格。"));
  }
  return provider.getValuationPriceHistory(MARKET_REGIME_BENCHMARK_SYMBOL, { adjustment: "none" })
    .then((receipt) => buildBenchmarkMarketRegimeEvidence(receipt, analysisAsOf))
    .catch((error) => unavailableEvidence(errorMessage(error)));
}

function reevaluateFreshness(evidence: BenchmarkMarketRegimeEvidence, analysisAsOf: string) {
  if (evidence.status === "unavailable" || !evidence.asOf) return evidence;
  const stale = Date.parse(analysisAsOf) - Date.parse(evidence.asOf) > 7 * 24 * 60 * 60 * 1000;
  return {
    ...evidence,
    status: stale ? "stale" as const : "available" as const,
    regime: stale ? "unknown" as const : classifyShadowPriceRegime(evidence.features),
    failure: stale ? "沪深 300 日线距分析时点超过 7 天，市场环境只能作为过期证据。" : null
  };
}

function evidenceIsAvailableAt(evidence: BenchmarkMarketRegimeEvidence, analysisAsOf: string) {
  return !evidence.asOf || Date.parse(evidence.asOf) <= Date.parse(analysisAsOf);
}

function unavailableEvidence(
  failure: string,
  receipt?: Pick<ValuationPriceHistoryEvidence, "provider" | "sourceUrl" | "fetchedAt">,
  candleCount = 0,
  asOf: string | null = null
): BenchmarkMarketRegimeEvidence {
  return {
    schemaVersion: MARKET_REGIME_SCHEMA_VERSION,
    algorithmVersion: MARKET_REGIME_ALGORITHM_VERSION,
    status: "unavailable",
    regime: "unknown",
    benchmarkSymbol: MARKET_REGIME_BENCHMARK_SYMBOL,
    provider: receipt?.provider ?? "not_available",
    sourceUrl: receipt?.sourceUrl ?? "",
    priceBasis: "raw_unadjusted",
    fetchedAt: receipt?.fetchedAt ?? null,
    asOf,
    candleCount,
    features: null,
    evidenceHash: null,
    failure
  };
}

function normalizeTimestamp(value?: string | null) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 1000) : "沪深 300 市场环境读取失败。";
}
