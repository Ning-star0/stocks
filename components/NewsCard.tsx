"use client";

import { ExternalLink } from "lucide-react";

import { ImpactLevelBadge } from "@/components/ImpactLevelBadge";
import { NewsSentimentBadge } from "@/components/NewsSentimentBadge";
import { Button } from "@/components/ui/button";
import { toSimplifiedChinese } from "@/lib/text/simplifiedChinese";
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
  const summary = toSimplifiedChinese(analysis?.aiSummary ?? item.summary ?? "暂无摘要");
  const canAnalyze = Boolean(onAnalyze && impact === "high" && !analysis);
  const confidence = toNumber(analysis?.confidence);
  const sectors = Array.isArray(item.sectors) ? item.sectors.map(toSimplifiedChinese) : [];
  const riskNotes = Array.isArray(analysis?.riskNotes) ? analysis.riskNotes.map(toSimplifiedChinese) : [];

  return (
    <details className="group glow-card glow-click-card rounded-xl border border-border bg-card px-3 py-2">
      <summary className="grid cursor-pointer list-none gap-2 md:grid-cols-[auto_auto_minmax(0,1fr)_auto] md:items-center">
        <div className="flex items-center gap-2">
          <ImpactLevelBadge level={impact} />
          <NewsSentimentBadge sentiment={sentiment} />
        </div>
        <div className="text-xs text-muted-foreground">{formatTime(item.publishedAt)}</div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">{cleanTitle(item.title)}</div>
          <div className="mt-1 truncate text-xs text-muted-foreground">{compactSummary(summary)}</div>
        </div>
        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          {confidence !== null ? <span>{(confidence * 100).toFixed(0)}%</span> : null}
          <span className="group-open:hidden">展开</span>
          <span className="hidden group-open:inline">收起</span>
        </div>
      </summary>

      <div className="mt-3 border-t pt-3">
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>{item.source ? toSimplifiedChinese(item.source) : "未知来源"}</span>
          {sectors.length ? <span>{sectors.slice(0, 3).join(", ")}</span> : null}
          {item.url ? (
            <a className="inline-flex items-center gap-1 text-primary hover:underline" href={item.url} target="_blank" rel="noreferrer">
              原文链接
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
        </div>
        <p className="glow-card mt-3 max-h-32 overflow-auto rounded-xl border border-border bg-muted/20 p-3 text-sm leading-6 text-muted-foreground">{compactSummary(summary, 420)}</p>
        {analysis?.whyItMatters ? <p className="mt-2 text-xs text-muted-foreground">影响说明：{toSimplifiedChinese(analysis.whyItMatters)}</p> : null}
        {riskNotes.length ? (
          <div className="mt-3 space-y-1">
            {riskNotes.slice(0, 3).map((note) => (
              <div key={note} className="glow-card rounded-lg border border-border bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
                {note}
              </div>
            ))}
          </div>
        ) : null}
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">AI 新闻分析可能遗漏上下文，仅供研究参考。</p>
          {canAnalyze ? (
            <Button size="sm" variant="outline" onClick={() => onAnalyze?.(item.id)}>
              AI 精读
            </Button>
          ) : null}
        </div>
      </div>
    </details>
  );
}

function formatTime(value?: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN");
}

function cleanTitle(value: string) {
  return toSimplifiedChinese(value).replace(/^Title[:：]\s*/i, "").replace(/\s+/g, " ").trim();
}

function compactSummary(value: string, maxLength = 110) {
  const cleaned = toSimplifiedChinese(value)
    .replace(/^Title[:：]\s*/i, "")
    .replace(/#+\s*/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned;
}
