import type { Prisma } from "@prisma/client";

import { getCache, setCache } from "@/lib/cache";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

export type ApiQuotaPriority = "routine" | "critical";
export type ApiQuotaStatus = "available" | "quota_low" | "quota_exhausted";

export type ApiQuotaPolicy = {
  dailyLimit: number | null;
  monthlyLimit: number | null;
  criticalReservePct: number;
  softThresholdPct: number;
};

export type ApiQuotaUsage = {
  dailyUsed: number;
  monthlyUsed: number;
  dailyReserved: number;
  monthlyReserved: number;
  officialMonthlyUsed: number | null;
};

export type ApiQuotaDecision = {
  allowed: boolean;
  status: ApiQuotaStatus;
  reason: "within_budget" | "soft_threshold" | "critical_reserve_only" | "daily_limit" | "monthly_limit";
  dailyRemaining: number | null;
  monthlyRemaining: number | null;
  routineDailyRemaining: number | null;
  routineMonthlyRemaining: number | null;
};

export type ApiQuotaReservation = {
  id: string;
  provider: string;
  apiName: string;
  amount: number;
  status: Exclude<ApiQuotaStatus, "quota_exhausted">;
  decision: ApiQuotaDecision;
  metadata: Record<string, unknown>;
};

type ReserveApiQuotaInput = {
  userId?: string | null;
  provider: string;
  apiName: string;
  priority?: ApiQuotaPriority;
  amount?: number;
  symbol?: string | null;
  requestBatchId?: string | null;
  requestKind?: string | null;
  metadata?: Record<string, unknown>;
  now?: Date;
};

const RESERVATION_TTL_MS = 15 * 60 * 1000;

export async function reserveApiQuota(input: ReserveApiQuotaInput): Promise<ApiQuotaReservation> {
  const now = input.now ?? new Date();
  const amount = positiveInteger(input.amount, 1);
  const priority = input.priority ?? "routine";
  const provider = input.provider.trim().toLowerCase();
  const apiName = input.apiName.trim().toLowerCase();
  const policy = quotaPolicy(provider, apiName);
  const official = await loadOfficialUsage(provider, apiName);
  const windows = quotaWindowStarts(now);
  const activeReservationCutoff = new Date(now.getTime() - RESERVATION_TTL_MS);
  const lockKey = `api_quota:${provider}:${apiName}`;

  const result = await prisma.$transaction(async (tx) => {
    // pg_advisory_xact_lock returns PostgreSQL's `void` pseudo-type, which
    // Prisma cannot deserialize directly. Wrapping it in a boolean expression
    // keeps the blocking lock semantics while returning a supported type.
    await tx.$queryRaw<{ acquired: boolean }[]>`
      SELECT pg_advisory_xact_lock(hashtext(${lockKey})) IS NULL AS acquired
    `;
    const [dailySuccess, dailyReserved, monthlySuccess, monthlyReserved] = await Promise.all([
      sumUsage(tx, provider, apiName, windows.dayStart, "success"),
      sumUsage(tx, provider, apiName, windows.dayStart, "reserved", activeReservationCutoff),
      sumUsage(tx, provider, apiName, windows.monthStart, "success"),
      sumUsage(tx, provider, apiName, windows.monthStart, "reserved", activeReservationCutoff)
    ]);
    const usage: ApiQuotaUsage = {
      dailyUsed: dailySuccess,
      monthlyUsed: Math.max(monthlySuccess, official?.used ?? 0),
      dailyReserved,
      monthlyReserved,
      officialMonthlyUsed: official?.used ?? null
    };
    const effectivePolicy: ApiQuotaPolicy = {
      ...policy,
      monthlyLimit: official?.limit ?? policy.monthlyLimit
    };
    const decision = evaluateApiQuota({ policy: effectivePolicy, usage, priority, amount });
    const metadata = compactMetadata({
      ...input.metadata,
      symbol: input.symbol?.toUpperCase() || undefined,
      requestBatchId: input.requestBatchId || undefined,
      requestKind: input.requestKind || undefined,
      priority,
      quotaStatus: decision.status,
      quotaReason: decision.reason,
      dailyLimit: effectivePolicy.dailyLimit,
      monthlyLimit: effectivePolicy.monthlyLimit,
      dailyUsed: usage.dailyUsed,
      monthlyUsed: usage.monthlyUsed,
      dailyReserved: usage.dailyReserved,
      monthlyReserved: usage.monthlyReserved,
      officialMonthlyUsed: usage.officialMonthlyUsed
    });

    if (!decision.allowed) {
      await tx.apiUsageLog.create({
        data: {
          userId: input.userId ?? null,
          provider,
          apiName,
          status: "quota_exhausted",
          amount,
          metadata: metadata as Prisma.InputJsonValue
        }
      });
      return { blocked: true as const, decision, metadata };
    }

    const row = await tx.apiUsageLog.create({
      data: {
        userId: input.userId ?? null,
        provider,
        apiName,
        status: "reserved",
        amount,
        metadata: metadata as Prisma.InputJsonValue
      }
    });
    return { blocked: false as const, row, decision, metadata };
  });

  if (result.blocked) {
    throw new AppError("RATE_LIMIT", quotaMessage(provider, apiName, result.decision), {
      provider,
      apiName,
      quotaStatus: "quota_exhausted",
      ...result.decision
    });
  }

  return {
    id: result.row.id,
    provider,
    apiName,
    amount,
    status: result.decision.status === "quota_low" ? "quota_low" : "available",
    decision: result.decision,
    metadata: result.metadata
  };
}

export async function settleApiQuota(
  reservation: ApiQuotaReservation,
  status: "success" | "failed",
  metadata: Record<string, unknown> = {}
) {
  await prisma.apiUsageLog.update({
    where: { id: reservation.id },
    data: {
      status,
      metadata: compactMetadata({
        ...reservation.metadata,
        ...metadata,
        settledAt: new Date().toISOString()
      }) as Prisma.InputJsonValue
    }
  });
}

export async function logApiCacheHit(input: Omit<ReserveApiQuotaInput, "amount" | "now">) {
  await prisma.apiUsageLog.create({
    data: {
      userId: input.userId ?? null,
      provider: input.provider.trim().toLowerCase(),
      apiName: input.apiName.trim().toLowerCase(),
      status: "cache_hit",
      amount: 1,
      metadata: compactMetadata({
        ...input.metadata,
        symbol: input.symbol?.toUpperCase() || undefined,
        requestBatchId: input.requestBatchId || undefined,
        requestKind: input.requestKind || undefined,
        priority: input.priority ?? "routine"
      }) as Prisma.InputJsonValue
    }
  }).catch(() => null);
}

export function evaluateApiQuota(input: {
  policy: ApiQuotaPolicy;
  usage: ApiQuotaUsage;
  priority: ApiQuotaPriority;
  amount?: number;
}): ApiQuotaDecision {
  const amount = positiveInteger(input.amount, 1);
  const dailyUsed = input.usage.dailyUsed + input.usage.dailyReserved;
  const monthlyUsed = input.usage.monthlyUsed + input.usage.monthlyReserved;
  const dailyCeiling = quotaCeiling(input.policy.dailyLimit, input.priority, input.policy.criticalReservePct);
  const monthlyCeiling = quotaCeiling(input.policy.monthlyLimit, input.priority, input.policy.criticalReservePct);
  const fullDailyRemaining = remaining(input.policy.dailyLimit, dailyUsed);
  const fullMonthlyRemaining = remaining(input.policy.monthlyLimit, monthlyUsed);
  const routineDailyRemaining = remaining(quotaCeiling(input.policy.dailyLimit, "routine", input.policy.criticalReservePct), dailyUsed);
  const routineMonthlyRemaining = remaining(quotaCeiling(input.policy.monthlyLimit, "routine", input.policy.criticalReservePct), monthlyUsed);

  if (dailyCeiling !== null && dailyUsed + amount > dailyCeiling) {
    const reserveOnly = input.priority === "routine" && input.policy.dailyLimit !== null && dailyUsed + amount <= input.policy.dailyLimit;
    return decision(false, reserveOnly ? "critical_reserve_only" : "daily_limit", fullDailyRemaining, fullMonthlyRemaining, routineDailyRemaining, routineMonthlyRemaining);
  }
  if (monthlyCeiling !== null && monthlyUsed + amount > monthlyCeiling) {
    const reserveOnly = input.priority === "routine" && input.policy.monthlyLimit !== null && monthlyUsed + amount <= input.policy.monthlyLimit;
    return decision(false, reserveOnly ? "critical_reserve_only" : "monthly_limit", fullDailyRemaining, fullMonthlyRemaining, routineDailyRemaining, routineMonthlyRemaining);
  }

  const dailyRatio = ratioAfter(input.policy.dailyLimit, dailyUsed, amount);
  const monthlyRatio = ratioAfter(input.policy.monthlyLimit, monthlyUsed, amount);
  const low = Math.max(dailyRatio, monthlyRatio) >= input.policy.softThresholdPct / 100;
  return {
    allowed: true,
    status: low ? "quota_low" : "available",
    reason: low ? "soft_threshold" : "within_budget",
    dailyRemaining: afterRemaining(input.policy.dailyLimit, dailyUsed, amount),
    monthlyRemaining: afterRemaining(input.policy.monthlyLimit, monthlyUsed, amount),
    routineDailyRemaining: afterRemaining(quotaCeiling(input.policy.dailyLimit, "routine", input.policy.criticalReservePct), dailyUsed, amount),
    routineMonthlyRemaining: afterRemaining(quotaCeiling(input.policy.monthlyLimit, "routine", input.policy.criticalReservePct), monthlyUsed, amount)
  };
}

export function quotaPolicy(provider: string, apiName: string): ApiQuotaPolicy {
  const isNews = apiName === "news";
  const dailyFallback = provider === "tianapi" && isNews ? 100 : null;
  const monthlyFallback = provider === "tavily" && apiName === "web_search" ? 1000 : null;
  return {
    dailyLimit: envQuota(isNews ? "NEWS_DAILY_CALL_LIMIT" : "WEB_SEARCH_DAILY_CALL_LIMIT", dailyFallback),
    monthlyLimit: envQuota(isNews ? "NEWS_MONTHLY_CALL_LIMIT" : "WEB_SEARCH_MONTHLY_CALL_LIMIT", monthlyFallback),
    criticalReservePct: boundedNumber(process.env.NEWS_CRITICAL_QUOTA_RESERVE_PCT, 20, 0, 90),
    softThresholdPct: boundedNumber(process.env.NEWS_QUOTA_SOFT_THRESHOLD_PCT, 70, 1, 100)
  };
}

export function quotaWindowStarts(now: Date, offsetMinutes = 8 * 60) {
  const shifted = new Date(now.getTime() + offsetMinutes * 60_000);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  return {
    dayStart: new Date(Date.UTC(year, month, day) - offsetMinutes * 60_000),
    monthStart: new Date(Date.UTC(year, month, 1) - offsetMinutes * 60_000)
  };
}

async function sumUsage(
  tx: Prisma.TransactionClient,
  provider: string,
  apiName: string,
  windowStart: Date,
  status: "success" | "reserved",
  activeReservationCutoff?: Date
) {
  const row = await tx.apiUsageLog.aggregate({
    where: {
      provider,
      apiName,
      status,
      createdAt: { gte: activeReservationCutoff && activeReservationCutoff > windowStart ? activeReservationCutoff : windowStart }
    },
    _sum: { amount: true }
  });
  return row._sum.amount ?? 0;
}

async function loadOfficialUsage(provider: string, apiName: string): Promise<{ used: number; limit: number | null } | null> {
  if (provider !== "tavily" || apiName !== "web_search") return null;
  const key = normalizeSecret(process.env.TAVILY_API_KEY);
  if (!key) return null;
  const projectId = normalizeProjectId(process.env.TAVILY_PROJECT_ID);
  const cacheKey = `provider_usage:tavily:v1:${projectId || "account"}`;
  const cached = await getCache<{ used: number; limit: number | null }>(cacheKey);
  if (cached) return cached;
  try {
    const response = await fetch("https://api.tavily.com/usage", {
      headers: {
        Authorization: `Bearer ${key}`,
        ...(projectId ? { "X-Project-ID": projectId } : {})
      },
      cache: "no-store"
    });
    if (!response.ok) return null;
    const payload = await response.json() as {
      key?: { usage?: number; limit?: number | null };
      account?: { plan_usage?: number; plan_limit?: number | null };
    };
    const value = {
      used: Math.max(0, Number(payload.key?.usage ?? payload.account?.plan_usage ?? 0)),
      limit: positiveLimit(payload.key?.limit ?? payload.account?.plan_limit)
    };
    await setCache(cacheKey, value, positiveInteger(Number(process.env.TAVILY_USAGE_SYNC_TTL_SECONDS), 900));
    return value;
  } catch {
    return null;
  }
}

function decision(
  allowed: boolean,
  reason: ApiQuotaDecision["reason"],
  dailyRemaining: number | null,
  monthlyRemaining: number | null,
  routineDailyRemaining: number | null,
  routineMonthlyRemaining: number | null
): ApiQuotaDecision {
  return {
    allowed,
    status: allowed ? "available" : "quota_exhausted",
    reason,
    dailyRemaining,
    monthlyRemaining,
    routineDailyRemaining,
    routineMonthlyRemaining
  };
}

function quotaCeiling(limit: number | null, priority: ApiQuotaPriority, reservePct: number) {
  if (limit === null) return null;
  return priority === "critical" ? limit : Math.floor(limit * (1 - reservePct / 100));
}

function remaining(limit: number | null, used: number) {
  return limit === null ? null : Math.max(0, limit - used);
}

function afterRemaining(limit: number | null, used: number, amount: number) {
  return limit === null ? null : Math.max(0, limit - used - amount);
}

function ratioAfter(limit: number | null, used: number, amount: number) {
  return limit === null || limit <= 0 ? 0 : (used + amount) / limit;
}

function quotaMessage(provider: string, apiName: string, decision: ApiQuotaDecision) {
  if (decision.reason === "critical_reserve_only") return `${provider} ${apiName} 普通查询额度已用完，剩余额度仅保留给关键风险核验。`;
  if (decision.reason === "daily_limit") return `${provider} ${apiName} 今日额度已用完。`;
  return `${provider} ${apiName} 本月额度已用完。`;
}

function envQuota(name: string, fallback: number | null) {
  if (!(name in process.env)) return fallback;
  return positiveLimit(process.env[name]);
}

function positiveLimit(value: unknown) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function positiveInteger(value: unknown, fallback: number) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalizeSecret(value?: string) {
  const secret = String(value ?? "").trim().replace(/^["']|["']$/g, "");
  return !secret || secret.toLowerCase().includes("change_me") ? "" : secret;
}

function normalizeProjectId(value?: string) {
  return String(value ?? "stocks").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}

function compactMetadata(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
