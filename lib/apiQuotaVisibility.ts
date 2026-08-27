export const API_QUOTA_VISIBILITY_SCHEMA_VERSION = "api-quota-visibility-v1";

export type QuotaAlertLevel =
  | "unconfigured"
  | "normal"
  | "notice_70"
  | "warning_85"
  | "critical_95"
  | "exhausted";

export type ApiQuotaVisibility = {
  schemaVersion: typeof API_QUOTA_VISIBILITY_SCHEMA_VERSION;
  localUsedToday: number;
  localUsedMonth: number;
  reservedToday: number;
  reservedMonth: number;
  officialUsedToday: number | null;
  officialUsedMonth: number | null;
  officialLimitMonth: number | null;
  officialSyncedAt: string | null;
  officialAvailable: boolean;
  officialError: string | null;
  effectiveUsedToday: number;
  effectiveUsedMonth: number;
  effectiveDailyLimit: number | null;
  effectiveMonthlyLimit: number | null;
  officialLocalGapMonth: number | null;
  remainingToday: number | null;
  remainingMonth: number | null;
  routineRemainingToday: number | null;
  routineRemainingMonth: number | null;
  criticalReserveToday: number | null;
  criticalReserveMonth: number | null;
  usagePercentToday: number | null;
  usagePercentMonth: number | null;
  alertLevel: QuotaAlertLevel;
  routineAllowed: boolean;
};

export type ApiQuotaVisibilityInput = {
  localUsedToday: number;
  localUsedMonth: number;
  reservedToday?: number;
  reservedMonth?: number;
  dailyLimit: number | null;
  monthlyLimit: number | null;
  criticalReservePct?: number;
  official?: {
    available: boolean;
    used: number | null;
    limit: number | null;
    checkedAt: string | null;
    error?: string | null;
  } | null;
};

export type RefreshCapacitySource = {
  provider: string;
  configured: boolean;
  maxCallsPerRefresh: number;
  quota: ApiQuotaVisibility;
};

export type NewsRefreshCapacity = {
  schemaVersion: typeof API_QUOTA_VISIBILITY_SCHEMA_VERSION;
  estimatedRoutineStockRefreshes: number | null;
  limitingProvider: string | null;
  alertLevel: QuotaAlertLevel;
  routineAllowed: boolean;
  basis: "configured_provider_worst_case" | "limits_not_configured" | "no_external_provider";
  providers: Array<{
    provider: string;
    maxCallsPerRefresh: number;
    estimatedRoutineRefreshes: number | null;
    alertLevel: QuotaAlertLevel;
    routineAllowed: boolean;
  }>;
};

const MANDATORY_CRITICAL_ONLY_PCT = 95;

export function buildApiQuotaVisibility(input: ApiQuotaVisibilityInput): ApiQuotaVisibility {
  const localUsedToday = nonNegativeInteger(input.localUsedToday);
  const localUsedMonth = nonNegativeInteger(input.localUsedMonth);
  const reservedToday = nonNegativeInteger(input.reservedToday ?? 0);
  const reservedMonth = nonNegativeInteger(input.reservedMonth ?? 0);
  const officialUsedMonth = input.official?.available ? nullableNonNegativeInteger(input.official.used) : null;
  const officialLimitMonth = input.official?.available ? nullablePositiveInteger(input.official.limit) : null;
  const effectiveDailyLimit = nullablePositiveInteger(input.dailyLimit);
  const effectiveMonthlyLimit = officialLimitMonth ?? nullablePositiveInteger(input.monthlyLimit);
  const effectiveUsedToday = localUsedToday + reservedToday;
  const effectiveUsedMonth = Math.max(localUsedMonth, officialUsedMonth ?? 0) + reservedMonth;
  const reservePct = boundedNumber(input.criticalReservePct, 20, 0, 90);
  const routineReservePct = Math.max(reservePct, 100 - MANDATORY_CRITICAL_ONLY_PCT);
  const routineDailyCeiling = quotaCeiling(effectiveDailyLimit, routineReservePct);
  const routineMonthlyCeiling = quotaCeiling(effectiveMonthlyLimit, routineReservePct);
  const usagePercentToday = percent(effectiveUsedToday, effectiveDailyLimit);
  const usagePercentMonth = percent(effectiveUsedMonth, effectiveMonthlyLimit);
  const alertLevel = quotaAlertLevel(usagePercentToday, usagePercentMonth);

  return {
    schemaVersion: API_QUOTA_VISIBILITY_SCHEMA_VERSION,
    localUsedToday,
    localUsedMonth,
    reservedToday,
    reservedMonth,
    officialUsedToday: null,
    officialUsedMonth,
    officialLimitMonth,
    officialSyncedAt: input.official?.available ? input.official.checkedAt : null,
    officialAvailable: input.official?.available ?? false,
    officialError: input.official?.error ?? null,
    effectiveUsedToday,
    effectiveUsedMonth,
    effectiveDailyLimit,
    effectiveMonthlyLimit,
    officialLocalGapMonth: officialUsedMonth === null ? null : officialUsedMonth - localUsedMonth,
    remainingToday: remaining(effectiveDailyLimit, effectiveUsedToday),
    remainingMonth: remaining(effectiveMonthlyLimit, effectiveUsedMonth),
    routineRemainingToday: remaining(routineDailyCeiling, effectiveUsedToday),
    routineRemainingMonth: remaining(routineMonthlyCeiling, effectiveUsedMonth),
    criticalReserveToday: reserveAmount(effectiveDailyLimit, routineDailyCeiling),
    criticalReserveMonth: reserveAmount(effectiveMonthlyLimit, routineMonthlyCeiling),
    usagePercentToday,
    usagePercentMonth,
    alertLevel,
    routineAllowed: alertLevel !== "critical_95"
      && alertLevel !== "exhausted"
      && hasRoutineCapacity(routineDailyCeiling, effectiveUsedToday)
      && hasRoutineCapacity(routineMonthlyCeiling, effectiveUsedMonth)
  };
}

export function estimateNewsRefreshCapacity(sources: RefreshCapacitySource[]): NewsRefreshCapacity {
  const configured = sources.filter((source) => source.configured && source.maxCallsPerRefresh > 0);
  if (!configured.length) {
    return {
      schemaVersion: API_QUOTA_VISIBILITY_SCHEMA_VERSION,
      estimatedRoutineStockRefreshes: null,
      limitingProvider: null,
      alertLevel: "unconfigured",
      routineAllowed: false,
      basis: "no_external_provider",
      providers: []
    };
  }

  const providers = configured.map((source) => ({
    provider: source.provider,
    maxCallsPerRefresh: Math.max(1, Math.floor(source.maxCallsPerRefresh)),
    estimatedRoutineRefreshes: providerRefreshCapacity(source),
    alertLevel: source.quota.alertLevel,
    routineAllowed: source.quota.routineAllowed
  }));
  const finite = providers.filter((source) => source.estimatedRoutineRefreshes !== null);
  const limiting = finite.sort((a, b) => (a.estimatedRoutineRefreshes ?? 0) - (b.estimatedRoutineRefreshes ?? 0))[0] ?? null;

  return {
    schemaVersion: API_QUOTA_VISIBILITY_SCHEMA_VERSION,
    estimatedRoutineStockRefreshes: limiting?.estimatedRoutineRefreshes ?? null,
    limitingProvider: limiting?.provider ?? null,
    alertLevel: configured.reduce<QuotaAlertLevel>((level, source) => maxAlertLevel(level, source.quota.alertLevel), "unconfigured"),
    routineAllowed: configured.every((source) => source.quota.routineAllowed),
    basis: limiting ? "configured_provider_worst_case" : "limits_not_configured",
    providers
  };
}

export function quotaAlertLevel(...percentages: Array<number | null>): QuotaAlertLevel {
  const available = percentages.filter((value): value is number => value !== null && Number.isFinite(value));
  if (!available.length) return "unconfigured";
  const highest = Math.max(...available);
  if (highest >= 100) return "exhausted";
  if (highest >= 95) return "critical_95";
  if (highest >= 85) return "warning_85";
  if (highest >= 70) return "notice_70";
  return "normal";
}

function providerRefreshCapacity(source: RefreshCapacitySource) {
  if (!source.quota.routineAllowed) return 0;
  const perRefresh = Math.max(1, Math.floor(source.maxCallsPerRefresh));
  const capacities = [source.quota.routineRemainingToday, source.quota.routineRemainingMonth]
    .filter((value): value is number => value !== null)
    .map((value) => Math.floor(value / perRefresh));
  return capacities.length ? Math.max(0, Math.min(...capacities)) : null;
}

function maxAlertLevel(left: QuotaAlertLevel, right: QuotaAlertLevel): QuotaAlertLevel {
  const order: QuotaAlertLevel[] = ["unconfigured", "normal", "notice_70", "warning_85", "critical_95", "exhausted"];
  return order[Math.max(order.indexOf(left), order.indexOf(right))] ?? right;
}

function quotaCeiling(limit: number | null, reservePct: number) {
  return limit === null ? null : Math.floor(limit * (1 - reservePct / 100));
}

function reserveAmount(limit: number | null, ceiling: number | null) {
  return limit === null || ceiling === null ? null : Math.max(0, limit - ceiling);
}

function remaining(limit: number | null, used: number) {
  return limit === null ? null : Math.max(0, limit - used);
}

function percent(used: number, limit: number | null) {
  return limit === null ? null : Number(((used / limit) * 100).toFixed(2));
}

function hasRoutineCapacity(limit: number | null, used: number) {
  return limit === null || used < limit;
}

function nullableNonNegativeInteger(value: unknown) {
  if (value === null || value === undefined) return null;
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function nullablePositiveInteger(value: unknown) {
  if (value === null || value === undefined) return null;
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function nonNegativeInteger(value: unknown) {
  return nullableNonNegativeInteger(value) ?? 0;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}
