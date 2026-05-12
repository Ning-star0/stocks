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

  const apiKey = dbApiKey ?? process.env.OPENAI_API_KEY?.trim() ?? "";
  const model = dbModel ?? process.env.OPENAI_MODEL?.trim() ?? "deepseek-v4-pro";
  let baseUrl = dbBaseUrl ?? process.env.OPENAI_BASE_URL?.trim() ?? "";
  if (!isValidBaseUrl(baseUrl)) {
    baseUrl = "https://api.deepseek.com";
  }

  cached = { apiKey, baseUrl, model };
  cachedAt = Date.now();
  return cached;
}

export async function updateAiConfig(data: AiConfigData): Promise<AiConfigData> {
  const existing = await prisma.aiConfig.findFirst();
  const row = existing
    ? await prisma.aiConfig.update({ where: { id: existing.id }, data })
    : await prisma.aiConfig.create({ data });

  cached = { apiKey: row.apiKey, baseUrl: row.baseUrl, model: row.model };
  cachedAt = Date.now();
  return cached;
}
