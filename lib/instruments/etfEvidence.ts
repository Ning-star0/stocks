import type { InstrumentProfile } from "@/lib/instruments/profile";
import type { Candle, Quote } from "@/lib/types";

export const ETF_EVIDENCE_SCHEMA_VERSION = "etf-evidence-v1";
export const ETF_LIQUIDITY_ALGORITHM_VERSION = "provider-volume-proxy-v1";

export type EtfEvidenceStatus = "complete" | "partial" | "insufficient";
export type EtfSubEvidenceStatus = "available" | "partial" | "unavailable";

export type EtfEvidence = {
  schemaVersion: typeof ETF_EVIDENCE_SCHEMA_VERSION;
  status: EtfEvidenceStatus;
  symbol: string;
  analysisAsOf: string;
  productIdentity: {
    status: EtfSubEvidenceStatus;
    exchange: "SH" | "SZ" | null;
    name: string | null;
    classificationSource: InstrumentProfile["classificationSource"];
    quoteProvider: string;
    quoteAsOf: string | null;
    limitations: string[];
  };
  liquidity: {
    status: EtfSubEvidenceStatus;
    algorithmVersion: typeof ETF_LIQUIDITY_ALGORITHM_VERSION;
    asOf: string | null;
    sampleTradingDays: number;
    averageDailyVolume20: number | null;
    medianDailyVolume20: number | null;
    zeroVolumeDays20: number;
    averageDailyValueProxy20: number | null;
    latestVolumeRatio20: number | null;
    providerVolumeUnit: "provider_raw_unit";
    valueProxyFormula: "close_x_provider_volume";
    futureCandleExcludedCount: number;
    limitations: string[];
  };
  tracking: { status: "unavailable"; benchmarkSymbol: null; trackingError: null; missingReason: string };
  premiumDiscount: { status: "unavailable"; nav: null; iopv: null; premiumDiscountPct: null; missingReason: string };
  fundSize: { status: "unavailable"; assetsUnderManagement: null; sharesOutstanding: null; missingReason: string };
  holdingsExposure: { status: "unavailable"; asOf: null; topHoldings: unknown[]; industryExposure: unknown[]; missingReason: string };
  managerDisclosures: { status: "unavailable"; checkedAt: null; items: unknown[]; missingReason: string };
  missingFields: string[];
  entryBlockers: string[];
};

export function buildEtfEvidence(input: {
  instrument: InstrumentProfile;
  quote: Quote;
  history: Candle[];
  quoteProvider: string;
  analysisAsOf: string;
}): EtfEvidence | null {
  if (input.instrument.instrumentType !== "etf") return null;

  const cutoff = Date.parse(input.analysisAsOf);
  const validCandles = input.history
    .filter((candle) => {
      const timestamp = Date.parse(candle.timestamp);
      return Number.isFinite(timestamp) && Number.isFinite(candle.close) && candle.close > 0 && Number.isFinite(candle.volume) && candle.volume >= 0
        && (!Number.isFinite(cutoff) || timestamp <= cutoff);
    })
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  const futureCandleExcludedCount = input.history.filter((candle) => {
    const timestamp = Date.parse(candle.timestamp);
    return Number.isFinite(cutoff) && Number.isFinite(timestamp) && timestamp > cutoff;
  }).length;
  const window20 = validCandles.slice(-20);
  const baseline20 = validCandles.slice(-21, -1);
  const volumes = window20.map((candle) => candle.volume);
  const latest = window20.at(-1) ?? null;
  const averageVolume20 = average(volumes);
  const averageBaseline20 = average(baseline20.map((candle) => candle.volume));
  const liquidityStatus: EtfSubEvidenceStatus = window20.length >= 20 ? "partial" : "unavailable";
  const [code, suffix = ""] = input.quote.symbol.trim().toUpperCase().split(".");
  const exchange = suffix === "SH" || suffix === "SZ" ? suffix : null;
  const name = input.quote.name?.trim() || null;

  const missingFields = [
    ...(!code || !exchange || !name ? ["etfProductIdentity"] : []),
    "etfManagerAndInceptionProfile",
    "etfBenchmarkIndex",
    "etfTrackingError",
    "etfFundSize",
    "etfNavOrIopv",
    "etfPremiumDiscount",
    "etfHoldingsAndIndustryExposure",
    "etfManagerDisclosures",
    ...(window20.length < 20 ? ["etfMinimum20DailyLiquiditySamples"] : []),
    "etfBidAskSpreadAndExecutableTurnover"
  ];

  return {
    schemaVersion: ETF_EVIDENCE_SCHEMA_VERSION,
    status: "insufficient",
    symbol: input.quote.symbol.toUpperCase(),
    analysisAsOf: input.analysisAsOf,
    productIdentity: {
      status: code && exchange && name ? "partial" : "unavailable",
      exchange,
      name,
      classificationSource: input.instrument.classificationSource,
      quoteProvider: input.quoteProvider,
      quoteAsOf: input.quote.timestamp || null,
      limitations: ["交易所代码和行情名称只能确认交易身份，不能替代基金合同、管理人、成立日、规模和跟踪指数资料。"]
    },
    liquidity: {
      status: liquidityStatus,
      algorithmVersion: ETF_LIQUIDITY_ALGORITHM_VERSION,
      asOf: latest?.timestamp ?? null,
      sampleTradingDays: window20.length,
      averageDailyVolume20: round(averageVolume20),
      medianDailyVolume20: round(median(volumes)),
      zeroVolumeDays20: volumes.filter((value) => value === 0).length,
      averageDailyValueProxy20: round(average(window20.map((candle) => candle.close * candle.volume)), 2),
      latestVolumeRatio20: latest && averageBaseline20 ? round(latest.volume / averageBaseline20, 4) : null,
      providerVolumeUnit: "provider_raw_unit",
      valueProxyFormula: "close_x_provider_volume",
      futureCandleExcludedCount,
      limitations: [
        "成交额仅为收盘价乘提供方原始成交量的可比代理，不声明为真实人民币成交额。",
        "缺少盘口价差、申赎状态和提供方成交量单位核验，不能据此解除执行质量硬门控。"
      ]
    },
    tracking: { status: "unavailable", benchmarkSymbol: null, trackingError: null, missingReason: "尚未取得基金合同确认的跟踪指数及同口径净值序列。" },
    premiumDiscount: { status: "unavailable", nav: null, iopv: null, premiumDiscountPct: null, missingReason: "尚未取得带截止时间的 NAV/IOPV，禁止用市价自行推断折溢价。" },
    fundSize: { status: "unavailable", assetsUnderManagement: null, sharesOutstanding: null, missingReason: "尚未取得可追溯的最新基金规模和份额数据。" },
    holdingsExposure: { status: "unavailable", asOf: null, topHoldings: [], industryExposure: [], missingReason: "尚未取得带报告期的持仓和行业暴露。" },
    managerDisclosures: { status: "unavailable", checkedAt: null, items: [], missingReason: "尚未接入基金管理人或交易所公告目录。" },
    missingFields,
    entryBlockers: ["ETF 跟踪指数、规模、NAV/IOPV、折溢价、持仓暴露、管理人公告及可执行流动性证据尚未闭合，禁止新增仓位。"]
  };
}

function average(values: number[]) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function median(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function round(value: number | null, digits = 4) {
  if (value === null || !Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
