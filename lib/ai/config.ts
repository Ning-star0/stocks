import { prisma } from "@/lib/prisma";

export interface AiConfigData {
  apiKey: string;
  baseUrl: string;
  model: string;
}

let cached: AiConfigData | null = null;
let cachedAt = 0;

export async function getAiConfig(): Promise<AiConfigData> {
  if (cached && Date.now() - cachedAt < 30_000) return cached;

  try {
    const row = await prisma.aiConfig.findFirst();
    if (row && row.apiKey) {
      cached = { apiKey: row.apiKey, baseUrl: row.baseUrl, model: row.model };
      cachedAt = Date.now();
      return cached;
    }
  } catch {
    // DB 不可用时 fallback
  }

  return {
    apiKey: process.env.OPENAI_API_KEY?.trim() ?? "",
    baseUrl: process.env.OPENAI_BASE_URL?.trim() || "https://api.deepseek.com",
    model: process.env.OPENAI_MODEL?.trim() || "deepseek-v4-pro"
  };
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
