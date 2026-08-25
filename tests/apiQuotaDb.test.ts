import assert from "node:assert/strict";
import test from "node:test";

import { reserveApiQuota, settleApiQuota, type ApiQuotaReservation } from "@/lib/apiQuota";
import { deleteCache, rememberWithStatus, setCache } from "@/lib/cache";
import { prisma } from "@/lib/prisma";

test.after(async () => {
  await prisma.$disconnect();
});

test("database advisory lock prevents concurrent quota overspend", {
  skip: process.env.RUN_DB_E2E_TESTS !== "true"
}, async () => {
  const provider = `quota-e2e-${Date.now()}`;
  const previousLimit = process.env.NEWS_DAILY_CALL_LIMIT;
  process.env.NEWS_DAILY_CALL_LIMIT = "1";
  let reservation: ApiQuotaReservation | null = null;

  try {
    const results = await Promise.allSettled(Array.from({ length: 2 }, () => reserveApiQuota({
      provider,
      apiName: "news",
      priority: "critical",
      requestBatchId: "db-e2e",
      requestKind: "topic",
      metadata: { test: true }
    })));
    const fulfilled = results.filter((result): result is PromiseFulfilledResult<ApiQuotaReservation> => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    reservation = fulfilled[0].value;
    assert.equal(reservation.decision.dailyRemaining, 0);
  } finally {
    if (reservation) await settleApiQuota(reservation, "failed", { testCleanup: true }).catch(() => null);
    await prisma.apiUsageLog.deleteMany({ where: { provider } }).catch(() => null);
    if (previousLimit === undefined) delete process.env.NEWS_DAILY_CALL_LIMIT;
    else process.env.NEWS_DAILY_CALL_LIMIT = previousLimit;
  }
});

test("persistent cache covers hit, explicit critical bypass and expiry", {
  skip: process.env.RUN_DB_E2E_TESTS !== "true"
}, async () => {
  const key = `news-cache-e2e:${Date.now()}`;
  let calls = 0;
  const loader = async () => ({ revision: ++calls });
  try {
    await setCache(key, { revision: 0 }, 60);
    const hit = await rememberWithStatus(key, 60, loader);
    const bypass = await rememberWithStatus(key, 60, loader, { bypassCache: true });
    await setCache(key, { revision: 2 }, 1);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const expired = await rememberWithStatus(key, 60, loader);

    assert.equal(hit.source, "cache");
    assert.deepEqual(hit.value, { revision: 0 });
    assert.equal(bypass.source, "fresh");
    assert.deepEqual(bypass.value, { revision: 1 });
    assert.equal(expired.source, "fresh");
    assert.deepEqual(expired.value, { revision: 2 });
  } finally {
    await deleteCache(key);
  }
});
