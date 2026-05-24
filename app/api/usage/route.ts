import { NextResponse } from "next/server";

import { readQuota } from "@/lib/apiUsage";
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

export async function GET() {
  try {
    const user = await getCurrentUser();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [aiToday, aiMonth, apiLogs] = await Promise.all([
      prisma.aiUsageLog.findMany({ where: { userId: user.id, createdAt: { gte: todayStart } } }),
      prisma.aiUsageLog.findMany({ where: { userId: user.id, createdAt: { gte: monthStart } } }),
      prisma.apiUsageLog.findMany({
        where: {
          createdAt: { gte: monthStart },
          OR: [{ userId: user.id }, { userId: null }]
        }
      })
    ]);

    const items: UsageItem[] = [
      buildAiCallsItem(aiToday.length, aiMonth.length),
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
      items
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
  logs: Array<{ apiName: string; amount: number; createdAt: Date }>;
  apiName: string;
  dailyLimitEnv: string;
  monthlyLimitEnv: string;
}): UsageItem {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const matched = input.logs.filter((log) => log.apiName === input.apiName);
  return withRemaining({
    key: input.key,
    label: input.label,
    provider: input.provider,
    usedToday: sumAmount(matched.filter((log) => log.createdAt >= todayStart)),
    usedMonth: sumAmount(matched),
    unit: "次",
    dailyLimit: readQuota(input.dailyLimitEnv),
    monthlyLimit: readQuota(input.monthlyLimitEnv)
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
