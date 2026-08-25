import { createHash } from "node:crypto";

import { rememberWithStatus } from "@/lib/cache";
import { AppError } from "@/lib/errors";
import { readProviderJsonResponse } from "@/lib/httpJson";
import type {
  FundamentalEvidence,
  PeerValuationComparable,
  PeerValuationEvidence,
  PeerValuationMetricComparison
} from "@/lib/stock-data/types";

const CACHE_TTL_SECONDS = 60 * 60;
const MAXIMUM_AGE_HOURS = 24;
const MINIMUM_SAMPLE_SIZE = 5;
const MAXIMUM_CROSS_CHECK_DIFFERENCE_PCT = 15;
const REQUEST_TIMEOUT_MS = 8_000;

type EastMoneyPeerRow = {
  CORRE_SECUCODE?: unknown;
  CORRE_SECURITY_NAME?: unknown;
  PE_TTM?: unknown;
  PB_MRQ?: unknown;
  PAIMING?: unknown;
  REPORT_DATE?: unknown;
};

type EastMoneyPeerPayload = {
  gzbj?: EastMoneyPeerRow[] | null;
};

type EastMoneyCompanyProfile = {
  SECUCODE?: unknown;
  SECURITY_NAME_ABBR?: unknown;
  EM2016?: unknown;
};

type EastMoneyCompanySurveyPayload = {
  jbzl?: EastMoneyCompanyProfile | EastMoneyCompanyProfile[] | null;
};

export async function fetchEastMoneyPeerValuationEvidence(input: {
  symbol: string;
  forceRefresh?: boolean;
}): Promise<PeerValuationEvidence> {
  const targetSymbol = normalizeSymbol(input.symbol);
  const f10Code = toF10Code(targetSymbol);
  const sourceUrl = peerSourceUrl(f10Code);
  const classificationSourceUrl = classificationUrl(f10Code);
  try {
    const receipt = await rememberWithStatus(
      `peer-valuation:v1:${f10Code}`,
      CACHE_TTL_SECONDS,
      async () => {
        const [peerPayload, surveyPayload] = await Promise.all([
          fetchJson<EastMoneyPeerPayload>(sourceUrl, "东方财富同行估值"),
          fetchJson<EastMoneyCompanySurveyPayload>(classificationSourceUrl, "东方财富行业分类")
        ]);
        return buildEastMoneyPeerValuationEvidence({
          targetSymbol,
          fetchedAt: new Date().toISOString(),
          sourceUrl,
          classificationSourceUrl,
          peerPayload,
          surveyPayload
        });
      },
      { bypassCache: input.forceRefresh }
    );
    return receipt.value;
  } catch (error) {
    return emptyPeerEvidence({
      targetSymbol,
      fetchedAt: new Date().toISOString(),
      sourceUrl,
      classificationSourceUrl,
      missingReason: errorMessage(error)
    });
  }
}

export function buildEastMoneyPeerValuationEvidence(input: {
  targetSymbol: string;
  fetchedAt: string;
  sourceUrl: string;
  classificationSourceUrl: string;
  peerPayload: EastMoneyPeerPayload;
  surveyPayload: EastMoneyCompanySurveyPayload;
}): PeerValuationEvidence {
  const targetSymbol = normalizeSymbol(input.targetSymbol);
  const rows = Array.isArray(input.peerPayload.gzbj) ? input.peerPayload.gzbj : [];
  const profile = Array.isArray(input.surveyPayload.jbzl)
    ? input.surveyPayload.jbzl[0]
    : input.surveyPayload.jbzl;
  const industryName = readString(profile?.EM2016);
  const targetRow = rows.find((row) => normalizeProviderSymbol(row.CORRE_SECUCODE) === targetSymbol) ?? null;
  const providerMedianRow = rows.find((row) => readString(row.CORRE_SECUCODE) === "行业中值") ?? null;
  const comparables = rows
    .filter((row) => {
      const symbol = normalizeProviderSymbol(row.CORRE_SECUCODE);
      const name = readString(row.CORRE_SECURITY_NAME);
      return Boolean(symbol && symbol !== targetSymbol && name && !/(?:^|\*)ST/i.test(name));
    })
    .map(toComparable)
    .sort((a, b) => (a.providerRank ?? Number.MAX_SAFE_INTEGER) - (b.providerRank ?? Number.MAX_SAFE_INTEGER) || a.symbol.localeCompare(b.symbol));
  const targetPeTtm = readPositiveNumber(targetRow?.PE_TTM);
  const targetPbMrq = readPositiveNumber(targetRow?.PB_MRQ);
  const peComparison = buildComparison(
    targetPeTtm,
    comparables.map((peer) => peer.peTtm),
    readPositiveNumber(providerMedianRow?.PE_TTM)
  );
  const pbComparison = buildComparison(
    targetPbMrq,
    comparables.map((peer) => peer.pbMrq),
    readPositiveNumber(providerMedianRow?.PB_MRQ)
  );
  const reportPeriods = [targetRow, ...rows]
    .map((row) => readDate(row?.REPORT_DATE))
    .filter((value): value is string => Boolean(value));
  const targetName = readString(targetRow?.CORRE_SECURITY_NAME) ?? readString(profile?.SECURITY_NAME_ABBR);
  const reasons = [
    ...(!industryName ? ["未取得东方财富 EM2016 行业分类"] : []),
    ...(!targetRow ? ["同行估值响应中未找到目标公司"] : []),
    ...(!peComparison && !pbComparison ? ["目标公司没有可比较的正 PE(TTM) 或 PB(MRQ)"] : []),
    ...(targetPeTtm !== null && (peComparison?.sampleSize ?? 0) < MINIMUM_SAMPLE_SIZE
      ? [`正 PE(TTM) 同行样本仅 ${peComparison?.sampleSize ?? 0}/${MINIMUM_SAMPLE_SIZE}`]
      : []),
    ...(targetPbMrq !== null && (pbComparison?.sampleSize ?? 0) < MINIMUM_SAMPLE_SIZE
      ? [`正 PB(MRQ) 同行样本仅 ${pbComparison?.sampleSize ?? 0}/${MINIMUM_SAMPLE_SIZE}`]
      : [])
  ];
  const normalizedForHash = {
    targetSymbol,
    targetName,
    industryName,
    targetPeTtm,
    targetPbMrq,
    financialReportPeriod: reportPeriods.sort().at(-1) ?? null,
    providerIndustryMedianPeTtm: readPositiveNumber(providerMedianRow?.PE_TTM),
    providerIndustryMedianPbMrq: readPositiveNumber(providerMedianRow?.PB_MRQ),
    comparables
  };

  return {
    schemaVersion: "peer-valuation-v1",
    algorithmVersion: "eastmoney-provider-ranked-positive-multiples-v1",
    // A same-provider cross-check against the deterministic CNINFO valuation is
    // required before this evidence is allowed to open the long-term gate.
    status: rows.length ? "partial" : "unavailable",
    provider: "EASTMONEY",
    sourceUrl: input.sourceUrl,
    classificationSourceUrl: input.classificationSourceUrl,
    fetchedAt: input.fetchedAt,
    maximumAgeHours: MAXIMUM_AGE_HOURS,
    industryName,
    classificationMethod: "EASTMONEY_EM2016",
    selectionMethod: "EASTMONEY_INDUSTRY_COMPARABLE_RANK",
    peBasis: "PE_TTM",
    pbBasis: "PB_MRQ",
    minimumSampleSize: MINIMUM_SAMPLE_SIZE,
    targetSymbol,
    targetName,
    targetPeTtm,
    targetPbMrq,
    financialReportPeriod: reportPeriods.sort().at(-1) ?? null,
    peComparison,
    pbComparison,
    comparables,
    crossCheck: {
      maximumDifferencePct: MAXIMUM_CROSS_CHECK_DIFFERENCE_PCT,
      peDifferencePct: null,
      pbDifferencePct: null,
      peMatched: null,
      pbMatched: null
    },
    contentHash: rows.length ? createHash("sha256").update(JSON.stringify(normalizedForHash)).digest("hex") : null,
    missingReason: reasons.length ? reasons.join("；") : "等待与巨潮口径的当前 PE/PB 交叉核对。"
  };
}

export function mergePeerValuationEvidence(
  fundamentals: FundamentalEvidence,
  evidence: PeerValuationEvidence
): FundamentalEvidence {
  const peDifferencePct = relativeDifferencePct(evidence.targetPeTtm, fundamentals.valuation.peTtm);
  const pbDifferencePct = relativeDifferencePct(evidence.targetPbMrq, fundamentals.valuation.pb);
  const peMatched = peDifferencePct === null ? null : peDifferencePct <= MAXIMUM_CROSS_CHECK_DIFFERENCE_PCT;
  const pbMatched = pbDifferencePct === null ? null : pbDifferencePct <= MAXIMUM_CROSS_CHECK_DIFFERENCE_PCT;
  const hasConflict = peMatched === false || pbMatched === false;
  const presentComparisons = [evidence.peComparison, evidence.pbComparison]
    .filter((comparison): comparison is PeerValuationMetricComparison => comparison !== null);
  const hasQualifiedComparison = presentComparisons.length > 0
    && presentComparisons.every((comparison) => comparison.sampleSize >= evidence.minimumSampleSize);
  const hasMatchedCrossCheck = peMatched === true || pbMatched === true;
  const status: PeerValuationEvidence["status"] = hasConflict
    ? "conflicted"
    : evidence.industryName && hasQualifiedComparison && hasMatchedCrossCheck
      ? "available"
      : evidence.comparables.length || evidence.targetPeTtm !== null || evidence.targetPbMrq !== null
        ? "partial"
        : "unavailable";
  const reasons = [
    ...(evidence.missingReason && evidence.missingReason !== "等待与巨潮口径的当前 PE/PB 交叉核对。" ? [evidence.missingReason] : []),
    ...(!hasMatchedCrossCheck && !hasConflict ? ["目标公司 PE/PB 无法与巨潮确定性口径交叉核对"] : []),
    ...(peMatched === false ? [`PE(TTM) 跨源差异 ${formatPct(peDifferencePct)} 超过 ${MAXIMUM_CROSS_CHECK_DIFFERENCE_PCT}%`] : []),
    ...(pbMatched === false ? [`PB(MRQ) 跨源差异 ${formatPct(pbDifferencePct)} 超过 ${MAXIMUM_CROSS_CHECK_DIFFERENCE_PCT}%`] : [])
  ];
  const peerEvidence: PeerValuationEvidence = {
    ...evidence,
    status,
    crossCheck: {
      maximumDifferencePct: MAXIMUM_CROSS_CHECK_DIFFERENCE_PCT,
      peDifferencePct,
      pbDifferencePct,
      peMatched,
      pbMatched
    },
    missingReason: status === "available" ? null : reasons.join("；") || "同行估值证据未满足完整性门槛。"
  };
  const missingFields = fundamentals.missingFields.filter((field) => field !== "peerValuation");
  if (status !== "available") missingFields.push("peerValuation");
  const conflictingFields = fundamentals.conflictingFields.filter((field) => field !== "peerValuationCurrentMultipleMismatch");
  if (status === "conflicted") conflictingFields.push("peerValuationCurrentMultipleMismatch");
  const uniqueMissingFields = uniqueStrings(missingFields);
  const uniqueConflictingFields = uniqueStrings(conflictingFields);
  const peerSampleSize = Math.max(evidence.peComparison?.sampleSize ?? 0, evidence.pbComparison?.sampleSize ?? 0);

  return {
    ...fundamentals,
    status: fundamentals.status === "unavailable"
      ? "unavailable"
      : uniqueMissingFields.length || uniqueConflictingFields.length
        ? "partial"
        : "available",
    valuation: {
      ...fundamentals.valuation,
      peerEvidence
    },
    metrics: {
      ...fundamentals.metrics,
      peerValuationSampleSize: peerSampleSize,
      peerPeTtmMedian: evidence.peComparison?.sampleMedian ?? null,
      peerPbMrqMedian: evidence.pbComparison?.sampleMedian ?? null,
      peerPeTtmPercentile: evidence.peComparison?.percentile ?? null,
      peerPbMrqPercentile: evidence.pbComparison?.percentile ?? null,
      peerPeTtmPremiumDiscountPct: evidence.peComparison?.premiumDiscountPct ?? null,
      peerPbMrqPremiumDiscountPct: evidence.pbComparison?.premiumDiscountPct ?? null
    },
    missingFields: uniqueMissingFields,
    conflictingFields: uniqueConflictingFields,
    failures: uniqueStrings([
      ...fundamentals.failures,
      ...(evidence.status === "unavailable" && evidence.missingReason ? [`同行估值：${evidence.missingReason}`] : [])
    ]),
    missingReason: uniqueMissingFields.length ? `尚缺：${uniqueMissingFields.join("、")}` : null
  };
}

export function isPeerValuationFresh(evidence: PeerValuationEvidence | null | undefined, now = new Date()) {
  if (!evidence) return false;
  const fetchedAt = Date.parse(evidence.fetchedAt);
  if (!Number.isFinite(fetchedAt)) return false;
  const ageMs = now.getTime() - fetchedAt;
  return ageMs >= 0 && ageMs <= evidence.maximumAgeHours * 60 * 60 * 1000;
}

function buildComparison(
  target: number | null,
  values: Array<number | null>,
  providerIndustryMedian: number | null
): PeerValuationMetricComparison | null {
  if (target === null) return null;
  const samples = values.filter((value): value is number => value !== null && Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!samples.length) return null;
  const sampleMedian = median(samples);
  let less = 0;
  let equal = 0;
  for (const sample of samples) {
    if (sample < target) less += 1;
    else if (Math.abs(sample - target) <= Math.max(1e-8, Math.abs(target) * 1e-8)) equal += 1;
  }
  return {
    target: round(target),
    sampleMedian: round(sampleMedian),
    providerIndustryMedian: providerIndustryMedian === null ? null : round(providerIndustryMedian),
    percentile: round(((less + equal * 0.5) / samples.length) * 100, 2),
    premiumDiscountPct: round(((target / sampleMedian) - 1) * 100, 2),
    sampleSize: samples.length
  };
}

function toComparable(row: EastMoneyPeerRow): PeerValuationComparable {
  return {
    symbol: normalizeProviderSymbol(row.CORRE_SECUCODE)!,
    name: readString(row.CORRE_SECURITY_NAME)!,
    peTtm: readPositiveNumber(row.PE_TTM),
    pbMrq: readPositiveNumber(row.PB_MRQ),
    providerRank: readInteger(row.PAIMING),
    reportPeriod: readDate(row.REPORT_DATE)
  };
}

function emptyPeerEvidence(input: {
  targetSymbol: string;
  fetchedAt: string;
  sourceUrl: string;
  classificationSourceUrl: string;
  missingReason: string;
}): PeerValuationEvidence {
  return {
    schemaVersion: "peer-valuation-v1",
    algorithmVersion: "eastmoney-provider-ranked-positive-multiples-v1",
    status: "unavailable",
    provider: "EASTMONEY",
    sourceUrl: input.sourceUrl,
    classificationSourceUrl: input.classificationSourceUrl,
    fetchedAt: input.fetchedAt,
    maximumAgeHours: MAXIMUM_AGE_HOURS,
    industryName: null,
    classificationMethod: "EASTMONEY_EM2016",
    selectionMethod: "EASTMONEY_INDUSTRY_COMPARABLE_RANK",
    peBasis: "PE_TTM",
    pbBasis: "PB_MRQ",
    minimumSampleSize: MINIMUM_SAMPLE_SIZE,
    targetSymbol: input.targetSymbol,
    targetName: null,
    targetPeTtm: null,
    targetPbMrq: null,
    financialReportPeriod: null,
    peComparison: null,
    pbComparison: null,
    comparables: [],
    crossCheck: {
      maximumDifferencePct: MAXIMUM_CROSS_CHECK_DIFFERENCE_PCT,
      peDifferencePct: null,
      pbDifferencePct: null,
      peMatched: null,
      pbMatched: null
    },
    contentHash: null,
    missingReason: input.missingReason
  };
}

async function fetchJson<T>(url: string, source: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      "Accept-Encoding": "gzip, deflate, br",
      Referer: "https://emweb.securities.eastmoney.com/",
      "User-Agent": "Mozilla/5.0 (compatible; StockAIMonitor/1.0)"
    },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) throw new AppError("DATA_PROVIDER_ERROR", `${source}请求失败：${response.status}`);
  return readProviderJsonResponse<T>(response, source);
}

function peerSourceUrl(f10Code: string) {
  const url = new URL("https://emweb.securities.eastmoney.com/PC_HSF10/IndustryAnalysis/PageAjax");
  url.searchParams.set("code", f10Code);
  return url.toString();
}

function classificationUrl(f10Code: string) {
  const url = new URL("https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/PageAjax");
  url.searchParams.set("code", f10Code);
  return url.toString();
}

function normalizeSymbol(value: string) {
  const raw = value.trim().toUpperCase().replace(/\s+/g, "");
  const code = raw.replace(/^SH|^SZ|^BJ/, "").replace(/\.(SH|SZ|BJ)$/, "");
  if (!/^\d{6}$/.test(code)) throw new AppError("SYMBOL_NOT_FOUND", `无效 A 股代码：${value}`);
  const explicit = raw.match(/^(SH|SZ|BJ)/)?.[1] ?? raw.match(/\.(SH|SZ|BJ)$/)?.[1];
  const exchange = explicit ?? (/^(5|6|9)/.test(code) ? "SH" : "SZ");
  return `${code}.${exchange}`;
}

function toF10Code(symbol: string) {
  const [code, exchange] = symbol.split(".");
  return `${exchange}${code}`;
}

function normalizeProviderSymbol(value: unknown) {
  const text = readString(value)?.toUpperCase();
  if (!text || !/^\d{6}\.(SH|SZ|BJ)$/.test(text)) return null;
  return text;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readPositiveNumber(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) && number > 0 ? number : null;
}

function readInteger(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function readDate(value: unknown) {
  const text = readString(value);
  const date = text?.slice(0, 10) ?? null;
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function relativeDifferencePct(providerValue: number | null, deterministicValue: number | null) {
  if (providerValue === null || deterministicValue === null || deterministicValue <= 0) return null;
  return round((Math.abs(providerValue - deterministicValue) / deterministicValue) * 100, 2);
}

function median(values: number[]) {
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

function round(value: number, digits = 4) {
  return Number(value.toFixed(digits));
}

function formatPct(value: number | null) {
  return value === null ? "未知" : `${value.toFixed(2)}%`;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}
