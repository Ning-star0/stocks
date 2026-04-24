import type { NewsProvider } from "@/lib/news/NewsProvider";
import type { NewsItem } from "@/lib/types";

const sectorBySymbol: Record<string, string> = {
  AAPL: "消费科技",
  MSFT: "云软件",
  NVDA: "AI 芯片",
  TSLA: "电动车",
  AMZN: "电商",
  META: "数字广告",
  GOOGL: "搜索与 AI"
};

export class MockNewsProvider implements NewsProvider {
  async searchCompanyNews(symbol: string, from: string, to: string): Promise<NewsItem[]> {
    const normalized = symbol.toUpperCase();
    const sector = sectorBySymbol[normalized] ?? inferAshareSector(normalized);
    return buildMockItems(
      [normalized],
      [sector],
      [
        {
          title: `${normalized} earnings guidance 更新：市场重新评估短期风险`,
          summary: `${normalized} 的模拟业绩与指引新闻，用于本地开发验证高重要性新闻流程。`
        },
        {
          title: `${normalized} price target 观察：机构调整板块估值假设`,
          summary: `${normalized} 的模拟目标价新闻，用于验证 medium/high 新闻展示。`
        }
      ],
      from,
      to
    );
  }

  async searchTopicNews(keywords: string[], from: string, to: string): Promise<NewsItem[]> {
    const cleanKeywords = keywords.map((keyword) => keyword.trim()).filter(Boolean);
    const sector = cleanKeywords[0] ?? "市场主题";
    return buildMockItems(
      [],
      [sector],
      (cleanKeywords.length ? cleanKeywords : ["宏观流动性"]).map((keyword) => ({
        title: `${keyword} revenue guidance 主题更新：资金关注度变化`,
        summary: `${keyword} 的模拟行业新闻，用于本地开发验证新闻面板。`
      })),
      from,
      to
    );
  }
}

function buildMockItems(
  symbols: string[],
  sectors: string[],
  topics: Array<{ title: string; summary: string }>,
  _from: string,
  to: string
): NewsItem[] {
  return topics.slice(0, 4).map((topic, index) => {
    const publishedAt = new Date(to);
    publishedAt.setHours(publishedAt.getHours() - index * 7);
    const slug = `${topic.title.toLowerCase().replace(/\s+/g, "-")}-${publishedAt.getTime()}`;
    return {
      title: topic.title,
      url: `https://mock.news/${encodeURIComponent(slug)}`,
      source: "模拟市场新闻",
      publishedAt: publishedAt.toISOString(),
      rawContent:
        `这是一条关于 ${topic.title} 的本地开发模拟新闻。内容讨论需求信号、估值敏感度、行业仓位和宏观不确定性。它不是真实新闻，仅用于验证新闻抓取、重要性评分和后台任务流程。`,
      summary: topic.summary,
      symbols,
      sectors
    };
  });
}

function inferAshareSector(symbol: string) {
  if (symbol.startsWith("561380")) return "电网设备";
  if (symbol.startsWith("51") || symbol.startsWith("56") || symbol.startsWith("58")) return "ETF";
  return "A股";
}
