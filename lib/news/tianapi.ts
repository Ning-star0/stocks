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

function requireTianApiKey() {
  const key = normalizeEnvValue(process.env.TIANAPI_KEY || process.env.TIANAPI_API_KEY || process.env.TIAN_API_KEY);
  if (!key || isPlaceholderKey(key)) {
    throw new AppError("DATA_PROVIDER_ERROR", "使用天行财经新闻源需要在 .env 配置真实的 TIANAPI_KEY，并重启网站和 worker。");
  }
  return key;
}

export class TianApiNewsProvider implements NewsProvider {
  private readonly baseUrl = "https://apis.tianapi.com/caijing/index";

  async searchCompanyNews(symbol: string, from: string, to: string): Promise<NewsItem[]> {
    const normalized = symbol.toUpperCase();
    const compact = normalized.replace(/\.(SH|SZ|BJ|HK)$/i, "");
    const rows = dedupeRows(await this.search({ word: compact, page: 1, num: 20 }));

    return rows
      .map((row) => normalizeTianApiNews(row, [normalized], []))
      .filter((item) => withinRange(item, from, to));
  }

  async searchTopicNews(keywords: string[], from: string, to: string): Promise<NewsItem[]> {
    const cleanKeywords = keywords.map((keyword) => keyword.trim()).filter(Boolean);
    const rows: TianApiNewsRow[] = [];

    for (const keyword of cleanKeywords.slice(0, 5)) {
      rows.push(...(await this.search({ word: keyword, page: 1, num: 20 })));
    }

    if (!rows.length) {
      rows.push(...(await this.search({ page: 1, num: 30 })));
    }

    return dedupeRows(rows)
      .map((row) => normalizeTianApiNews(row, [], cleanKeywords))
      .filter((item) => withinRange(item, from, to));
  }

  private async search(input: { word?: string; page?: number; num?: number }) {
    const key = requireTianApiKey();
    const url = new URL(this.baseUrl);
    url.searchParams.set("key", key);
    url.searchParams.set("num", String(Math.min(Math.max(input.num ?? 10, 1), 50)));
    url.searchParams.set("page", String(Math.max(input.page ?? 1, 1)));
    url.searchParams.set("form", "1");
    if (input.word) url.searchParams.set("word", input.word);

    const response = await fetch(url, { next: { revalidate: 900 } });
    if (!response.ok) throw new AppError("DATA_PROVIDER_ERROR", `天行财经新闻请求失败：${response.status}`);

    const payload = (await response.json()) as TianApiResponse;
    if (payload.code === 200) return payload.result?.list ?? [];
    if (payload.code === 130) throw new AppError("RATE_LIMIT", "天行财经新闻接口调用频率超限。", payload);
    if (payload.code === 150) throw new AppError("RATE_LIMIT", "天行财经新闻接口可用次数不足。", payload);
    if (payload.code === 190 || payload.code === 230 || payload.code === 240) {
      throw new AppError("DATA_PROVIDER_ERROR", "天行财经新闻 API key 无效。请确认 .env 里的 TIANAPI_KEY 是天行数据控制台的真实 key，保存后重启 stocks-web。", payload);
    }
    if (payload.code === 250) return [];
    throw new AppError("DATA_PROVIDER_ERROR", payload.msg ?? "天行财经新闻接口返回错误。", payload);
  }
}

function normalizeEnvValue(value?: string) {
  return value?.trim().replace(/^["']|["']$/g, "");
}

function isPlaceholderKey(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "change_me_tianapi_key" || normalized === "your_tianapi_key" || normalized.includes("change_me");
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
