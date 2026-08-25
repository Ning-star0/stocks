import { randomUUID } from "node:crypto";

import type { NewsProviderEvent, NewsRequestContext } from "@/lib/news/NewsProvider";
import type { NewsItem } from "@/lib/types";

type SharedTopicOutcome = {
  items: NewsItem[];
  events: NewsProviderEvent[];
  error: unknown | null;
};

export type NewsBatchContext = {
  id: string;
  topics: Map<string, Promise<SharedTopicOutcome>>;
};

export function createNewsBatchContext(id: string = randomUUID()): NewsBatchContext {
  return { id, topics: new Map() };
}

export async function searchSharedTopicNews(input: {
  batch: NewsBatchContext;
  key: string;
  context: NewsRequestContext;
  load: () => Promise<NewsItem[]>;
}) {
  let owner = false;
  let pending = input.batch.topics.get(input.key);
  if (!pending) {
    owner = true;
    pending = loadOutcome(input.context, input.load);
    input.batch.topics.set(input.key, pending);
  }

  const outcome = await pending;
  if (!owner) propagateSharedOutcome(input.context, input.key, outcome);
  if (outcome.error) throw outcome.error;
  return outcome.items;
}

async function loadOutcome(context: NewsRequestContext, load: () => Promise<NewsItem[]>): Promise<SharedTopicOutcome> {
  const eventStart = context.events.length;
  try {
    return { items: await load(), events: context.events.slice(eventStart), error: null };
  } catch (error) {
    return { items: [], events: context.events.slice(eventStart), error };
  }
}

function propagateSharedOutcome(context: NewsRequestContext, key: string, outcome: SharedTopicOutcome) {
  const relevant = outcome.events.filter((event) =>
    event.status === "quota_low" || event.status === "quota_exhausted" || event.status === "failed"
  );
  for (const event of relevant) {
    context.events.push({
      provider: "news_batch",
      apiName: "shared_topic",
      status: event.status,
      requestKind: "topic",
      message: `${key} 共享结果：${event.message ?? event.status}`
    });
  }
  const fulfilled = outcome.events.length === 0 || outcome.events.some((event) => event.status === "success" || event.status === "cache_hit");
  if (!outcome.error && fulfilled && !relevant.some((event) => event.status === "quota_exhausted")) {
    context.events.push({
      provider: "news_batch",
      apiName: "shared_topic",
      status: "cache_hit",
      requestKind: "topic",
      message: `${key} 已复用同批次行业查询`
    });
  }
}
