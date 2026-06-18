"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { readJsonResponse } from "@/lib/clientApi";

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
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/briefs/daily", { cache: "no-store" });
      const json = await readJsonResponse<{ brief: Brief | null }>(response);
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
    setGenerating(true);
    setError(null);
    try {
      const response = await fetch("/api/briefs/daily/generate", { method: "POST" });
      const json = await readJsonResponse<{ brief: Brief | null }>(response);
      setBrief(json.brief);
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "生成每日简报失败。");
    } finally {
      setGenerating(false);
      setLoading(false);
    }
  }

  return (
    <Card className="performance-card overflow-hidden">
      <CardHeader className="flex-row items-center justify-between gap-3 border-b border-border/70 bg-muted/10 p-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <CardTitle>每日市场简报</CardTitle>
          {brief ? <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">{brief.date}</span> : null}
          {brief ? <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">生成：{new Date(brief.createdAt).toLocaleString("zh-CN")}</span> : null}
        </div>
        <Button size="sm" variant="outline" onClick={generate} disabled={generating}>
          <RefreshCw className={generating ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          {generating ? "生成中" : "生成"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        {error ? <div className="glow-card rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div> : null}
        {loading ? (
          <div className="glow-card rounded-xl border border-border bg-muted/10 px-4 py-8 text-sm text-muted-foreground">正在加载简报...</div>
        ) : !brief ? (
          <div className="glow-card rounded-xl border border-dashed border-border bg-muted/10 p-6 text-center text-sm text-muted-foreground">今天还没有生成市场简报。</div>
        ) : (
          <>
            <div className="grid gap-2">
              <BriefBlock title="自选股" text={brief.watchlistSummary} />
              <BriefBlock title="行业" text={brief.sectorSummary} />
              <BriefBlock title="风险" text={brief.riskSummary} tone="risk" />
            </div>
            <p className="rounded-xl border border-border/70 bg-background/35 px-3 py-2 text-xs text-muted-foreground">AI 市场简报可能遗漏上下文，仅供研究参考，不构成投资建议。</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function BriefBlock({ title, text, tone = "default" }: { title: string; text: string; tone?: "default" | "risk" }) {
  return (
    <div className={`rounded-xl border p-3 ${tone === "risk" ? "border-amber-500/25 bg-amber-500/10" : "border-border/70 bg-background/35"}`}>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{title}</div>
      <p className="text-sm leading-6">{text}</p>
    </div>
  );
}
