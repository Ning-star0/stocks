import { randomUUID } from "node:crypto";

import type { NewsItem } from "@/lib/types";

import type { ApiQuotaPriority, ApiQuotaStatus } from "@/lib/apiQuota";

export type NewsProviderEvent = {
  provider: string;
  apiName: string;
  status: "success" | "failed" | "cache_hit" | "fallback" | "quota_low" | "quota_exhausted";
  requestKind: "company" | "topic" | "web";
  message?: string;
};

export type NewsRequestContext = {
  userId?: string;
  symbol?: string;
  requestBatchId?: string;
  priority: ApiQuotaPriority;
  budget: { tianapiRemaining: number; tavilyRemaining: number };
  events: NewsProviderEvent[];
};

export function createNewsRequestContext(input: Partial<Omit<NewsRequestContext, "budget" | "events">> = {}): NewsRequestContext {
  return {
    ...input,
    requestBatchId: input.requestBatchId ?? randomUUID(),
    priority: input.priority ?? "routine",
    budget: {
      tianapiRemaining: positiveEnv("NEWS_MAX_TIANAPI_CALLS_PER_REFRESH", 2),
      tavilyRemaining: positiveEnv("NEWS_MAX_TAVILY_CALLS_PER_REFRESH", 1)
    },
    events: []
  };
}

export function consumeNewsRequestBudget(context: NewsRequestContext, provider: "tianapi" | "tavily", requestKind: NewsProviderEvent["requestKind"]) {
  const key = provider === "tianapi" ? "tianapiRemaining" : "tavilyRemaining";
  if (context.budget[key] <= 0) {
    const message = `${provider} 本次新闻刷新调用上限已用完。`;
    context.events.push({ provider, apiName: provider === "tianapi" ? "news" : "web_search", status: "quota_exhausted", requestKind, message });
    const error = new Error(message) as Error & { code?: string; details?: Record<string, unknown> };
    error.code = "RATE_LIMIT";
    error.details = { quotaStatus: "quota_exhausted", provider, scope: "request" };
    throw error;
  }
  context.budget[key] -= 1;
}

export function newsQuotaStatus(events: NewsProviderEvent[]): ApiQuotaStatus {
  if (events.some((event) => event.status === "quota_exhausted")) return "quota_exhausted";
  if (events.some((event) => event.status === "quota_low")) return "quota_low";
  return "available";
}

export interface NewsProvider {
  searchCompanyNews(symbol: string, from: string, to: string, context?: NewsRequestContext): Promise<NewsItem[]>;
  searchTopicNews(keywords: string[], from: string, to: string, context?: NewsRequestContext): Promise<NewsItem[]>;
}

function positiveEnv(name: string, fallback: number) {
  const value = Math.floor(Number(process.env[name]));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
