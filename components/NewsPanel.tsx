"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Newspaper, RefreshCw } from "lucide-react";

import { NewsCard, type NewsCardData } from "@/components/NewsCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { readJsonResponse } from "@/lib/clientApi";
import { toSimplifiedChinese } from "@/lib/text/simplifiedChinese";

export function NewsPanel({
  symbol,
  name,
  newsFetchTime,
  lastNewsFetch
}: {
  symbol: string;
  name?: string | null;
  newsFetchTime?: string | null;
  lastNewsFetch?: string | null;
}) {
  const [news, setNews] = useState<NewsCardData[]>([]);
  const [lowNews, setLowNews] = useState<NewsCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allNews = useMemo(() => [...news, ...lowNews], [news, lowNews]);
  const analyzedNews = useMemo(() => allNews.filter((item) => item.analyses?.[0]?.aiSummary), [allNews]);
  const overview = useMemo(() => buildNewsOverview(allNews), [allNews]);
  const newsSnapshotLabel = useMemo(() => formatNewsSnapshotTime(lastNewsFetch, newsFetchTime), [lastNewsFetch, newsFetchTime]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        symbol,
        includeLow: "1",
        pageSize: "20"
      });
      if (name) params.set("name", name);
      const response = await fetch(`/api/news?${params.toString()}`, { cache: "no-store" });
      const json = await readJsonResponse<{ news?: NewsCardData[] }>(response);
      const sorted = sortNews(Array.isArray(json.news) ? json.news.map(simplifyNewsItem) : []);
      setNews(sorted.filter((item: NewsCardData) => item.importance !== "low"));
      setLowNews(sorted.filter((item: NewsCardData) => item.importance === "low"));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载新闻失败。");
    } finally {
      setLoading(false);
    }
  }, [symbol, name]);

  useEffect(() => {
    load();
  }, [load]);

  async function fetchNews() {
    setError(null);
    setMessage(null);
    setFetching(true);
    try {
      const response = await fetch("/api/news/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, name })
      });
      const json = await readJsonResponse<{ saved?: number; queued?: number; webSearchReports?: Array<{ symbol?: string; status?: string; resultCount?: number }> }>(response);
      const searchReports = Array.isArray(json.webSearchReports) ? json.webSearchReports : [];
      const currentReport = searchReports.find((report: { symbol?: string }) => report.symbol?.toUpperCase() === symbol.toUpperCase()) ?? searchReports[0];
      const searchText = currentReport
        ? `${currentReport.symbol ?? symbol}：${shortText(String(currentReport.status ?? "未返回状态"), 160)}，入库 ${currentReport.resultCount ?? 0} 条`
        : "联网搜索未触发。";
      setMessage(`本标的保存 ${json.saved ?? 0} 条，新闻分析任务 ${json.queued ?? 0} 个。${searchText}`);
      await load();
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "抓取新闻失败。");
    } finally {
      setFetching(false);
    }
  }

  async function analyze(id: string) {
    try {
      const response = await fetch(`/api/news/${id}/analyze`, { method: "POST" });
      const json = await readJsonResponse<{ jobId?: string }>(response);
      if (json.jobId) {
        setMessage("高重要性新闻已加入 AI 精读队列，worker 处理完成后会显示结果。");
        return;
      }
      await load();
    } catch (analyzeError) {
      setError(analyzeError instanceof Error ? analyzeError.message : "创建新闻分析任务失败。");
    }
  }

  return (
    <Card className="performance-card overflow-hidden">
      <CardHeader className="gap-3 border-b border-border/70 bg-muted/10 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Newspaper className="h-4 w-4 text-primary" />
            <CardTitle>相关新闻</CardTitle>
            <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">{allNews.length} 条</span>
            {analyzedNews.length ? <span className="rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs text-primary">AI 精读 {analyzedNews.length}</span> : null}
          </div>
          <Button size="sm" variant="outline" onClick={fetchNews} disabled={fetching}>
            <RefreshCw className={fetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            {fetching ? "抓取中" : "抓取新闻"}
          </Button>
        </div>
        <div className="rounded-lg border border-border/70 bg-background/45 px-3 py-2 text-xs leading-5 text-muted-foreground">{newsSnapshotLabel}</div>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        {message ? <div className="glow-card rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-200">{message}</div> : null}
        {error ? <div className="glow-card rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div> : null}
        {!loading && allNews.length ? <NewsOverview overview={overview} /> : null}
        {loading ? (
          <div className="glow-card rounded-xl border border-border bg-muted/10 px-4 py-8 text-sm text-muted-foreground">正在加载新闻...</div>
        ) : news.length === 0 && lowNews.length === 0 ? (
          <div className="glow-card rounded-xl border border-dashed border-border bg-muted/10 p-6 text-center text-sm text-muted-foreground">暂无匹配该股票或行业关键词的新闻。点击“抓取新闻”后会更新。</div>
        ) : (
          <>
            <AnalyzedNewsSummaries items={analyzedNews} />
            <details className="glow-card rounded-xl border border-border bg-muted/15 p-3">
              <summary className="cursor-pointer text-sm text-muted-foreground">展开新闻列表 {allNews.length} 条</summary>
              <div className="mt-3 space-y-2">
                {news.slice(0, 8).map((item) => (
                  <NewsCard key={item.id} item={item} onAnalyze={item.importance === "high" ? analyze : undefined} />
                ))}
              </div>
              {lowNews.length ? (
                <details className="glow-card mt-3 rounded-xl border border-border bg-background/30 p-3">
                  <summary className="cursor-pointer text-sm text-muted-foreground">低重要性新闻 {lowNews.length} 条</summary>
                  <div className="mt-3 space-y-2">
                    {lowNews.slice(0, 10).map((item) => (
                      <NewsCard key={item.id} item={item} />
                    ))}
                  </div>
                </details>
              ) : null}
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function AnalyzedNewsSummaries({ items }: { items: NewsCardData[] }) {
  if (!items.length) {
    return (
      <div className="glow-card rounded-xl border border-dashed border-border bg-background/20 p-3 text-sm text-muted-foreground">
        暂无 AI 精读新闻摘要。高重要性新闻完成精读后会显示在这里；原始新闻已折叠在下方。
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.slice(0, 3).map((item) => {
        const analysis = item.analyses?.[0];
        const riskNotes = Array.isArray(analysis?.riskNotes) ? analysis.riskNotes.filter(Boolean) : [];
        return (
          <div key={item.id} className="glow-card rounded-xl border border-border bg-muted/20 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{shortText(toSimplifiedChinese(item.title), 48)}</span>
              <span>{analysis?.impactLevel ?? item.importance}</span>
              <span>{analysis?.sentiment ?? item.sentiment ?? "neutral"}</span>
            </div>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{toSimplifiedChinese(analysis?.aiSummary ?? "")}</p>
            {analysis?.whyItMatters ? (
              <p className="mt-1 text-xs leading-5 text-muted-foreground">影响：{toSimplifiedChinese(analysis.whyItMatters)}</p>
            ) : null}
            {riskNotes.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {riskNotes.slice(0, 3).map((note) => (
                  <span key={note} className="rounded border border-border bg-background/40 px-2 py-1 text-xs text-muted-foreground">
                    {toSimplifiedChinese(note)}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function NewsOverview({ overview }: { overview: ReturnType<typeof buildNewsOverview> }) {
  return (
    <div className="grid gap-2 md:grid-cols-3">
      {overview.points.map((point) => (
        <div key={point.label} className="glow-card rounded-xl border border-primary/20 bg-primary/5 p-3">
          <div className="text-xs text-muted-foreground">{point.label}</div>
          <div className="mt-1 text-sm font-semibold text-foreground">{point.value}</div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{point.detail}</p>
        </div>
      ))}
    </div>
  );
}

function buildNewsOverview(items: NewsCardData[]) {
  const high = items.filter((item) => (item.analyses?.[0]?.impactLevel ?? item.importance) === "high").length;
  const medium = items.filter((item) => (item.analyses?.[0]?.impactLevel ?? item.importance) === "medium").length;
  const analyzedItems = items.filter((item) => item.analyses?.[0]?.aiSummary);
  const analyzed = analyzedItems.length;
  const sentiment = countSentiment(items);
  const summaryPoints = analyzedItems.slice(0, 3).map((item) => {
    const analysis = item.analyses?.[0];
    const text = analysis?.aiSummary || analysis?.whyItMatters || item.summary || item.title;
    return shortText(toSimplifiedChinese(text), 60);
  });

  return {
    points: [
      {
        label: "新闻数量",
        value: `${items.length} 条`,
        detail: `高重要性 ${high} 条，中等重要性 ${medium} 条，AI 已精读 ${analyzed} 条。`
      },
      {
        label: "情绪分布",
        value: `正 ${sentiment.positive} / 中 ${sentiment.neutral} / 负 ${sentiment.negative}`,
        detail: "情绪来自新闻原始标记或 AI 精读结果。"
      },
      {
        label: "内容要点",
        value: summaryPoints.length ? "已提炼" : "待精读",
        detail: summaryPoints.length ? summaryPoints.join("；") : "暂无 AI 精读摘要，暂不根据标题推断新闻主线。"
      }
    ]
  };
}

function countSentiment(items: NewsCardData[]) {
  return items.reduce(
    (acc, item) => {
      const value = item.analyses?.[0]?.sentiment ?? item.sentiment ?? "neutral";
      if (value === "positive" || value === "negative" || value === "neutral") acc[value] += 1;
      return acc;
    },
    { positive: 0, neutral: 0, negative: 0 }
  );
}

function sortNews(items: NewsCardData[]) {
  const weight: Record<string, number> = { high: 3, medium: 2, low: 1 };
  return [...items].sort((a, b) => {
    const impactA = String(a.analyses?.[0]?.impactLevel ?? a.importance ?? "low");
    const impactB = String(b.analyses?.[0]?.impactLevel ?? b.importance ?? "low");
    const levelDiff = (weight[impactB] ?? 0) - (weight[impactA] ?? 0);
    if (levelDiff) return levelDiff;
    return safeTime(b.publishedAt) - safeTime(a.publishedAt);
  });
}

function safeTime(value?: string | null) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function formatNewsSnapshotTime(lastNewsFetch?: string | null, newsFetchTime?: string | null) {
  const scheduled = newsFetchTime ? `每日 ${newsFetchTime}` : "每日定时";
  if (!lastNewsFetch) return `新闻截取：尚未完成，计划 ${scheduled} 抓取一次；AI 分析复用已入库新闻。`;
  const date = new Date(lastNewsFetch);
  if (Number.isNaN(date.getTime())) return `新闻截取：${lastNewsFetch}，计划 ${scheduled} 抓取一次；AI 分析复用已入库新闻。`;
  return `新闻截取：${date.toLocaleString("zh-CN")}，计划 ${scheduled} 抓取一次；AI 分析复用已入库新闻。`;
}

function shortText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function simplifyNewsItem(item: NewsCardData): NewsCardData {
  return {
    ...item,
    title: toSimplifiedChinese(item.title),
    source: item.source ? toSimplifiedChinese(item.source) : item.source,
    summary: item.summary ? toSimplifiedChinese(item.summary) : item.summary,
    sectors: Array.isArray(item.sectors) ? item.sectors.map(toSimplifiedChinese) : item.sectors,
    analyses: item.analyses?.map((analysis) => ({
      ...analysis,
      aiSummary: analysis.aiSummary ? toSimplifiedChinese(analysis.aiSummary) : analysis.aiSummary,
      affectedSectors: Array.isArray(analysis.affectedSectors) ? analysis.affectedSectors.map(toSimplifiedChinese) : analysis.affectedSectors,
      riskNotes: Array.isArray(analysis.riskNotes) ? analysis.riskNotes.map(toSimplifiedChinese) : analysis.riskNotes,
      whyItMatters: analysis.whyItMatters ? toSimplifiedChinese(analysis.whyItMatters) : analysis.whyItMatters
    }))
  };
}
