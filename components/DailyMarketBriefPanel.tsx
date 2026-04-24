"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Brief = {
  id: string;
  date: string;
  watchlistSummary: string;
  sectorSummary: string;
  riskSummary: string;
  createdAt: string;
};

export function DailyMarketBriefPanel() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/briefs/daily", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message ?? "加载每日简报失败。");
      setBrief(json.brief);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载每日简报失败。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function generate() {
    setLoading(true);
    setError(null);
    const response = await fetch("/api/briefs/daily/generate", { method: "POST" });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error?.message ?? "生成每日简报失败。");
      setLoading(false);
      return;
    }
    setBrief(json.brief);
    setLoading(false);
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <CardTitle>每日市场简报</CardTitle>
        </div>
        <Button size="sm" variant="outline" onClick={generate}>
          <RefreshCw className="h-4 w-4" />
          生成
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div> : null}
        {loading ? (
          <div className="py-8 text-sm text-muted-foreground">正在加载简报...</div>
        ) : !brief ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">今天还没有生成市场简报。</div>
        ) : (
          <>
            <BriefBlock title="自选股" text={brief.watchlistSummary} />
            <BriefBlock title="行业" text={brief.sectorSummary} />
            <BriefBlock title="风险" text={brief.riskSummary} />
            <p className="border-t pt-3 text-xs text-muted-foreground">AI 市场简报可能遗漏上下文，仅供研究参考。</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function BriefBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <div className="mb-1 text-xs uppercase text-muted-foreground">{title}</div>
      <p className="text-sm leading-6">{text}</p>
    </div>
  );
}
