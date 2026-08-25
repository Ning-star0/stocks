import assert from "node:assert/strict";
import test from "node:test";

import { createNewsBatchContext, searchSharedTopicNews } from "@/lib/news/batchCoordinator";
import { isChinaTradingSession, resolveNewsCacheTtl } from "@/lib/news/cachePolicy";
import { createNewsRequestContext, newsQuotaStatus } from "@/lib/news/NewsProvider";
import { resolveSharedSectorTopic } from "@/lib/news/relevance";

test("ten stocks in the same known sector share one topic request", async () => {
  const topic = resolveSharedSectorTopic(["电网设备", "特高压", "国家电网"]);
  assert.equal(topic?.key, "sector-topic-v1:power-grid");

  const batch = createNewsBatchContext("batch-fixture");
  const contexts = Array.from({ length: 10 }, (_, index) => createNewsRequestContext({
    symbol: `60000${index}.SH`,
    requestBatchId: batch.id
  }));
  let upstreamCalls = 0;
  const results = await Promise.all(contexts.map((context) => searchSharedTopicNews({
    batch,
    key: topic!.key,
    context,
    load: async () => {
      upstreamCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 15));
      context.events.push({ provider: "tianapi", apiName: "news", status: "success", requestKind: "topic" });
      return [{ title: "国家电网新一轮设备采购", symbols: [], sectors: ["电网设备"] }];
    }
  })));

  assert.equal(upstreamCalls, 1);
  assert.ok(results.every((items) => items.length === 1));
  assert.equal(contexts.filter((context) => context.events.some((event) => event.provider === "news_batch" && event.status === "cache_hit")).length, 9);
});

test("a shared quota failure remains visible to every stock in the batch", async () => {
  const batch = createNewsBatchContext("batch-quota-fixture");
  const owner = createNewsRequestContext({ symbol: "600000.SH", requestBatchId: batch.id });
  const waiter = createNewsRequestContext({ symbol: "600001.SH", requestBatchId: batch.id });
  const load = async () => {
    owner.events.push({ provider: "tianapi", apiName: "news", status: "quota_exhausted", requestKind: "topic", message: "额度已用完" });
    return [];
  };

  await Promise.all([
    searchSharedTopicNews({ batch, key: "sector-topic-v1:banking", context: owner, load }),
    searchSharedTopicNews({ batch, key: "sector-topic-v1:banking", context: waiter, load })
  ]);

  assert.equal(newsQuotaStatus(owner.events), "quota_exhausted");
  assert.equal(newsQuotaStatus(waiter.events), "quota_exhausted");
  assert.equal(waiter.events.some((event) => event.status === "cache_hit"), false);
});

test("news cache policy uses short critical TTL and longer off-hours topic TTL", () => {
  withCleanCacheEnv(() => {
    const tradingTime = new Date("2026-08-25T01:30:00.000Z");
    const offHours = new Date("2026-08-25T09:00:00.000Z");
    assert.equal(isChinaTradingSession(tradingTime), true);
    assert.equal(isChinaTradingSession(offHours), false);
    assert.equal(resolveNewsCacheTtl("company", tradingTime), 3600);
    assert.equal(resolveNewsCacheTtl("topic", tradingTime), 4 * 3600);
    assert.equal(resolveNewsCacheTtl("topic", offHours), 6 * 3600);
  });
});

function withCleanCacheEnv(run: () => void) {
  const names = ["NEWS_CRITICAL_CACHE_TTL_SECONDS", "NEWS_TOPIC_CACHE_TTL_SECONDS", "NEWS_OFF_HOURS_CACHE_TTL_SECONDS"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  try {
    run();
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}
