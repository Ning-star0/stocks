import { createHash } from "node:crypto";

import { newsEventContextSchema } from "@/lib/schemas";
import type { Candle, NewsEventContext } from "@/lib/types";

export const NEWS_EVENT_TIMELINE_SCHEMA_VERSION = "news-event-timeline-v1" as const;
export const NEWS_EVENT_TIMELINE_ALGORITHM_VERSION = "conservative-title-cluster-next-session-v1" as const;

export type NewsTimelineArticle = {
  id: string;
  title: string;
  url?: string | null;
  source?: string | null;
  publishedAt: string | Date;
  importance?: string | null;
  analyses?: Array<{
    isFallback?: boolean;
    eventContextJson?: unknown;
    createdAt?: string | Date | null;
  }>;
};

export type NewsPriceReaction = {
  status: "available" | "unavailable";
  method: "next_full_trading_session_close";
  eventDate: string;
  reactionSessionDate: string | null;
  referenceClose: number | null;
  close1dPct: number | null;
  close3dPct: number | null;
  close5dPct: number | null;
  volumeRatio20: number | null;
  observedSessions: number;
  historyCutoff: string | null;
  missingReason: string | null;
};

export type NewsEventTimeline = {
  schemaVersion: typeof NEWS_EVENT_TIMELINE_SCHEMA_VERSION;
  algorithmVersion: typeof NEWS_EVENT_TIMELINE_ALGORITHM_VERSION;
  status: "complete" | "partial" | "insufficient";
  windowDescription: "当前分析新闻窗口内首次看到，不代表全网最早";
  clusterCount: number;
  duplicateArticleCount: number;
  futureDatedArticleCount: number;
  explicitExpectationCount: number;
  inferredExpectationCount: number;
  unavailableExpectationCount: number;
  priceReactionAvailableCount: number;
  events: Array<{
    eventId: string;
    title: string;
    firstSeenAt: string;
    latestSeenAt: string;
    novelty: "single_report" | "reprint_cluster";
    articleCount: number;
    articleIds: string[];
    importance: "high" | "medium" | "low" | "unknown";
    canonicalSource: {
      articleId: string;
      name: string | null;
      url: string | null;
      publishedAt: string;
      tier: "primary_official" | "secondary_media" | "unknown";
    };
    eventContext: NewsEventContext;
    eventContextSource: {
      articleId: string;
      name: string | null;
      url: string | null;
      publishedAt: string;
    } | null;
    priceReaction: NewsPriceReaction;
    limitations: string[];
  }>;
};

export function buildNewsEventTimeline(input: {
  articles: NewsTimelineArticle[];
  candles: Candle[];
  analysisAsOf: string;
}): NewsEventTimeline {
  const normalizedArticles = input.articles
    .map(normalizeArticle)
    .filter((item): item is NormalizedArticle => Boolean(item))
    .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id));
  const analysisAsOfMs = Date.parse(input.analysisAsOf);
  const futureDatedArticleCount = Number.isFinite(analysisAsOfMs)
    ? normalizedArticles.filter((item) => Date.parse(item.publishedAt) > analysisAsOfMs).length
    : 0;
  const articles = Number.isFinite(analysisAsOfMs)
    ? normalizedArticles.filter((item) => Date.parse(item.publishedAt) <= analysisAsOfMs)
    : normalizedArticles;
  const clusters: NormalizedArticle[][] = [];

  for (const article of articles) {
    // Complete-link clustering avoids merging two distinct events merely because
    // each resembles a broad intermediary headline.
    const cluster = clusters.find((items) => items.every((candidate) => isConservativeDuplicate(candidate, article)));
    if (cluster) cluster.push(article);
    else clusters.push([article]);
  }

  const events = clusters.map((cluster) => buildTimelineEvent(cluster, input.candles, input.analysisAsOf));
  const explicitExpectationCount = events.filter((event) => event.eventContext.expectation.status === "explicit").length;
  const inferredExpectationCount = events.filter((event) => event.eventContext.expectation.status === "inferred").length;
  const unavailableExpectationCount = events.filter((event) => event.eventContext.expectation.status === "unavailable").length;
  const priceReactionAvailableCount = events.filter((event) => event.priceReaction.status === "available").length;
  const complete = events.length > 0
    && futureDatedArticleCount === 0
    && explicitExpectationCount === events.length
    && priceReactionAvailableCount === events.length;

  return {
    schemaVersion: NEWS_EVENT_TIMELINE_SCHEMA_VERSION,
    algorithmVersion: NEWS_EVENT_TIMELINE_ALGORITHM_VERSION,
    status: events.length ? complete ? "complete" : "partial" : "insufficient",
    windowDescription: "当前分析新闻窗口内首次看到，不代表全网最早",
    clusterCount: events.length,
    duplicateArticleCount: Math.max(0, articles.length - events.length),
    futureDatedArticleCount,
    explicitExpectationCount,
    inferredExpectationCount,
    unavailableExpectationCount,
    priceReactionAvailableCount,
    events
  };
}

type NormalizedArticle = {
  id: string;
  title: string;
  normalizedTitle: string;
  numberTokens: string[];
  url: string | null;
  source: string | null;
  publishedAt: string;
  importance: "high" | "medium" | "low" | "unknown";
  analysis: { isFallback: boolean; eventContext: NewsEventContext | null } | null;
};

function normalizeArticle(article: NewsTimelineArticle): NormalizedArticle | null {
  const publishedAt = normalizeTimestamp(article.publishedAt);
  const title = article.title.trim();
  if (!article.id || !title || !publishedAt) return null;
  const normalizedTitle = normalizeTitle(title);
  if (!normalizedTitle) return null;
  const latestAnalysis = article.analyses?.[0];
  return {
    id: article.id,
    title,
    normalizedTitle,
    numberTokens: [...normalizedTitle.matchAll(/\d+(?:\.\d+)?%?/g)].map((match) => match[0]),
    url: article.url?.trim() || null,
    source: article.source?.trim() || null,
    publishedAt,
    importance: normalizeImportance(article.importance),
    analysis: latestAnalysis ? {
      isFallback: Boolean(latestAnalysis.isFallback),
      eventContext: parseNewsEventContext(latestAnalysis.eventContextJson)
    } : null
  };
}

function buildTimelineEvent(cluster: NormalizedArticle[], candles: Candle[], analysisAsOf: string) {
  const ordered = [...cluster].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id));
  const canonical = [...ordered].sort(compareCanonicalSource)[0];
  const contextSelection = chooseBestContext(ordered);
  const context = contextSelection.context;
  const eventId = createHash("sha256").update(ordered.map((item) => item.id).sort().join("|")).digest("hex");
  const limitations = [
    "首次时间仅表示当前分析新闻窗口内首次抓到，不证明是全网首发。",
    ...(ordered.length > 1 ? ["转载聚类采用保守标题相似度；不同措辞的同一事件仍可能未合并。"] : []),
    ...(context.expectation.status !== "explicit" ? ["市场预期没有原文明示的基线与实际结果，不能据此声称存在可交易预期差。"] : []),
    "价格反应从发布日后的下一完整交易日计算，不使用发布当日可能混入的盘前行情。"
  ];
  return {
    eventId,
    title: canonical.title,
    firstSeenAt: ordered[0].publishedAt,
    latestSeenAt: ordered.at(-1)?.publishedAt ?? ordered[0].publishedAt,
    novelty: ordered.length > 1 ? "reprint_cluster" as const : "single_report" as const,
    articleCount: ordered.length,
    articleIds: ordered.map((item) => item.id),
    importance: ordered.reduce((strongest, item) => strongerImportance(strongest, item.importance), "unknown" as NormalizedArticle["importance"]),
    canonicalSource: {
      articleId: canonical.id,
      name: canonical.source,
      url: canonical.url,
      publishedAt: canonical.publishedAt,
      tier: sourceTier(canonical)
    },
    eventContext: context,
    eventContextSource: contextSelection.article ? {
      articleId: contextSelection.article.id,
      name: contextSelection.article.source,
      url: contextSelection.article.url,
      publishedAt: contextSelection.article.publishedAt
    } : null,
    priceReaction: calculatePriceReaction(ordered[0].publishedAt, candles, analysisAsOf),
    limitations
  };
}

function isConservativeDuplicate(left: NormalizedArticle, right: NormalizedArticle) {
  if (Math.abs(Date.parse(left.publishedAt) - Date.parse(right.publishedAt)) > 72 * 60 * 60 * 1000) return false;
  if (left.numberTokens.join("|") !== right.numberTokens.join("|")) return false;
  if (left.normalizedTitle === right.normalizedTitle) return true;
  if (Math.min(left.normalizedTitle.length, right.normalizedTitle.length) < 12) return false;
  return jaccard(bigrams(left.normalizedTitle), bigrams(right.normalizedTitle)) >= 0.88;
}

function normalizeTitle(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/<[^>]*>/g, "").replace(/[^\p{L}\p{N}%]+/gu, "");
}

function bigrams(value: string) {
  const output = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) output.add(value.slice(index, index + 2));
  return output;
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function chooseBestContext(articles: NormalizedArticle[]) {
  const candidates = articles
    .filter((item) => item.analysis?.eventContext && !item.analysis.isFallback)
    .sort((a, b) => contextRank(b.analysis?.eventContext) - contextRank(a.analysis?.eventContext)
      || compareCanonicalSource(a, b));
  const article = candidates[0] ?? null;
  return {
    context: article?.analysis?.eventContext ?? unavailableNewsEventContext(),
    article
  };
}

function contextRank(context: NewsEventContext | null | undefined) {
  if (!context) return 0;
  const expectation = { explicit: 30, inferred: 20, unavailable: 0 }[context.expectation.status];
  const source = { current_source: 3, referenced_without_url: 2, unavailable: 0 }[context.originalSource.status];
  return expectation + source;
}

function compareCanonicalSource(left: NormalizedArticle, right: NormalizedArticle) {
  const rank = { primary_official: 0, secondary_media: 1, unknown: 2 };
  return rank[sourceTier(left)] - rank[sourceTier(right)]
    || left.publishedAt.localeCompare(right.publishedAt)
    || left.id.localeCompare(right.id);
}

function sourceTier(article: Pick<NormalizedArticle, "url" | "source">) {
  const host = hostname(article.url);
  const source = article.source?.toLowerCase() ?? "";
  if (
    /(^|\.)(cninfo\.com\.cn|sse\.com\.cn|szse\.cn|bse\.cn|csrc\.gov\.cn|pbc\.gov\.cn|stats\.gov\.cn|gov\.cn)$/.test(host)
    || /(巨潮|上交所|深交所|北交所|证监会|人民银行|国家统计局|政府|公司公告)/.test(source)
  ) return "primary_official" as const;
  if (/(新华社|中国证券报|上海证券报|证券时报|证券日报|财联社|第一财经|央视财经)/.test(source)) {
    return "secondary_media" as const;
  }
  return "unknown" as const;
}

function calculatePriceReaction(eventTime: string, candles: Candle[], analysisAsOf: string): NewsPriceReaction {
  const asOfMs = Date.parse(analysisAsOf);
  const usable = candles
    .filter((candle) => Number.isFinite(Date.parse(candle.timestamp)) && (!Number.isFinite(asOfMs) || Date.parse(candle.timestamp) <= asOfMs))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const eventDate = shanghaiDateKey(eventTime);
  const historyCutoff = usable.at(-1)?.timestamp ?? null;
  const reactionIndex = usable.findIndex((candle) => shanghaiDateKey(candle.timestamp) > eventDate);
  if (reactionIndex <= 0) {
    return {
      status: "unavailable",
      method: "next_full_trading_session_close",
      eventDate,
      reactionSessionDate: null,
      referenceClose: null,
      close1dPct: null,
      close3dPct: null,
      close5dPct: null,
      volumeRatio20: null,
      observedSessions: 0,
      historyCutoff,
      missingReason: reactionIndex < 0 ? "新闻之后尚无完整交易日。" : "缺少新闻前一交易日收盘价。"
    };
  }
  const referenceClose = usable[reactionIndex - 1].close;
  const eventSession = usable[reactionIndex];
  const previousVolumes = usable.slice(Math.max(0, reactionIndex - 20), reactionIndex).map((item) => item.volume).filter((value) => value > 0);
  const averageVolume = previousVolumes.length ? previousVolumes.reduce((sum, value) => sum + value, 0) / previousVolumes.length : null;
  return {
    status: "available",
    method: "next_full_trading_session_close",
    eventDate,
    reactionSessionDate: shanghaiDateKey(eventSession.timestamp),
    referenceClose: round(referenceClose, 4),
    close1dPct: returnPct(usable[reactionIndex]?.close, referenceClose),
    close3dPct: returnPct(usable[reactionIndex + 2]?.close, referenceClose),
    close5dPct: returnPct(usable[reactionIndex + 4]?.close, referenceClose),
    volumeRatio20: averageVolume ? round(eventSession.volume / averageVolume, 4) : null,
    observedSessions: Math.min(5, usable.length - reactionIndex),
    historyCutoff,
    missingReason: null
  };
}

export function parseNewsEventContext(value: unknown): NewsEventContext | null {
  const parsed = newsEventContextSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function unavailableNewsEventContext(): NewsEventContext {
  return {
    schemaVersion: "news-event-context-v1",
    eventOccurredAt: null,
    informationStage: "unclear",
    originalSource: { status: "unavailable", name: null, url: null },
    expectation: { status: "unavailable", baseline: null, actual: null, gapDirection: "unclear", evidence: null },
    expectedImpactHorizon: "unclear",
    falsifiers: []
  };
}

function shanghaiDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function hostname(url: string | null) {
  if (!url) return "";
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function normalizeTimestamp(value: string | Date | null | undefined) {
  const date = value instanceof Date ? value : new Date(value ?? "");
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeImportance(value: string | null | undefined): NormalizedArticle["importance"] {
  return value === "high" || value === "medium" || value === "low" ? value : "unknown";
}

function strongerImportance(left: NormalizedArticle["importance"], right: NormalizedArticle["importance"]) {
  const rank = { unknown: 0, low: 1, medium: 2, high: 3 };
  return rank[left] >= rank[right] ? left : right;
}

function returnPct(value: number | undefined, reference: number) {
  return Number.isFinite(value) && reference > 0 ? round((Number(value) / reference - 1) * 100, 4) : null;
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
