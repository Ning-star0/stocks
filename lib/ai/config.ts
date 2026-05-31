import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export interface AiConfigData {
  apiKey: string;
  baseUrl: string;
  model: string;
  provider: string;
  flagshipModel: string;
  standardModel: string;
  flagshipInputPricePerMillion: number;
  flagshipOutputPricePerMillion: number;
  standardInputPricePerMillion: number;
  standardOutputPricePerMillion: number;
  costCurrency: string;
  focusStockAnalysisConcurrency: number;
}

export type AiModelTier = "flagship" | "standard";

// 30 秒内的重复查询直接走内存，不给 DB 压力
let cached: AiConfigData | null = null;
let cachedAt = 0;

// 防止之前 bug：邮箱地址被误存成 API 地址
function isValidBaseUrl(url: string): boolean {
  return url.startsWith("https://") || url.startsWith("http://");
}

export function normalizeAiBaseUrl(value?: string | null) {
  const baseUrl = String(value ?? "").trim().replace(/\/+$/, "");
  return isValidBaseUrl(baseUrl) ? baseUrl : "https://api.deepseek.com";
}

export function normalizeAiModel(value?: string | null) {
  return String(value ?? "").trim() || "deepseek-v4-pro";
}

export function normalizeStandardAiModel(value?: string | null) {
  return String(value ?? "").trim() || "deepseek-v4-flash";
}

export function normalizeAiProvider(value?: string | null) {
  const provider = String(value ?? "").trim().toLowerCase();
  return provider || "deepseek";
}

export function normalizeCostCurrency(value?: string | null) {
  const currency = String(value ?? "").trim().toUpperCase();
  return currency || "CNY";
}

export function normalizeTokenPrice(value?: string | number | null) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

export function normalizeFocusStockAnalysisConcurrency(value?: string | number | null) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(5, Math.max(1, number)) : 5;
}

export function normalizeAiApiKey(value?: string | null) {
  const apiKey = String(value ?? "").trim().replace(/^["']|["']$/g, "");
  if (!apiKey || apiKey.includes("***") || apiKey.includes("CHANGE_ME") || apiKey.includes("@")) return "";
  return apiKey;
}

export async function getAiConfig(): Promise<AiConfigData> {
  if (cached && Date.now() - cachedAt < 30_000) return cached;

  // 每个字段独立 fallback：DB 有值则用 DB，没有则用 .env 默认
  let dbApiKey: string | undefined;
  let dbBaseUrl: string | undefined;
  let dbModel: string | undefined;
  let dbProvider: string | undefined;
  let dbFlagshipModel: string | undefined;
  let dbStandardModel: string | undefined;
  let dbFlagshipInputPrice: number | undefined;
  let dbFlagshipOutputPrice: number | undefined;
  let dbStandardInputPrice: number | undefined;
  let dbStandardOutputPrice: number | undefined;
  let dbCostCurrency: string | undefined;
  let dbFocusStockAnalysisConcurrency: number | undefined;

  try {
    const row = await prisma.aiConfig.findFirst();
    if (row) {
      if (row.apiKey) dbApiKey = row.apiKey;
      if (row.baseUrl) dbBaseUrl = row.baseUrl;
      if (row.model) dbModel = row.model;
      if (row.provider) dbProvider = row.provider;
      if (row.flagshipModel) dbFlagshipModel = row.flagshipModel;
      if (row.standardModel) dbStandardModel = row.standardModel;
      dbFlagshipInputPrice = decimalToNumber(row.flagshipInputPricePerMillion);
      dbFlagshipOutputPrice = decimalToNumber(row.flagshipOutputPricePerMillion);
      dbStandardInputPrice = decimalToNumber(row.standardInputPricePerMillion);
      dbStandardOutputPrice = decimalToNumber(row.standardOutputPricePerMillion);
      if (row.costCurrency) dbCostCurrency = row.costCurrency;
      dbFocusStockAnalysisConcurrency = row.focusStockAnalysisConcurrency;
    }
  } catch {
    // DB 不可用时 fallback
  }

  const apiKey = normalizeAiApiKey(dbApiKey ?? process.env.OPENAI_API_KEY ?? "");
  const flagshipModel = normalizeAiModel(dbFlagshipModel ?? dbModel ?? process.env.OPENAI_MODEL);
  const standardModel = normalizeStandardAiModel(dbStandardModel ?? process.env.OPENAI_STANDARD_MODEL);
  const model = flagshipModel;
  const baseUrl = normalizeAiBaseUrl(dbBaseUrl ?? process.env.OPENAI_BASE_URL);
  const provider = normalizeAiProvider(dbProvider ?? process.env.AI_PROVIDER ?? inferProviderFromBaseUrl(baseUrl));

  cached = {
    apiKey,
    baseUrl,
    model,
    provider,
    flagshipModel,
    standardModel,
    flagshipInputPricePerMillion: normalizeTokenPrice(dbFlagshipInputPrice ?? process.env.AI_FLAGSHIP_INPUT_PRICE_PER_MILLION),
    flagshipOutputPricePerMillion: normalizeTokenPrice(dbFlagshipOutputPrice ?? process.env.AI_FLAGSHIP_OUTPUT_PRICE_PER_MILLION),
    standardInputPricePerMillion: normalizeTokenPrice(dbStandardInputPrice ?? process.env.AI_STANDARD_INPUT_PRICE_PER_MILLION),
    standardOutputPricePerMillion: normalizeTokenPrice(dbStandardOutputPrice ?? process.env.AI_STANDARD_OUTPUT_PRICE_PER_MILLION),
    costCurrency: normalizeCostCurrency(dbCostCurrency ?? process.env.AI_COST_CURRENCY),
    focusStockAnalysisConcurrency: normalizeFocusStockAnalysisConcurrency(dbFocusStockAnalysisConcurrency ?? process.env.FOCUS_STOCK_ANALYSIS_CONCURRENT)
  };
  cachedAt = Date.now();
  return cached;
}

export async function updateAiConfig(data: AiConfigData): Promise<AiConfigData> {
  const normalized = {
    apiKey: normalizeAiApiKey(data.apiKey),
    baseUrl: normalizeAiBaseUrl(data.baseUrl),
    model: normalizeAiModel(data.flagshipModel || data.model),
    provider: normalizeAiProvider(data.provider),
    flagshipModel: normalizeAiModel(data.flagshipModel || data.model),
    standardModel: normalizeStandardAiModel(data.standardModel),
    flagshipInputPricePerMillion: normalizeTokenPrice(data.flagshipInputPricePerMillion),
    flagshipOutputPricePerMillion: normalizeTokenPrice(data.flagshipOutputPricePerMillion),
    standardInputPricePerMillion: normalizeTokenPrice(data.standardInputPricePerMillion),
    standardOutputPricePerMillion: normalizeTokenPrice(data.standardOutputPricePerMillion),
    costCurrency: normalizeCostCurrency(data.costCurrency),
    focusStockAnalysisConcurrency: normalizeFocusStockAnalysisConcurrency(data.focusStockAnalysisConcurrency)
  };
  const existing = await prisma.aiConfig.findFirst();
  const row = existing
    ? await prisma.aiConfig.update({ where: { id: existing.id }, data: normalized })
    : await prisma.aiConfig.create({ data: normalized });

  cached = {
    apiKey: row.apiKey,
    baseUrl: row.baseUrl,
    model: row.model,
    provider: row.provider,
    flagshipModel: row.flagshipModel,
    standardModel: row.standardModel,
    flagshipInputPricePerMillion: decimalToNumber(row.flagshipInputPricePerMillion),
    flagshipOutputPricePerMillion: decimalToNumber(row.flagshipOutputPricePerMillion),
    standardInputPricePerMillion: decimalToNumber(row.standardInputPricePerMillion),
    standardOutputPricePerMillion: decimalToNumber(row.standardOutputPricePerMillion),
    costCurrency: row.costCurrency,
    focusStockAnalysisConcurrency: row.focusStockAnalysisConcurrency
  };
  cachedAt = Date.now();
  return cached;
}

export function selectAiModel(config: AiConfigData, tier: AiModelTier) {
  return tier === "standard" ? config.standardModel : config.flagshipModel;
}

export async function getFocusStockAnalysisConcurrency() {
  const config = await getAiConfig();
  return config.focusStockAnalysisConcurrency;
}

export function estimateAiCost(input: {
  config: AiConfigData;
  tier: AiModelTier;
  promptTokens?: number | null;
  completionTokens?: number | null;
}) {
  const promptTokens = Math.max(0, Number(input.promptTokens ?? 0));
  const completionTokens = Math.max(0, Number(input.completionTokens ?? 0));
  const inputPrice = input.tier === "standard" ? input.config.standardInputPricePerMillion : input.config.flagshipInputPricePerMillion;
  const outputPrice = input.tier === "standard" ? input.config.standardOutputPricePerMillion : input.config.flagshipOutputPricePerMillion;
  const cost = (promptTokens / 1_000_000) * inputPrice + (completionTokens / 1_000_000) * outputPrice;
  return Number.isFinite(cost) ? cost.toFixed(8) : "0";
}

function inferProviderFromBaseUrl(baseUrl: string) {
  if (baseUrl.includes("deepseek.com")) return "deepseek";
  if (baseUrl.includes("openai.com")) return "openai";
  return "openai-compatible";
}

function decimalToNumber(value: Prisma.Decimal | number | string | null | undefined) {
  if (value === null || value === undefined) return 0;
  const number = typeof value === "object" && "toNumber" in value ? value.toNumber() : Number(value);
  return Number.isFinite(number) ? number : 0;
}
