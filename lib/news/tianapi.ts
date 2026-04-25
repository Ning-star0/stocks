import { createHash } from "node:crypto";

import { remember } from "@/lib/cache";
import { AppError } from "@/lib/errors";
import type { NewsProvider } from "@/lib/news/NewsProvider";
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

  async searchCompanyNews(symbol: string, from: string, to: string): Promise<NewsItem[]> {
    const normalized = symbol.toUpperCase();
    const compact = normalized.replace(/\.(SH|SZ|BJ|HK)$/i, "");
    const rows = dedupeRows(await this.search({ word: compact, page: 1, num: 10 }));

    return rows
      .map((row) => normalizeTianApiNews(row, [normalized], []))
      .filter((item) => withinRange(item, from, to));
  }

  async searchTopicNews(keywords: string[], from: string, to: string): Promise<NewsItem[]> {
    const cleanKeywords = keywords.map((keyword) => keyword.trim()).filter(Boolean).slice(0, 3);
    if (!cleanKeywords.length) return [];

    const rows: TianApiNewsRow[] = [];
    for (const keyword of cleanKeywords) {
      rows.push(...(await this.search({ word: keyword, page: 1, num: 10 })));
    }

    return dedupeRows(rows)
      .map((row) => normalizeTianApiNews(row, [], cleanKeywords))
      .filter((item) => withinRange(item, from, to))
      .filter((item) => containsAnyKeyword(item, cleanKeywords));
  }

  private async search(input: { word?: string; page?: number; num?: number }) {
    const key = requireTianApiKey();
    const url = new URL(this.baseUrl);
    url.searchParams.set("key", key);
    url.searchParams.set("num", String(Math.min(Math.max(input.num ?? 10, 1), 50)));
    url.searchParams.set("page", String(Math.max(input.page ?? 1, 1)));
    url.searchParams.set("form", "1");
    if (input.word) url.searchParams.set("word", input.word);

    const cacheKey = `news:tianapi:v2:${hashUrlWithoutKey(url)}`;
    return remember(cacheKey, numberEnv("NEWS_CACHE_TTL_SECONDS", 900), async () => this.fetchWithRetry(url));
  }

  private async fetchWithRetry(url: URL) {
    let lastPayload: TianApiResponse | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await waitForTianApiSlot();
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new AppError("DATA_PROVIDER_ERROR", `天行财经新闻请求失败：HTTP ${response.status}`);

      const payload = (await response.json()) as TianApiResponse;
      lastPayload = payload;
      if (payload.code === 200) return payload.result?.list ?? [];
      if (payload.code === 250) return [];
      if (payload.code === 130 && attempt === 0) {
        await sleep(1200);
        continue;
      }
      throw mapTianApiError(payload);
    }

    throw mapTianApiError(lastPayload ?? { code: 100, msg: "unknown" });
  }
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
