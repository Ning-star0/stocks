import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";

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
            <span>生成：{createdAt ? new Date(createdAt).toLocaleString("zh-CN") : "最新报告"}</span>
            {analysis.analysisAsOf ? <span>截至：{new Date(analysis.analysisAsOf).toLocaleString("zh-CN")}</span> : null}
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

        {analysis.dataScope ? (
          <Block title="分析口径">
            <div className="grid gap-2 rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground md:grid-cols-2">
              <ScopeLine label="报价时间" value={formatTime(analysis.dataScope.quoteTime)} />
              <ScopeLine label="历史数据" value={`${analysis.dataScope.historyRange ?? "--"} / ${analysis.dataScope.historyInterval ?? "--"}，${analysis.dataScope.historyCandles ?? 0} 根 K 线`} />
              <ScopeLine label="历史范围" value={`${formatDate(analysis.dataScope.historyFrom)} 至 ${formatDate(analysis.dataScope.historyTo)}`} />
              <ScopeLine label="新闻范围" value={analysis.dataScope.newsWindow ?? "--"} />
              <ScopeLine label="新闻数量" value={`${analysis.dataScope.newsCount ?? 0} 条传入 AI`} />
              <ScopeLine label="联网检索" value={analysis.dataScope.webSearchStatus ?? "--"} />
            </div>
          </Block>
        ) : null}

        <Block title="摘要">
          <p className="text-sm leading-6">{analysis.summary}</p>
        </Block>

        {analysis.newsSummary ? (
          <Block title="新闻摘要">
            <p className="text-sm leading-6">{analysis.newsSummary}</p>
            <ReferenceList items={analysis.newsReferences ?? []} />
          </Block>
        ) : null}

        {(analysis.webSearchSummary || analysis.webSearchResults?.length) ? (
          <Block title="联网新闻检索">
            {analysis.webSearchSummary ? <p className="text-sm leading-6">{analysis.webSearchSummary}</p> : null}
            <SearchResultList items={analysis.webSearchResults ?? []} />
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

function ScopeLine({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-3">
      <span>{label}</span>
      <span className="text-right text-foreground">{value || "--"}</span>
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

function ReferenceList({
  items
}: {
  items: Array<{ title: string; source?: string | null; publishedAt?: string | null; url?: string | null; sentiment?: string | null; impactLevel?: string | null }>;
}) {
  if (!items.length) return null;

  return (
    <div className="mt-3 space-y-2">
      {items.slice(0, 5).map((item) => (
        <NewsLink key={`${item.title}-${item.url ?? ""}`} item={item} />
      ))}
    </div>
  );
}

function SearchResultList({
  items
}: {
  items: Array<{ title: string; source?: string | null; publishedAt?: string | null; url?: string | null; summary?: string | null }>;
}) {
  if (!items.length) return <div className="text-sm text-muted-foreground">暂无联网检索结果。</div>;

  return (
    <div className="mt-3 space-y-2">
      {items.slice(0, 6).map((item) => (
        <NewsLink key={`${item.title}-${item.url ?? ""}`} item={item} summary={item.summary} />
      ))}
    </div>
  );
}

function NewsLink({
  item,
  summary
}: {
  item: { title: string; source?: string | null; publishedAt?: string | null; url?: string | null; sentiment?: string | null; impactLevel?: string | null };
  summary?: string | null;
}) {
  const content = (
    <>
      <span className="font-medium text-foreground">{item.title}</span>
      <span className="text-xs text-muted-foreground">
        {item.source ?? "未知来源"}
        {item.publishedAt ? ` · ${formatTime(item.publishedAt)}` : ""}
        {item.impactLevel ? ` · ${item.impactLevel}` : ""}
      </span>
      {summary ? <span className="line-clamp-2 text-xs text-muted-foreground">{summary}</span> : null}
    </>
  );

  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
      {item.url ? (
        <a className="flex flex-col gap-1 hover:text-primary" href={item.url} target="_blank" rel="noreferrer">
          <span className="flex items-center gap-1">
            {content}
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          </span>
        </a>
      ) : (
        <div className="flex flex-col gap-1">{content}</div>
      )}
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

function formatTime(value?: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN");
}

function formatDate(value?: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-CN");
}
