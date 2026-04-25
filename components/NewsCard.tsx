"use client";

import { ExternalLink } from "lucide-react";

import { ImpactLevelBadge } from "@/components/ImpactLevelBadge";
import { NewsSentimentBadge } from "@/components/NewsSentimentBadge";
import { Button } from "@/components/ui/button";
import { toNumber } from "@/lib/utils";

export type NewsCardData = {
  id: string;
  title: string;
  url?: string | null;
  source?: string | null;
  publishedAt: string;
  summary?: string | null;
  symbols: string[];
  sectors: string[];
  sentiment?: string | null;
  importance?: string | null;
  analyses?: Array<{
    aiSummary?: string;
    sentiment?: string;
    impactLevel?: string;
    affectedSymbols?: string[];
    affectedSectors?: string[];
    riskNotes?: string[];
    whyItMatters?: string | null;
    confidence?: number | string | null;
  }>;
};

export function NewsCard({ item, onAnalyze }: { item: NewsCardData; onAnalyze?: (id: string) => void }) {
  const analysis = item.analyses?.[0];
  const sentiment = analysis?.sentiment ?? item.sentiment;
  const impact = analysis?.impactLevel ?? item.importance;
  const summary = analysis?.aiSummary ?? item.summary ?? "暂无摘要";
  const canAnalyze = Boolean(onAnalyze && impact === "high" && !analysis);
  const confidence = toNumber(analysis?.confidence);
  const sectors = Array.isArray(item.sectors) ? item.sectors : [];
  const riskNotes = Array.isArray(analysis?.riskNotes) ? analysis.riskNotes : [];

  return (
    <article className="rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <ImpactLevelBadge level={impact} />
            <NewsSentimentBadge sentiment={sentiment} />
            {confidence !== null ? <span className="text-xs text-muted-foreground">置信度 {(confidence * 100).toFixed(0)}%</span> : null}
          </div>
          <h3 className="text-base font-semibold leading-6">{item.title}</h3>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>{item.source ?? "未知来源"}</span>
            <span>{formatTime(item.publishedAt)}</span>
            {sectors.length ? <span>{sectors.slice(0, 3).join(", ")}</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {canAnalyze ? (
            <Button size="sm" variant="outline" onClick={() => onAnalyze?.(item.id)}>
              AI 精读
            </Button>
          ) : null}
          {item.url ? (
            <Button size="icon" variant="ghost" asChild aria-label="打开原文">
              <a href={item.url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          ) : null}
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{summary}</p>
      {analysis?.whyItMatters ? <p className="mt-2 text-xs text-muted-foreground">影响说明：{analysis.whyItMatters}</p> : null}
      {riskNotes.length ? (
        <div className="mt-3 space-y-1">
          {riskNotes.slice(0, 3).map((note) => (
            <div key={note} className="rounded-md border border-border bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
              {note}
            </div>
          ))}
        </div>
      ) : null}
      <p className="mt-3 text-xs text-muted-foreground">AI 新闻分析可能遗漏上下文，仅供研究参考。</p>
    </article>
  );
}

function formatTime(value?: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN");
}
