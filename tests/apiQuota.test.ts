import assert from "node:assert/strict";
import test from "node:test";

import { evaluateApiQuota, quotaWindowStarts, type ApiQuotaUsage } from "@/lib/apiQuota";

const usage = (dailyUsed: number, monthlyUsed = dailyUsed): ApiQuotaUsage => ({
  dailyUsed,
  monthlyUsed,
  dailyReserved: 0,
  monthlyReserved: 0,
  officialMonthlyUsed: null
});

test("routine news work preserves the final 20 percent for critical verification", () => {
  const policy = { dailyLimit: 100, monthlyLimit: null, criticalReservePct: 20, softThresholdPct: 70 };
  const finalRoutineCall = evaluateApiQuota({ policy, usage: usage(79), priority: "routine" });
  const blockedRoutineCall = evaluateApiQuota({ policy, usage: usage(80), priority: "routine" });
  const criticalCall = evaluateApiQuota({ policy, usage: usage(80), priority: "critical" });

  assert.equal(finalRoutineCall.allowed, true);
  assert.equal(finalRoutineCall.status, "quota_low");
  assert.equal(blockedRoutineCall.allowed, false);
  assert.equal(blockedRoutineCall.reason, "critical_reserve_only");
  assert.equal(criticalCall.allowed, true);
});

test("official monthly usage and live reservations both reduce Tavily capacity", () => {
  const result = evaluateApiQuota({
    policy: { dailyLimit: null, monthlyLimit: 1000, criticalReservePct: 20, softThresholdPct: 70 },
    usage: { ...usage(0, 810), monthlyReserved: 2, officialMonthlyUsed: 810 },
    priority: "routine"
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "critical_reserve_only");
  assert.equal(result.monthlyRemaining, 188);
});

test("quota windows use China Standard Time boundaries", () => {
  const windows = quotaWindowStarts(new Date("2026-08-24T16:30:00.000Z"));
  assert.equal(windows.dayStart.toISOString(), "2026-08-24T16:00:00.000Z");
  assert.equal(windows.monthStart.toISOString(), "2026-07-31T16:00:00.000Z");
});
