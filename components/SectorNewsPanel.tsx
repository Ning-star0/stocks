"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";

import { NewsCard, type NewsCardData } from "@/components/NewsCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type SectorWatch = {
  id: string;
  sectorName: string;
  keywords: string[];
  symbols: string[];
};

export function SectorNewsPanel() {
  const [watches, setWatches] = useState<SectorWatch[]>([]);
  const [news, setNews] = useState<NewsCardData[]>([]);
  const [selectedSector, setSelectedSector] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadWatches = useCallback(async () => {
    const response = await fetch("/api/sectors/watch", { cache: "no-store" });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error?.message ?? "加载行业关注失败。");
    setWatches(json.sectorWatches ?? []);
    if (!selectedSector && json.sectorWatches?.[0]) setSelectedSector(json.sectorWatches[0].sectorName);
  }, [selectedSector]);

  const loadNews = useCallback(async (sector: string) => {
    if (!sector) {
      setNews([]);
      return;
    }
    const response = await fetch(`/api/news?sector=${encodeURIComponent(sector)}`, { cache: "no-store" });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error?.message ?? "加载行业新闻失败。");
    setNews(json.news ?? []);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await loadWatches();
      await loadNews(selectedSector);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载行业新闻失败。");
    } finally {
      setLoading(false);
    }
  }, [loadNews, loadWatches, selectedSector]);

  useEffect(() => {
    load();
  }, [load]);

  async function addWatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const sectorName = String(form.get("sectorName") ?? "");
    const keywords = splitList(String(form.get("keywords") ?? ""));
    const symbols = splitList(String(form.get("symbols") ?? ""));
    const response = await fetch("/api/sectors/watch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectorName, keywords, symbols })
    });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error?.message ?? "添加行业关注失败。");
      return;
    }
    event.currentTarget.reset();
    setSelectedSector(sectorName);
    await loadWatches();
  }

  async function fetchNews() {
    setError(null);
    setMessage(null);
    setFetching(true);
    const response = await fetch("/api/news/fetch", { method: "POST" });
    const json = await response.json();
    setFetching(false);
    if (!response.ok) {
      setError(json.error?.message ?? "抓取新闻失败。");
      return;
    }
    setMessage(`抓取完成：保存 ${json.saved ?? 0} 条，新闻分析任务 ${json.queued ?? 0} 个。`);
    await loadNews(selectedSector);
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>行业新闻窗口</CardTitle>
        <Button size="sm" variant="outline" onClick={fetchNews} disabled={fetching}>
          <RefreshCw className="h-4 w-4" />
          {fetching ? "抓取中" : "抓取"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <form className="grid gap-2 md:grid-cols-[1fr_2fr_1fr_auto]" onSubmit={addWatch}>
          <Input name="sectorName" placeholder="AI 芯片" required />
          <Input name="keywords" placeholder="AI 芯片, GPU 需求, 数据中心" required />
          <Input name="symbols" placeholder="NVDA, AMD" />
          <Button type="submit">
            <Plus className="h-4 w-4" />
            添加
          </Button>
        </form>
        <div className="flex flex-wrap gap-2">
          {watches.map((watch) => (
            <Button key={watch.id} size="sm" variant={selectedSector === watch.sectorName ? "default" : "outline"} onClick={() => setSelectedSector(watch.sectorName)}>
              {watch.sectorName}
            </Button>
          ))}
        </div>
        {message ? <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">{message}</div> : null}
        {error ? <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div> : null}
        {loading ? (
          <div className="py-8 text-sm text-muted-foreground">正在加载行业新闻...</div>
        ) : news.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">暂无行业新闻。添加主题后点击“抓取”。</div>
        ) : (
          <>
            {news.slice(0, 12).map((item) => <NewsCard key={item.id} item={item} />)}
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">低重要性新闻默认归档隐藏。</div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function splitList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
