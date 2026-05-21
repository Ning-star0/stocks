import { prisma } from "@/lib/prisma";

export interface AiConfigData {
  apiKey: string;
  baseUrl: string;
  model: string;
}

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

  try {
    const row = await prisma.aiConfig.findFirst();
    if (row) {
      if (row.apiKey) dbApiKey = row.apiKey;
      if (row.baseUrl) dbBaseUrl = row.baseUrl;
      if (row.model) dbModel = row.model;
    }
  } catch {
    // DB 不可用时 fallback
  }

  const apiKey = normalizeAiApiKey(dbApiKey ?? process.env.OPENAI_API_KEY ?? "");
  const model = normalizeAiModel(dbModel ?? process.env.OPENAI_MODEL);
  const baseUrl = normalizeAiBaseUrl(dbBaseUrl ?? process.env.OPENAI_BASE_URL);

  cached = { apiKey, baseUrl, model };
  cachedAt = Date.now();
  return cached;
}

export async function updateAiConfig(data: AiConfigData): Promise<AiConfigData> {
  const normalized = {
    apiKey: normalizeAiApiKey(data.apiKey),
    baseUrl: normalizeAiBaseUrl(data.baseUrl),
    model: normalizeAiModel(data.model)
  };
  const existing = await prisma.aiConfig.findFirst();
  const row = existing
    ? await prisma.aiConfig.update({ where: { id: existing.id }, data: normalized })
    : await prisma.aiConfig.create({ data: normalized });

  cached = { apiKey: row.apiKey, baseUrl: row.baseUrl, model: row.model };
  cachedAt = Date.now();
  return cached;
}
