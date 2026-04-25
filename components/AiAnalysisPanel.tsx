import type { ReactNode } from "react";

import { TrendBadge } from "@/components/TrendBadge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AiAnalysisResult } from "@/lib/types";
import { formatPriceValue } from "@/lib/utils";

export function AiAnalysisPanel({
  analysis,
  createdAt,
  fromCache,
  currency,
  symbol,
  unit
}: {
  analysis?: AiAnalysisResult | null;
  createdAt?: string | Date | null;
  fromCache?: boolean;
  currency?: string;
  symbol?: string;
  unit?: string;
}) {
  if (!analysis) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>AI 综合分析</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">暂无 AI 分析，可点击重新分析。</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>AI 综合分析</CardTitle>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{createdAt ? new Date(createdAt).toLocaleString("zh-CN") : "最新报告"}</span>
            <Badge variant="secondary">置信度 {formatConfidence(analysis.confidence)}</Badge>
            {fromCache ? <Badge variant="secondary">缓存结果</Badge> : null}
            {analysis.isFallback ? <Badge variant="danger">本地兜底</Badge> : null}
          </div>
        </div>
        <TrendBadge trend={analysis.trend} />
      </CardHeader>
      <CardContent className="space-y-5">
        {analysis.isFallback && analysis.fallbackReason ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            {analysis.fallbackReason}
          </div>
        ) : null}

        <Block title="摘要">
          <p className="text-sm leading-6">{analysis.summary}</p>
        </Block>

        {analysis.newsSummary ? (
          <Block title="新闻摘要">
            <p className="text-sm leading-6">{analysis.newsSummary}</p>
          </Block>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <LevelList title="支撑位" values={analysis.keyLevels.support} currency={currency} symbol={symbol} unit={unit} />
          <LevelList title="压力位" values={analysis.keyLevels.resistance} currency={currency} symbol={symbol} unit={unit} />
        </div>

        <Block title="风险因素">
          <List values={analysis.riskFactors} />
        </Block>

        <Block title="可能操作计划">
          <div className="space-y-2">
            {analysis.possibleActions.map((item, index) => (
              <div key={`${item.action}-${index}`} className="rounded-md border border-border px-3 py-2">
                <div className="text-sm font-medium">{formatAction(item.action)}</div>
                <div className="mt-1 text-sm text-muted-foreground">{item.reason}</div>
                <div className="mt-2 text-xs text-amber-500">失效条件：{item.invalidIf}</div>
              </div>
            ))}
          </div>
        </Block>

        <p className="border-t pt-4 text-xs text-muted-foreground">{analysis.disclaimer}</p>
      </CardContent>
    </Card>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs uppercase text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function LevelList({ title, values, currency, symbol, unit }: { title: string; values: number[]; currency?: string; symbol?: string; unit?: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 text-xs uppercase text-muted-foreground">{title}</div>
      <div className="flex flex-wrap gap-2">
        {values.length ? (
          values.map((value) => (
            <span key={value} className="rounded bg-secondary px-2 py-1 text-sm tabular-nums">
              {formatPriceValue(value, { currency, symbol, unit })}
            </span>
          ))
        ) : (
          <span className="text-sm text-muted-foreground">--</span>
        )}
      </div>
    </div>
  );
}

function List({ values }: { values: string[] }) {
  return (
    <div className="space-y-2">
      {values.length ? (
        values.map((value, index) => (
          <div key={`${value}-${index}`} className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm">
            {value}
          </div>
        ))
      ) : (
        <div className="text-sm text-muted-foreground">--</div>
      )}
    </div>
  );
}

function formatConfidence(value: number) {
  return `${(Math.max(0, Math.min(1, value)) * 100).toFixed(0)}%`;
}

function formatAction(action: string) {
  const map: Record<string, string> = {
    hold: "持有观察",
    watch: "观察",
    reduce: "降低仓位",
    consider_entry: "考虑入场",
    avoid: "回避"
  };
  return map[action] ?? action;
}
