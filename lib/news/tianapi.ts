import { createHash } from "node:crypto";

import { logApiCacheHit, reserveApiQuota, settleApiQuota } from "@/lib/apiQuota";
import { rememberWithStatus } from "@/lib/cache";
import { AppError } from "@/lib/errors";
import { readProviderJsonResponse } from "@/lib/httpJson";
import {
  consumeNewsRequestBudget,
  createNewsRequestContext,
  type NewsProvider,
  type NewsProviderEvent,
  type NewsRequestContext
} from "@/lib/news/NewsProvider";
import type { NewsItem } from "@/lib/types";

type TianApiResponse = {
  code?: number;
  msg?: string;
  result?: {
    list?: TianApiNewsRow[];
    allnum?: number;
    curpage?: number;
  };
};

type TianApiNewsRow = {
  id?: string;
  url?: string;
  ctime?: string;
  title?: string;
  picUrl?: string;
  source?: string;
  description?: string;
};

const MIN_REQUEST_INTERVAL_MS = 450;

const tianApiState = globalThis as unknown as {
  __tianApiNextAt?: number;
};

export class TianApiNewsProvider implements NewsProvider {
  private readonly baseUrl = "https://apis.tianapi.com/caijing/index";

  async searchCompanyNews(symbol: string, from: string, to: string, context = createNewsRequestContext({ symbol })): Promise<NewsItem[]> {
    const normalized = symbol.toUpperCase();
    const compact = normalized.replace(/\.(SH|SZ|BJ|HK)$/i, "");
    const rows = dedupeRows(await this.search({ word: compact, page: 1, num: 10 }, context, "company", numberEnv("NEWS_COMPANY_CACHE_TTL_SECONDS", 3600)));

    return rows
      .map((row) => normalizeTianApiNews(row, [normalized], []))
      .filter((item) => withinRange(item, from, to));
  }

  async searchTopicNews(keywords: string[], from: string, to: string, context = createNewsRequestContext()): Promise<NewsItem[]> {
    const cleanKeywords = keywords.map((keyword) => keyword.trim()).filter(Boolean).slice(0, numberEnv("NEWS_TOPIC_QUERY_LIMIT", 1));
    if (!cleanKeywords.length) return [];

    const rows: TianApiNewsRow[] = [];
    for (const keyword of cleanKeywords) {
      rows.push(...(await this.search({ word: keyword, page: 1, num: 10 }, context, "topic", numberEnv("NEWS_TOPIC_CACHE_TTL_SECONDS", 4 * 3600))));
    }

    return dedupeRows(rows)
      .map((row) => normalizeTianApiNews(row, [], cleanKeywords))
      .filter((item) => withinRange(item, from, to))
      .filter((item) => containsAnyKeyword(item, cleanKeywords));
  }

  private async search(
    input: { word?: string; page?: number; num?: number },
    context: NewsRequestContext,
    requestKind: NewsProviderEvent["requestKind"],
    ttlSeconds: number
  ) {
    const key = requireTianApiKey();
    const url = new URL(this.baseUrl);
    url.searchParams.set("key", key);
    url.searchParams.set("num", String(Math.min(Math.max(input.num ?? 10, 1), 50)));
    url.searchParams.set("page", String(Math.max(input.page ?? 1, 1)));
    url.searchParams.set("form", "1");
    if (input.word) url.searchParams.set("word", input.word);

    const cacheKey = `news:tianapi:v3:${hashUrlWithoutKey(url)}`;
    const result = await rememberWithStatus(cacheKey, ttlSeconds, async () => {
      return this.fetchWithRetry(url, context, requestKind);
    });
    if (result.source !== "fresh") {
      context.events.push({ provider: "tianapi", apiName: "news", status: "cache_hit", requestKind });
      await logApiCacheHit(usageInput(context, requestKind, { cacheSource: result.source }));
    }
    return result.value;
  }

  private async fetchWithRetry(url: URL, context: NewsRequestContext, requestKind: NewsProviderEvent["requestKind"]) {
    let lastPayload: TianApiResponse | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      consumeNewsRequestBudget(context, "tianapi", requestKind);
      let reservation;
      try {
        reservation = await reserveApiQuota(usageInput(context, requestKind, { attempt: attempt + 1 }));
      } catch (error) {
        context.events.push({ provider: "tianapi", apiName: "news", status: "quota_exhausted", requestKind, message: errorMessage(error) });
        throw error;
      }
      if (reservation.status === "quota_low") {
        context.events.push({ provider: "tianapi", apiName: "news", status: "quota_low", requestKind });
      }
      await waitForTianApiSlot();
      let response: Response;
      try {
        response = await fetch(url, { cache: "no-store" });
      } catch (error) {
        await settleApiQuota(reservation, "failed", { error: errorMessage(error) });
        context.events.push({ provider: "tianapi", apiName: "news", status: "failed", requestKind, message: errorMessage(error) });
        throw error;
      }
      if (!response.ok) {
        await settleApiQuota(reservation, "failed", { httpStatus: response.status });
        context.events.push({ provider: "tianapi", apiName: "news", status: "failed", requestKind, message: `HTTP ${response.status}` });
        throw new AppError("DATA_PROVIDER_ERROR", `天行财经新闻请求失败：HTTP ${response.status}`);
      }

      let payload: TianApiResponse;
      try {
        payload = await readProviderJsonResponse<TianApiResponse>(response, "天行财经新闻");
      } catch (error) {
        await settleApiQuota(reservation, "failed", { error: errorMessage(error) });
        context.events.push({ provider: "tianapi", apiName: "news", status: "failed", requestKind, message: errorMessage(error) });
        throw error;
      }
      lastPayload = payload;
      if (payload.code === 200) {
        await settleApiQuota(reservation, "success", { code: payload.code, count: payload.result?.list?.length ?? 0 });
        context.events.push({ provider: "tianapi", apiName: "news", status: "success", requestKind });
        return payload.result?.list ?? [];
      }
      if (payload.code === 250) {
        await settleApiQuota(reservation, "failed", { code: payload.code, count: 0, billable: false });
        context.events.push({ provider: "tianapi", apiName: "news", status: "success", requestKind, message: "无结果且不计成功额度" });
        return [];
      }
      await settleApiQuota(reservation, "failed", { code: payload.code, message: payload.msg });
      if (payload.code === 130 && attempt === 0) {
        context.events.push({ provider: "tianapi", apiName: "news", status: "failed", requestKind, message: payload.msg ?? "QPS 超限，准备重试" });
        await sleep(1200);
        continue;
      }
      context.events.push({ provider: "tianapi", apiName: "news", status: "failed", requestKind, message: payload.msg });
      throw mapTianApiError(payload);
    }

    throw mapTianApiError(lastPayload ?? { code: 100, msg: "unknown" });
  }
}

function usageInput(context: NewsRequestContext, requestKind: NewsProviderEvent["requestKind"], metadata: Record<string, unknown> = {}) {
  return {
    userId: context.userId,
    provider: "tianapi",
    apiName: "news",
    priority: context.priority,
    symbol: context.symbol,
    requestBatchId: context.requestBatchId,
    requestKind,
    metadata
  };
}

function requireTianApiKey() {
  const key = normalizeEnvValue(process.env.TIANAPI_KEY || process.env.TIANAPI_API_KEY || process.env.TIAN_API_KEY);
  if (!key || isPlaceholderKey(key)) {
    throw new AppError("DATA_PROVIDER_ERROR", "天行财经新闻 API key 未配置。请在 .env 中设置 TIANAPI_KEY 后重启网站和 worker。");
  }
  return key;
}

function mapTianApiError(payload: TianApiResponse) {
  if (payload.code === 130) {
    return new AppError("RATE_LIMIT", "天行财经新闻接口 QPS 频率超限。系统已降低请求频率，请稍等 1 分钟后再抓取。", payload);
  }
  if (payload.code === 150) {
    return new AppError("RATE_LIMIT", "天行财经新闻接口每日可用次数不足。", payload);
  }
  if (payload.code === 160) {
    return new AppError("DATA_PROVIDER_ERROR", "天行财经新闻接口未申请权限。请在天行控制台申请“财经新闻”接口。", payload);
  }
  if (payload.code === 190 || payload.code === 230 || payload.code === 240) {
    return new AppError("DATA_PROVIDER_ERROR", "天行财经新闻 API key 无效或缺少 key。请确认 .env 的 TIANAPI_KEY 是控制台真实 key。", payload);
  }
  return new AppError("DATA_PROVIDER_ERROR", payload.msg ?? "天行财经新闻接口返回错误。", payload);
}

function normalizeTianApiNews(row: TianApiNewsRow, symbols: string[], sectors: string[]): NewsItem {
  const title = row.title?.trim() || "未命名财经新闻";
  const summary = row.description?.trim() || title;
  return {
    title,
    url: row.url,
    source: row.source ?? "天行财经",
    publishedAt: parseTianApiTime(row.ctime).toISOString(),
    rawContent: summary,
    summary,
    symbols,
    sectors
  };
}

function containsAnyKeyword(item: NewsItem, keywords: string[]) {
  const text = `${item.title} ${item.summary ?? ""} ${item.rawContent ?? ""}`.toLowerCase().replace(/\s+/g, "");
  return keywords.some((keyword) => keyword.length >= 2 && text.includes(keyword.toLowerCase().replace(/\s+/g, "")));
}

async function waitForTianApiSlot() {
  const now = Date.now();
  const nextAt = tianApiState.__tianApiNextAt ?? 0;
  if (nextAt > now) await sleep(nextAt - now);
  tianApiState.__tianApiNextAt = Date.now() + MIN_REQUEST_INTERVAL_MS;
}

function normalizeEnvValue(value?: string) {
  return value?.trim().replace(/^["']|["']$/g, "");
}

function isPlaceholderKey(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "change_me_tianapi_key" || normalized === "your_tianapi_key" || normalized.includes("change_me");
}

function parseTianApiTime(value?: string) {
  if (!value) return new Date();
  const normalized = value.length === 16 ? `${value}:00` : value;
  const parsed = new Date(`${normalized.replace(" ", "T")}+08:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function withinRange(item: NewsItem, from: string, to: string) {
  if (!item.publishedAt) return true;
  const published = new Date(item.publishedAt).getTime();
  return published >= new Date(from).getTime() && published <= new Date(to).getTime();
}

function dedupeRows(rows: TianApiNewsRow[]) {
  const seen = new Set<string>();
  const output: TianApiNewsRow[] = [];
  for (const row of rows) {
    const key = row.url || row.id || row.title;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(row);
  }
  return output;
}

function hashUrlWithoutKey(url: URL) {
  const clone = new URL(url);
  clone.searchParams.set("key", "hidden");
  return createHash("sha256").update(clone.toString()).digest("hex").slice(0, 24);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}
