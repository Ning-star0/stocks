"use client";

import { useCallback, useEffect, useState } from "react";
import { Newspaper, RefreshCw } from "lucide-react";

import { NewsCard, type NewsCardData } from "@/components/NewsCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function NewsPanel({ symbol }: { symbol: string }) {
  const [news, setNews] = useState<NewsCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/news?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message ?? "加载新闻失败。");
      const visibleNews = (json.news ?? []).filter((item: NewsCardData) => item.importance !== "low");
      setNews(sortNews(visibleNews));
      setUpdatedAt(new Date().toLocaleString("zh-CN"));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载新闻失败。");
    } finally {
      setLoading(false);
    }
  }, [symbol]);

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
      setMessage(`抓取完成：保存 ${json.saved ?? 0} 条，新闻分析任务 ${json.queued ?? 0} 个。抓取不会触发股票综合分析。`);
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
        setMessage("新闻分析任务已加入队列，worker 处理完成后会显示结果。");
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
            <div className="mt-1 text-xs text-muted-foreground">抓取只更新新闻；只有高重要性新闻才进入新闻分析任务。</div>
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
        {loading ? (
          <div className="py-8 text-sm text-muted-foreground">正在加载新闻...</div>
        ) : news.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            暂无 high/medium 相关新闻。点击“抓取新闻”后会更新此面板。
          </div>
        ) : (
          news.slice(0, 10).map((item) => <NewsCard key={item.id} item={item} onAnalyze={analyze} />)
        )}
      </CardContent>
    </Card>
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
