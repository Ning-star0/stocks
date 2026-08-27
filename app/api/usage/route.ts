import { NextResponse } from "next/server";

import { getAiConfig } from "@/lib/ai/config";
import { getDeepSeekBalance } from "@/lib/ai/balance";
import { readQuota } from "@/lib/apiUsage";
import { quotaPolicy, quotaWindowStarts } from "@/lib/apiQuota";
import { getCurrentUser } from "@/lib/currentUser";
import { apiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

type UsageItem = {
  key: string;
  label: string;
  provider: string;
  usedToday: number;
  usedMonth: number;
  unit: string;
  dailyLimit: number | null;
  monthlyLimit: number | null;
  remainingToday: number | null;
  remainingMonth: number | null;
};

type ModelUsageItem = {
  model: string;
  usedToday: number;
  usedMonth: number;
  callsToday: number;
  callsMonth: number;
  promptTokensToday: number;
  promptTokensMonth: number;
  completionTokensToday: number;
  completionTokensMonth: number;
  cacheHitTokensToday: number;
  cacheHitTokensMonth: number;
  cacheMissTokensToday: number;
  cacheMissTokensMonth: number;
  estimatedCostToday: number;
  estimatedCostMonth: number;
};

export async function GET() {
  try {
    const user = await getCurrentUser();
    const now = new Date();
    const { dayStart: todayStart, monthStart } = quotaWindowStarts(now);

    const [aiConfig, aiToday, aiMonth, apiLogs, aiBalance] = await Promise.all([
      getAiConfig(),
      prisma.aiUsageLog.findMany({ where: { userId: user.id, createdAt: { gte: todayStart } } }),
      prisma.aiUsageLog.findMany({ where: { userId: user.id, createdAt: { gte: monthStart } } }),
      prisma.apiUsageLog.findMany({
        where: {
          createdAt: { gte: monthStart },
          OR: [{ userId: user.id }, { userId: null }]
        }
      }),
      getDeepSeekBalance()
    ]);

    const items: UsageItem[] = [
      buildAiCallsItem(aiToday.filter((row) => !row.cacheHit).length, aiMonth.filter((row) => !row.cacheHit).length),
      buildAiTokensItem(sumTokens(aiToday), sumTokens(aiMonth)),
      buildApiItem({
        key: "quote",
        label: "行情报价",
        provider: process.env.STOCK_DATA_PROVIDER || "mock",
        logs: apiLogs,
        apiName: "quote",
        dailyLimitEnv: "QUOTE_DAILY_CALL_LIMIT",
        monthlyLimitEnv: "QUOTE_MONTHLY_CALL_LIMIT"
      }),
      buildApiItem({
        key: "history",
        label: "历史 K 线",
        provider: process.env.STOCK_DATA_PROVIDER || "mock",
        logs: apiLogs,
        apiName: "history",
        dailyLimitEnv: "HISTORY_DAILY_CALL_LIMIT",
        monthlyLimitEnv: "HISTORY_MONTHLY_CALL_LIMIT"
      }),
      buildApiItem({
        key: "news",
        label: "新闻接口",
        provider: process.env.NEWS_PROVIDER || "mock",
        logs: apiLogs,
        apiName: "news",
        dailyLimitEnv: "NEWS_DAILY_CALL_LIMIT",
        monthlyLimitEnv: "NEWS_MONTHLY_CALL_LIMIT"
      }),
      buildApiItem({
        key: "web_search",
        label: "联网检索",
        provider: process.env.TAVILY_API_KEY ? "tavily" : "未配置",
        logs: apiLogs,
        apiName: "web_search",
        dailyLimitEnv: "WEB_SEARCH_DAILY_CALL_LIMIT",
        monthlyLimitEnv: "WEB_SEARCH_MONTHLY_CALL_LIMIT"
      })
    ];

    return NextResponse.json({
      generatedAt: now.toISOString(),
      period: {
        todayStart: todayStart.toISOString(),
        monthStart: monthStart.toISOString()
      },
      items,
      aiModels: buildAiModelItems(aiToday, aiMonth),
      aiCost: {
        currency: aiConfig.costCurrency,
        today: sumEstimatedCost(aiToday),
        month: sumEstimatedCost(aiMonth)
      },
      aiBalance
    });
  } catch (error) {
    return apiError(error);
  }
}

function buildAiCallsItem(usedToday: number, usedMonth: number): UsageItem {
  const dailyLimit = readQuota("AI_DAILY_CALL_LIMIT");
  const monthlyLimit = readQuota("AI_MONTHLY_CALL_LIMIT");
  return withRemaining({
    key: "ai_calls",
    label: "AI 调用",
    provider: process.env.OPENAI_MODEL || "openai-compatible",
    usedToday,
    usedMonth,
    unit: "次",
    dailyLimit,
    monthlyLimit
  });
}

function buildAiTokensItem(usedToday: number, usedMonth: number): UsageItem {
  const dailyLimit = readQuota("AI_DAILY_TOKEN_LIMIT");
  const monthlyLimit = readQuota("AI_MONTHLY_TOKEN_LIMIT");
  return withRemaining({
    key: "ai_tokens",
    label: "AI Token",
    provider: process.env.OPENAI_MODEL || "openai-compatible",
    usedToday,
    usedMonth,
    unit: "tokens",
    dailyLimit,
    monthlyLimit
  });
}

function buildApiItem(input: {
  key: string;
  label: string;
  provider: string;
  logs: Array<{ apiName: string; provider: string; status: string; amount: number; createdAt: Date }>;
  apiName: string;
  dailyLimitEnv: string;
  monthlyLimitEnv: string;
}): UsageItem {
  const now = new Date();
  const { dayStart: todayStart } = quotaWindowStarts(now);
  const matched = input.logs.filter((log) => log.apiName === input.apiName && log.status === "success");
  const policy = quotaPolicy(input.provider, input.apiName);
  return withRemaining({
    key: input.key,
    label: input.label,
    provider: input.provider,
    usedToday: sumAmount(matched.filter((log) => log.createdAt >= todayStart)),
    usedMonth: sumAmount(matched),
    unit: "次",
    dailyLimit: readQuota(input.dailyLimitEnv) ?? policy.dailyLimit,
    monthlyLimit: readQuota(input.monthlyLimitEnv) ?? policy.monthlyLimit
  });
}

function withRemaining(item: Omit<UsageItem, "remainingToday" | "remainingMonth">): UsageItem {
  return {
    ...item,
    remainingToday: item.dailyLimit === null ? null : Math.max(0, item.dailyLimit - item.usedToday),
    remainingMonth: item.monthlyLimit === null ? null : Math.max(0, item.monthlyLimit - item.usedMonth)
  };
}

function sumTokens(rows: Array<{ promptTokens: number | null; completionTokens: number | null }>) {
  return rows.reduce((sum, row) => sum + (row.promptTokens ?? 0) + (row.completionTokens ?? 0), 0);
}

function sumAmount(rows: Array<{ amount: number }>) {
  return rows.reduce((sum, row) => sum + row.amount, 0);
}

function buildAiModelItems(
  todayRows: Array<{ model: string; promptTokens: number | null; completionTokens: number | null; promptCacheHitTokens: number | null; promptCacheMissTokens: number | null; estimatedCost: unknown }>,
  monthRows: Array<{ model: string; promptTokens: number | null; completionTokens: number | null; promptCacheHitTokens: number | null; promptCacheMissTokens: number | null; estimatedCost: unknown }>
): ModelUsageItem[] {
  const byModel = new Map<string, ModelUsageItem>();
  const ensure = (model: string) => {
    const key = model || "unknown";
    const current = byModel.get(key);
    if (current) return current;
    const item: ModelUsageItem = {
      model: key,
      usedToday: 0,
      usedMonth: 0,
      callsToday: 0,
      callsMonth: 0,
      promptTokensToday: 0,
      promptTokensMonth: 0,
      completionTokensToday: 0,
      completionTokensMonth: 0,
      cacheHitTokensToday: 0,
      cacheHitTokensMonth: 0,
      cacheMissTokensToday: 0,
      cacheMissTokensMonth: 0,
      estimatedCostToday: 0,
      estimatedCostMonth: 0
    };
    byModel.set(key, item);
    return item;
  };

  for (const row of monthRows) {
    const item = ensure(row.model);
    const prompt = row.promptTokens ?? 0;
    const completion = row.completionTokens ?? 0;
    item.callsMonth += 1;
    item.promptTokensMonth += prompt;
    item.completionTokensMonth += completion;
    item.cacheHitTokensMonth += row.promptCacheHitTokens ?? 0;
    item.cacheMissTokensMonth += row.promptCacheMissTokens ?? 0;
    item.usedMonth += prompt + completion;
    item.estimatedCostMonth += decimalToNumber(row.estimatedCost);
  }

  for (const row of todayRows) {
    const item = ensure(row.model);
    const prompt = row.promptTokens ?? 0;
    const completion = row.completionTokens ?? 0;
    item.callsToday += 1;
    item.promptTokensToday += prompt;
    item.completionTokensToday += completion;
    item.cacheHitTokensToday += row.promptCacheHitTokens ?? 0;
    item.cacheMissTokensToday += row.promptCacheMissTokens ?? 0;
    item.usedToday += prompt + completion;
    item.estimatedCostToday += decimalToNumber(row.estimatedCost);
  }

  return Array.from(byModel.values()).sort((a, b) => b.usedMonth - a.usedMonth || b.callsMonth - a.callsMonth || a.model.localeCompare(b.model));
}

function sumEstimatedCost(rows: Array<{ estimatedCost: unknown }>) {
  return roundCost(rows.reduce((sum, row) => sum + decimalToNumber(row.estimatedCost), 0));
}

function decimalToNumber(value: unknown) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "object" && "toNumber" in value) {
    const decimalLike = value as { toNumber?: () => number };
    if (typeof decimalLike.toNumber === "function") return Number(decimalLike.toNumber());
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function roundCost(value: number) {
  return Number(value.toFixed(6));
}
