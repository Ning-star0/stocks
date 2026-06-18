"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { readJsonResponse } from "@/lib/clientApi";

type AnalysisSummary = {
  summary?: string;
  trend?: string;
  confidence?: number;
  holdAdvice?: { action?: string; reason?: string };
  entryAdvice?: { action?: string; reason?: string };
};

export function FocusAnalysisCard({ symbol }: { symbol: string }) {
  const [analysis, setAnalysis] = useState<AnalysisSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/stocks/${symbol}/analysis/latest`)
      .then((response) => readJsonResponse<{ outputJson?: AnalysisSummary; analysis?: { outputJson?: AnalysisSummary } }>(response))
      .then((data) => {
        setAnalysis(data.outputJson ?? data.analysis?.outputJson ?? null);
      })
      .catch(() => {
        setAnalysis(null);
      })
      .finally(() => setLoading(false));
  }, [symbol]);

  if (loading) {
    return (
      <div className="glow-card flex min-h-36 items-center gap-2 rounded-xl border border-border bg-background/30 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {symbol} 加载中
      </div>
    );
  }
  if (!analysis) {
    return (
      <div className="glow-card min-h-36 rounded-xl border border-dashed border-border bg-background/20 p-4 text-sm text-muted-foreground">
        <div className="font-medium text-foreground">{symbol}</div>
        <p className="mt-2 leading-6">暂无分析。保存配置后，等待下一个自动分析时间触发。</p>
      </div>
    );
  }

  const trend = getTrendMeta(analysis.trend);
  const confidence = Math.round((analysis.confidence ?? 0) * 100);
  const summary = makeFriendlySummary(analysis.summary);

  return (
    <div className="glow-card flex min-h-48 flex-col rounded-xl border border-border bg-background/30 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold tabular-nums">{symbol}</div>
          <div className="mt-1 text-xs text-muted-foreground">置信度 {confidence}%</div>
        </div>
        <Badge variant={trend.variant}>{trend.label}</Badge>
      </div>
      <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">{summary}</p>
      <div className="mt-4 space-y-2 border-t border-border pt-3 text-sm">
        {analysis.holdAdvice?.action ? <AdviceLine label="持仓" value={analysis.holdAdvice.action} /> : null}
        {analysis.entryAdvice?.action ? <AdviceLine label="入场" value={analysis.entryAdvice.action} /> : null}
      </div>
    </div>
  );
}

function AdviceLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function getTrendMeta(trend?: string): { label: string; variant: "success" | "warning" | "danger" | "secondary" } {
  if (trend === "bullish") return { label: "偏强", variant: "success" };
  if (trend === "bearish") return { label: "偏弱", variant: "danger" };
  if (trend === "neutral") return { label: "中性", variant: "warning" };
  return { label: "待确认", variant: "secondary" };
}

function makeFriendlySummary(summary?: string) {
  if (!summary) return "暂无摘要。";
  if (summary.includes("AI 服务请求失败") || summary.includes("API 连接失败") || summary.includes("This operation was aborted")) {
    return "AI 服务暂时不可用，当前结果为本地规则生成的临时分析。服务恢复后建议重新分析。";
  }
  return summary.replace(/\s*本分析截至\s*\d{4}-\d{2}-\d{2}T\S+/g, "").trim();
}
