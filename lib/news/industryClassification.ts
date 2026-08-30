import { createHash } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { sameStockSymbol, stockSymbolVariants } from "@/lib/symbols";

export const NEWS_INDUSTRY_CLASSIFICATION_SCHEMA_VERSION = "news-industry-classification-v1";
export const NEWS_INDUSTRY_CLASSIFICATION_MAX_AGE_HOURS = 24;

export type NewsIndustryClassificationStatus = "verified" | "missing" | "stale" | "conflicted";

export type NewsIndustryClassificationEvidence = {
  schemaVersion: typeof NEWS_INDUSTRY_CLASSIFICATION_SCHEMA_VERSION;
  status: NewsIndustryClassificationStatus;
  symbol: string;
  industryName: string | null;
  provider: "EASTMONEY" | null;
  classificationMethod: "EASTMONEY_EM2016" | null;
  classificationSourceUrl: string | null;
  fetchedAt: string | null;
  validUntil: string | null;
  maximumAgeHours: number;
  sourceEvidenceHash: string | null;
  evidenceHash: string | null;
  missingReason: string | null;
};

type StoredIndustryInput = {
  symbol: string;
  fundamentalsJson: unknown;
  asOf?: Date;
};

export function resolveStoredIndustryClassification(input: StoredIndustryInput): NewsIndustryClassificationEvidence {
  const symbol = input.symbol.trim().toUpperCase();
  const asOf = input.asOf ?? new Date();
  const peer = readPeerEvidence(input.fundamentalsJson);
  if (!peer) return unavailable(symbol, "missing", "尚未保存可用于新闻分组的同行行业证据。");

  const schemaVersion = readString(peer.schemaVersion);
  const provider = readString(peer.provider);
  const classificationMethod = readString(peer.classificationMethod);
  const targetSymbol = readString(peer.targetSymbol);
  const industryName = normalizeIndustryName(peer.industryName);
  const classificationSourceUrl = readString(peer.classificationSourceUrl);
  const fetchedAt = readTimestamp(peer.fetchedAt);
  const sourceEvidenceHash = readSha256(peer.contentHash);

  const structuralFailures = [
    ...(schemaVersion !== "peer-valuation-v1" ? ["行业证据 schema 不是 peer-valuation-v1"] : []),
    ...(provider !== "EASTMONEY" ? ["行业证据提供方不是 EASTMONEY"] : []),
    ...(classificationMethod !== "EASTMONEY_EM2016" ? ["行业分类方法不是 EASTMONEY_EM2016"] : []),
    ...(!targetSymbol || !sameStockSymbol(targetSymbol, symbol) ? ["行业证据股票与当前股票不一致"] : []),
    ...(!industryName ? ["行业名称缺失或不合法"] : []),
    ...(!classificationSourceUrl || !isVerifiedClassificationUrl(classificationSourceUrl, targetSymbol ?? symbol)
      ? ["行业分类来源 URL 未通过白名单和代码核对"]
      : []),
    ...(!fetchedAt ? ["行业分类抓取时间缺失或不合法"] : [])
  ];
  if (structuralFailures.length) {
    return {
      ...unavailable(symbol, "conflicted", structuralFailures.join("；")),
      industryName,
      classificationSourceUrl,
      fetchedAt
    };
  }

  const fetchedMs = Date.parse(fetchedAt!);
  const ageMs = asOf.getTime() - fetchedMs;
  const validUntil = new Date(fetchedMs + NEWS_INDUSTRY_CLASSIFICATION_MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();
  if (ageMs < 0) {
    return {
      ...unavailable(symbol, "conflicted", "行业分类抓取时间晚于本次新闻检索截止时间，禁止使用未来证据。"),
      industryName,
      provider: "EASTMONEY",
      classificationMethod: "EASTMONEY_EM2016",
      classificationSourceUrl,
      fetchedAt,
      validUntil,
      sourceEvidenceHash
    };
  }
  if (ageMs > NEWS_INDUSTRY_CLASSIFICATION_MAX_AGE_HOURS * 60 * 60 * 1000) {
    return {
      ...unavailable(symbol, "stale", `行业分类已超过 ${NEWS_INDUSTRY_CLASSIFICATION_MAX_AGE_HOURS} 小时时效。`),
      industryName,
      provider: "EASTMONEY",
      classificationMethod: "EASTMONEY_EM2016",
      classificationSourceUrl,
      fetchedAt,
      validUntil,
      sourceEvidenceHash
    };
  }

  const normalized = {
    schemaVersion: NEWS_INDUSTRY_CLASSIFICATION_SCHEMA_VERSION,
    symbol: targetSymbol!.toUpperCase(),
    industryName,
    provider: "EASTMONEY",
    classificationMethod: "EASTMONEY_EM2016",
    classificationSourceUrl,
    fetchedAt,
    sourceEvidenceHash
  } as const;
  return {
    ...normalized,
    status: "verified",
    symbol,
    validUntil,
    maximumAgeHours: NEWS_INDUSTRY_CLASSIFICATION_MAX_AGE_HOURS,
    evidenceHash: createHash("sha256").update(JSON.stringify(normalized)).digest("hex"),
    missingReason: null
  };
}

export async function loadStoredIndustryClassifications(input: {
  userId: string;
  symbols: string[];
  asOf?: Date;
}) {
  const symbols = [...new Set(input.symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
  const variants = [...new Set(symbols.flatMap(stockSymbolVariants))];
  const rows = variants.length
    ? await prisma.stockEvidenceState.findMany({
        where: { userId: input.userId, symbol: { in: variants } },
        select: { symbol: true, fundamentalsJson: true, fundamentalsRefreshAt: true },
        orderBy: { fundamentalsRefreshAt: "desc" }
      })
    : [];
  const output = new Map<string, NewsIndustryClassificationEvidence>();
  for (const symbol of symbols) {
    const row = rows.find((candidate) => sameStockSymbol(candidate.symbol, symbol));
    output.set(symbol, resolveStoredIndustryClassification({
      symbol,
      fundamentalsJson: row?.fundamentalsJson ?? null,
      asOf: input.asOf
    }));
  }
  return output;
}

export async function loadStoredIndustryClassification(input: {
  userId: string;
  symbol: string;
  asOf?: Date;
}) {
  const symbol = input.symbol.trim().toUpperCase();
  const results = await loadStoredIndustryClassifications({
    userId: input.userId,
    symbols: [symbol],
    asOf: input.asOf
  });
  return results.get(symbol) ?? unavailable(symbol, "missing", "尚未保存行业分类证据。");
}

function readPeerEvidence(value: unknown): Record<string, unknown> | null {
  const fundamentals = readRecord(value);
  const valuation = readRecord(fundamentals?.valuation);
  return readRecord(valuation?.peerEvidence);
}

function isVerifiedClassificationUrl(value: string, targetSymbol: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "emweb.securities.eastmoney.com") return false;
    if (url.username || url.password || url.pathname !== "/PC_HSF10/CompanySurvey/PageAjax") return false;
    const target = targetSymbol.trim().toUpperCase();
    const [code, exchange] = target.split(".");
    if (!/^\d{6}$/.test(code) || !/^(SH|SZ|BJ)$/.test(exchange)) return false;
    return url.searchParams.get("code")?.toUpperCase() === `${exchange}${code}`;
  } catch {
    return false;
  }
}

function normalizeIndustryName(value: unknown) {
  const name = readString(value)?.replace(/\s+/g, " ").trim() ?? null;
  if (!name || name.length < 2 || name.length > 80) return null;
  if (/^(未知|未知行业|其他|行业中值|行业平均)$/i.test(name)) return null;
  if (/[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

function unavailable(
  symbol: string,
  status: Exclude<NewsIndustryClassificationStatus, "verified">,
  missingReason: string
): NewsIndustryClassificationEvidence {
  return {
    schemaVersion: NEWS_INDUSTRY_CLASSIFICATION_SCHEMA_VERSION,
    status,
    symbol,
    industryName: null,
    provider: null,
    classificationMethod: null,
    classificationSourceUrl: null,
    fetchedAt: null,
    validUntil: null,
    maximumAgeHours: NEWS_INDUSTRY_CLASSIFICATION_MAX_AGE_HOURS,
    sourceEvidenceHash: null,
    evidenceHash: null,
    missingReason
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readTimestamp(value: unknown) {
  const text = readString(value);
  return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : null;
}

function readSha256(value: unknown) {
  const text = readString(value)?.toLowerCase() ?? null;
  return text && /^[a-f0-9]{64}$/.test(text) ? text : null;
}
