"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Newspaper, RefreshCw } from "lucide-react";

import { NewsCard, type NewsCardData } from "@/components/NewsCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function NewsPanel({ symbol, name }: { symbol: string; name?: string | null }) {
  const [news, setNews] = useState<NewsCardData[]>([]);
  const [lowNews, setLowNews] = useState<NewsCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const allNews = useMemo(() => [...news, ...lowNews], [news, lowNews]);
  const overview = useMemo(() => buildNewsOverview(allNews), [allNews]);

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
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message ?? "加载新闻失败。");
      const sorted = sortNews(json.news ?? []);
      setNews(sorted.filter((item: NewsCardData) => item.importance !== "low"));
      setLowNews(sorted.filter((item: NewsCardData) => item.importance === "low"));
      setUpdatedAt(new Date().toLocaleString("zh-CN"));
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
      const response = await fetch("/api/news/fetch", { method: "POST" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message ?? "抓取新闻失败。");
      const searchReports = Array.isArray(json.webSearchReports) ? json.webSearchReports : [];
      const searchText = searchReports.length
        ? `联网搜索：${searchReports
            .slice(0, 3)
            .map((report: { symbol?: string; status?: string; resultCount?: number }) => `${report.symbol ?? "未知"} ${report.status ?? "未返回状态"}，命中 ${report.resultCount ?? 0} 条`)
            .join("；")}`
        : "联网搜索未触发。";
      setMessage(`抓取完成：保存 ${json.saved ?? 0} 条，过滤不相关新闻 ${json.filteredOut ?? 0} 条，新闻分析任务 ${json.queued ?? 0} 个。${searchText}`);
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
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message ?? "创建新闻分析任务失败。");
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
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Newspaper className="h-4 w-4 text-primary" />
          <div>
            <CardTitle>相关新闻</CardTitle>
            <div className="mt-1 text-xs text-muted-foreground">按股票名称和行业关键词过滤；只有高重要性新闻才进入 AI 精读任务。</div>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={fetchNews} disabled={fetching}>
          <RefreshCw className={fetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          {fetching ? "抓取中" : "抓取新闻"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {updatedAt ? <div className="text-xs text-muted-foreground">最近加载：{updatedAt}</div> : null}
        {message ? <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">{message}</div> : null}
        {error ? <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div> : null}
        {!loading && allNews.length ? <NewsOverview overview={overview} /> : null}
        {loading ? (
          <div className="py-8 text-sm text-muted-foreground">正在加载新闻...</div>
        ) : news.length === 0 && lowNews.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">暂无匹配该股票或行业关键词的新闻。点击“抓取新闻”后会更新。</div>
        ) : (
          <>
            {news.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                暂无 high/medium 相关新闻。已抓取到 {lowNews.length} 条低重要性新闻，默认折叠显示。
              </div>
            ) : null}
            {news.slice(0, 10).map((item) => (
              <NewsCard key={item.id} item={item} onAnalyze={item.importance === "high" ? analyze : undefined} />
            ))}
            {lowNews.length ? (
              <details className="rounded-md border border-border bg-muted/15 p-3">
                <summary className="cursor-pointer text-sm text-muted-foreground">低重要性新闻 {lowNews.length} 条</summary>
                <div className="mt-3 space-y-3">
                  {lowNews.slice(0, 10).map((item) => (
                    <NewsCard key={item.id} item={item} />
                  ))}
                </div>
              </details>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function NewsOverview({ overview }: { overview: ReturnType<typeof buildNewsOverview> }) {
  return (
    <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
      <div className="text-sm font-medium">{overview.hasAi ? "AI 新闻总览" : "新闻概览"}</div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{overview.text}</p>
      <p className="mt-2 text-xs text-muted-foreground">新闻分析可能遗漏上下文，仅供研究参考，不构成投资建议。</p>
    </div>
  );
}

function buildNewsOverview(items: NewsCardData[]) {
  const high = items.filter((item) => (item.analyses?.[0]?.impactLevel ?? item.importance) === "high").length;
  const medium = items.filter((item) => (item.analyses?.[0]?.impactLevel ?? item.importance) === "medium").length;
  const analyzed = items.filter((item) => item.analyses?.length);
  const sentiment = countSentiment(items);
  const top = items
    .slice(0, 3)
    .map((item) => item.analyses?.[0]?.aiSummary ?? item.summary ?? item.title)
    .filter(Boolean)
    .join("；");

  return {
    hasAi: analyzed.length > 0,
    text: analyzed.length
      ? `已纳入 ${items.length} 条相关新闻，其中高影响 ${high} 条、中等影响 ${medium} 条。AI 已精读 ${analyzed.length} 条，当前情绪分布：正面 ${sentiment.positive}、中性 ${sentiment.neutral}、负面 ${sentiment.negative}。重点摘要：${top || "暂无摘要"}`
      : `已纳入 ${items.length} 条相关新闻，其中高重要性 ${high} 条、中等重要性 ${medium} 条。暂未完成 AI 精读，当前先按关键词和来源展示。重点标题：${top || "暂无摘要"}`
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
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });
}
