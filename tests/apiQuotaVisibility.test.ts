import assert from "node:assert/strict";
import test from "node:test";

import { evaluateApiQuota, quotaPolicy, type ApiQuotaUsage } from "@/lib/apiQuota";
import {
  buildApiQuotaVisibility,
  estimateNewsRefreshCapacity,
  quotaAlertLevel
} from "@/lib/apiQuotaVisibility";

const usage = (dailyUsed: number, monthlyUsed = dailyUsed): ApiQuotaUsage => ({
  dailyUsed,
  monthlyUsed,
  dailyReserved: 0,
  monthlyReserved: 0,
  officialMonthlyUsed: null
});

test("official usage, local ledger and live reservations stay separate and reconcile conservatively", () => {
  const result = buildApiQuotaVisibility({
    localUsedToday: 8,
    localUsedMonth: 30,
    reservedToday: 1,
    reservedMonth: 2,
    dailyLimit: 100,
    monthlyLimit: 100,
    criticalReservePct: 20,
    official: {
      available: true,
      used: 42,
      limit: 100,
      checkedAt: "2026-08-27T12:00:00.000Z"
    }
  });

  assert.equal(result.localUsedMonth, 30);
  assert.equal(result.officialUsedMonth, 42);
  assert.equal(result.officialLocalGapMonth, 12);
  assert.equal(result.effectiveUsedMonth, 44);
  assert.equal(result.remainingMonth, 56);
  assert.equal(result.routineRemainingMonth, 36);
  assert.equal(result.criticalReserveMonth, 20);
  assert.equal(result.officialSyncedAt, "2026-08-27T12:00:00.000Z");
});

test("70, 85 and 95 percent thresholds produce deterministic alert levels", () => {
  assert.equal(quotaAlertLevel(69.99), "normal");
  assert.equal(quotaAlertLevel(70), "notice_70");
  assert.equal(quotaAlertLevel(85), "warning_85");
  assert.equal(quotaAlertLevel(95), "critical_95");
  assert.equal(quotaAlertLevel(100), "exhausted");
  assert.equal(quotaAlertLevel(null, null), "unconfigured");
});

test("95 percent always reserves the remainder for critical verification even when configured reserve is zero", () => {
  const policy = { dailyLimit: 100, monthlyLimit: null, criticalReservePct: 0, softThresholdPct: 90 };
  const finalRoutine = evaluateApiQuota({ policy, usage: usage(94), priority: "routine" });
  const blockedRoutine = evaluateApiQuota({ policy, usage: usage(95), priority: "routine" });
  const critical = evaluateApiQuota({ policy, usage: usage(95), priority: "critical" });

  assert.equal(finalRoutine.allowed, true);
  assert.equal(finalRoutine.status, "quota_low", "70% mandatory warning cannot be raised by configuration");
  assert.equal(blockedRoutine.allowed, false);
  assert.equal(blockedRoutine.reason, "critical_reserve_only");
  assert.equal(critical.allowed, true);
});

test("remaining stock refresh estimate uses the most constrained configured provider", () => {
  const tianapi = buildApiQuotaVisibility({
    localUsedToday: 70,
    localUsedMonth: 70,
    dailyLimit: 100,
    monthlyLimit: 1000,
    criticalReservePct: 20
  });
  const tavily = buildApiQuotaVisibility({
    localUsedToday: 0,
    localUsedMonth: 790,
    dailyLimit: null,
    monthlyLimit: 1000,
    criticalReservePct: 20,
    official: { available: true, used: 790, limit: 1000, checkedAt: "2026-08-27T12:00:00.000Z" }
  });
  const result = estimateNewsRefreshCapacity([
    { provider: "tianapi", configured: true, maxCallsPerRefresh: 2, quota: tianapi },
    { provider: "tavily", configured: true, maxCallsPerRefresh: 1, quota: tavily }
  ]);

  assert.equal(result.estimatedRoutineStockRefreshes, 5);
  assert.equal(result.limitingProvider, "tianapi");
  assert.equal(result.alertLevel, "notice_70");
  assert.equal(result.routineAllowed, true);
});

test("missing official usage stays visible without erasing the local ledger", () => {
  const result = buildApiQuotaVisibility({
    localUsedToday: 4,
    localUsedMonth: 9,
    dailyLimit: 100,
    monthlyLimit: 1000,
    official: {
      available: false,
      used: null,
      limit: null,
      checkedAt: "2026-08-27T12:00:00.000Z",
      error: "provider unavailable"
    }
  });

  assert.equal(result.officialUsedMonth, null);
  assert.equal(result.officialSyncedAt, null);
  assert.equal(result.officialError, "provider unavailable");
  assert.equal(result.effectiveUsedMonth, 9);
});

test("quote and history policies never inherit web-search limits", () => {
  const previousDaily = process.env.WEB_SEARCH_DAILY_CALL_LIMIT;
  const previousMonthly = process.env.WEB_SEARCH_MONTHLY_CALL_LIMIT;
  process.env.WEB_SEARCH_DAILY_CALL_LIMIT = "77";
  process.env.WEB_SEARCH_MONTHLY_CALL_LIMIT = "888";
  try {
    const quote = quotaPolicy("eastmoney", "quote");
    const history = quotaPolicy("eastmoney", "history");
    assert.equal(quote.dailyLimit, null);
    assert.equal(quote.monthlyLimit, null);
    assert.equal(history.dailyLimit, null);
    assert.equal(history.monthlyLimit, null);
  } finally {
    if (previousDaily === undefined) delete process.env.WEB_SEARCH_DAILY_CALL_LIMIT;
    else process.env.WEB_SEARCH_DAILY_CALL_LIMIT = previousDaily;
    if (previousMonthly === undefined) delete process.env.WEB_SEARCH_MONTHLY_CALL_LIMIT;
    else process.env.WEB_SEARCH_MONTHLY_CALL_LIMIT = previousMonthly;
  }
});
