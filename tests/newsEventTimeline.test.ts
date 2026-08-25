import assert from "node:assert/strict";
import test from "node:test";

import { normalizeNewsEventContext } from "@/lib/ai/analyzeNews";
import { buildNewsEventTimeline, parseNewsEventContext } from "@/lib/news/eventTimeline";
import type { Candle, NewsEventContext } from "@/lib/types";

test("news timeline conservatively clusters reprints, prefers official evidence and computes next-session reaction", () => {
  const explicit = eventContext("explicit");
  const inferred = eventContext("inferred");
  const timeline = buildNewsEventTimeline({
    articles: [
      article("media-first", "公司上半年净利润超预期增长20%", "财经媒体", "https://media.example/a", "2026-08-20T01:00:00.000Z", inferred),
      article("official-follow", "公司上半年净利润超预期增长20％", "巨潮资讯", "https://static.cninfo.com.cn/finalpage/2026-08-20/a.PDF", "2026-08-20T02:00:00.000Z", explicit),
      article("different-number", "公司上半年净利润超预期增长30%", "财经媒体", "https://media.example/b", "2026-08-20T03:00:00.000Z", inferred)
    ],
    candles: candles(),
    analysisAsOf: "2026-08-22T23:00:00.000Z"
  });

  assert.equal(timeline.clusterCount, 2);
  assert.equal(timeline.duplicateArticleCount, 1);
  assert.equal(timeline.explicitExpectationCount, 1);
  const clustered = timeline.events.find((event) => event.articleCount === 2);
  assert.ok(clustered);
  assert.equal(clustered.novelty, "reprint_cluster");
  assert.equal(clustered.firstSeenAt, "2026-08-20T01:00:00.000Z");
  assert.equal(clustered.canonicalSource.articleId, "official-follow");
  assert.equal(clustered.canonicalSource.tier, "primary_official");
  assert.equal(clustered.eventContext.expectation.status, "explicit");
  assert.equal(clustered.eventContextSource?.articleId, "official-follow");
  assert.equal(clustered.priceReaction.reactionSessionDate, "2026-08-21");
  assert.equal(clustered.priceReaction.referenceClose, 101);
  assert.equal(clustered.priceReaction.close1dPct, 8.9109);
  assert.equal(clustered.priceReaction.close3dPct, null);
  assert.equal(clustered.priceReaction.close5dPct, null);
  assert.equal(clustered.priceReaction.volumeRatio20, 2);
});

test("timeline never uses candles after analysis cutoff and reports unavailable recent reactions", () => {
  const timeline = buildNewsEventTimeline({
    articles: [article(
      "too-new",
      "公司发布重大事项进展",
      "证券时报",
      "https://media.example/new",
      "2026-08-25T08:00:00.000Z",
      eventContext("unavailable")
    )],
    candles: candles(),
    analysisAsOf: "2026-08-25T09:00:00.000Z"
  });

  assert.equal(timeline.status, "partial");
  assert.equal(timeline.priceReactionAvailableCount, 0);
  assert.equal(timeline.events[0].priceReaction.status, "unavailable");
  assert.match(timeline.events[0].priceReaction.missingReason ?? "", /尚无完整交易日/);
});

test("timeline excludes future-dated news and reports the anomaly", () => {
  const timeline = buildNewsEventTimeline({
    articles: [article(
      "future-item",
      "公司未来时间新闻",
      "测试媒体",
      "https://media.example/future",
      "2026-08-25T10:00:00.000Z",
      eventContext("explicit")
    )],
    candles: candles(),
    analysisAsOf: "2026-08-25T09:00:00.000Z"
  });

  assert.equal(timeline.futureDatedArticleCount, 1);
  assert.equal(timeline.events.length, 0);
  assert.equal(timeline.status, "insufficient");
});

test("AI event context downgrades unsupported explicit expectations and cannot invent source URLs or future event times", () => {
  const normalized = normalizeNewsEventContext({
    eventOccurredAt: "2026-09-01T00:00:00.000Z",
    informationStage: "first_report",
    originalSource: { status: "current_source", name: "公司官网", url: "https://invented.example/fake" },
    expectation: {
      status: "explicit",
      baseline: "consensus 10%",
      actual: "12%",
      gapDirection: "positive",
      evidence: null
    },
    expectedImpactHorizon: "quarters",
    falsifiers: ["demand falls"]
  }, {
    title: "测试新闻",
    url: "https://official.example/current",
    source: "公司官网",
    publishedAt: "2026-08-20T00:00:00.000Z"
  });

  assert.equal(normalized.eventOccurredAt, null);
  assert.equal(normalized.originalSource.url, "https://official.example/current");
  assert.equal(normalized.expectation.status, "inferred");
  assert.match(normalized.expectation.baseline ?? "", /预期基线/);
  assert.ok(normalized.falsifiers[0].includes("证伪条件"));
});

test("explicit expectation requires an exact source excerpt", () => {
  const input = {
    title: "公司披露季度经营数据",
    url: "https://official.example/current",
    source: "公司公告",
    publishedAt: "2026-08-20T00:00:00.000Z",
    content: "市场此前一致预期收入增长10%，公司公告实际收入增长20%。"
  };
  const grounded = normalizeNewsEventContext({
    informationStage: "first_report",
    originalSource: { status: "current_source", name: "公司公告" },
    expectation: {
      status: "explicit",
      baseline: "市场一致预期收入增长10%",
      actual: "实际收入增长20%",
      gapDirection: "positive",
      evidence: "市场此前一致预期收入增长10%，公司公告实际收入增长20%。"
    },
    expectedImpactHorizon: "quarters",
    falsifiers: []
  }, input);
  const invented = normalizeNewsEventContext({
    ...grounded,
    expectation: { ...grounded.expectation, status: "explicit", evidence: "分析师普遍预期增长5%，实际增长20%。" }
  }, input);

  assert.equal(grounded.expectation.status, "explicit");
  assert.equal(invented.expectation.status, "inferred");
});

test("invalid or legacy event receipts cannot count as structured evidence", () => {
  assert.equal(parseNewsEventContext({ schemaVersion: "legacy", expectation: { status: "explicit" } }), null);
});

function article(
  id: string,
  title: string,
  source: string,
  url: string,
  publishedAt: string,
  context: NewsEventContext
) {
  return {
    id,
    title,
    source,
    url,
    publishedAt,
    importance: "high",
    analyses: [{ isFallback: false, eventContextJson: context }]
  };
}

function eventContext(status: "explicit" | "inferred" | "unavailable"): NewsEventContext {
  return {
    schemaVersion: "news-event-context-v1",
    eventOccurredAt: status === "unavailable" ? null : "2026-08-20T00:30:00.000Z",
    informationStage: "first_report",
    originalSource: { status: "current_source", name: "测试来源", url: "https://example.test/source" },
    expectation: status === "unavailable" ? {
      status,
      baseline: null,
      actual: null,
      gapDirection: "unclear",
      evidence: null
    } : {
      status,
      baseline: "市场原预期增长10%",
      actual: "实际增长20%",
      gapDirection: "positive",
      evidence: "正文同时列出预期和实际值"
    },
    expectedImpactHorizon: "quarters",
    falsifiers: ["后续正式报告不支持当前数据"]
  };
}

function candles(): Candle[] {
  const rows = [
    ["2026-08-19T07:00:00.000Z", 100, 100],
    ["2026-08-20T07:00:00.000Z", 101, 100],
    ["2026-08-21T07:00:00.000Z", 110, 200],
    ["2026-08-24T07:00:00.000Z", 108, 150],
    ["2026-08-25T07:00:00.000Z", 112, 130]
  ] as const;
  return rows.map(([timestamp, close, volume]) => ({
    symbol: "600000.SH",
    timestamp,
    open: close,
    high: close,
    low: close,
    close,
    volume
  }));
}
