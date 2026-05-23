import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";

import { CollapsiblePanel } from "@/components/CollapsiblePanel";
import { StrategyBadge, trendToStrategy } from "@/components/StrategyBadge";
import { TrendBadge } from "@/components/TrendBadge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getPrimaryAdvice, type PositionContext } from "@/lib/positionAdvice";
import type { AiAnalysisResult } from "@/lib/types";
import { formatPriceValue, toNumber } from "@/lib/utils";

export function AiAnalysisPanel({
  analysis,
  createdAt,
  fromCache,
  currency,
  symbol,
  unit,
  position
}: {
  analysis?: AiAnalysisResult | null;
  createdAt?: string | Date | null;
  fromCache?: boolean;
  currency?: string;
  symbol?: string;
  unit?: string;
  position?: PositionContext | null;
}) {
  if (!analysis) {
    return (
      <Card className="soft-card">
        <CardHeader>
          <CardTitle>AI 策略观察</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">暂无 AI 分析，可点击重新分析。</CardContent>
      </Card>
    );
  }

  const dataScope = analysis.dataScope;
  const confidence = toNumber(analysis.confidence) ?? 0;
  const support = Array.isArray(analysis.keyLevels?.support) ? analysis.keyLevels.support : [];
  const resistance = Array.isArray(analysis.keyLevels?.resistance) ? analysis.keyLevels.resistance : [];
  const riskFactors = Array.isArray(analysis.riskFactors) ? analysis.riskFactors : [];
  const possibleActions = Array.isArray(analysis.possibleActions) ? analysis.possibleActions : [];
  const newsReferences = Array.isArray(analysis.newsReferences) ? analysis.newsReferences : [];
  const webSearchResults = Array.isArray(analysis.webSearchResults) ? analysis.webSearchResults : [];
  const primaryAdvice = getPrimaryAdvice(analysis, position);

  return (
    <Card className="soft-card">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>AI 策略观察</CardTitle>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>生成：{formatTime(createdAt)}</span>
            <Badge variant="secondary">置信度 {formatConfidence(confidence)}</Badge>
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

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <StrategyBadge tone={trendToStrategy(analysis.trend).tone}>策略方向：{trendToStrategy(analysis.trend).label}</StrategyBadge>
              <StrategyBadge tone={actionTone(primaryAdvice.action)}>当前动作：{primaryAdvice.action || "继续观察"}</StrategyBadge>
              <Badge variant="secondary">风险等级：{riskLevelText(riskFactors)}</Badge>
            </div>
            <h3 className="mt-4 text-xl font-semibold">{strategyHeadline(analysis, primaryAdvice.action)}</h3>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">{analysis.summary || primaryAdvice.reason || "暂无摘要。"}</p>
          </div>
          <div className="grid gap-2 rounded-xl border border-border bg-muted/15 p-4 text-sm">
            <ScopeLine label="置信度" value={formatConfidence(confidence)} />
            <ScopeLine label="适合状态" value={primaryAdvice.isHolding ? "持仓跟踪" : "未持仓观察"} />
            <ScopeLine label="当前动作" value={primaryAdvice.action || "继续观察"} />
            <ScopeLine label="截至" value={formatTime(analysis.analysisAsOf)} />
          </div>
        </div>

        {analysis.holdAdvice || analysis.entryAdvice ? (
          <PrimaryAdviceCard analysis={analysis} primaryAdvice={primaryAdvice} />
        ) : (
          <Block title="可能操作计划">
            <div className="space-y-2">
              {possibleActions.length ? (
                possibleActions.map((item, index) => (
                  <div key={`${item.action}-${index}`} className="rounded-md border border-border bg-muted/20 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-foreground">{formatAction(item.action)}</div>
                      {item.timing ? <Badge variant="secondary">{item.timing}</Badge> : null}
                    </div>
                    <div className="mt-2 text-sm leading-6 text-muted-foreground">{item.reason}</div>
                    <ActionGrid item={item} currency={currency} symbol={symbol} unit={unit} />
                    <div className="mt-3 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                      失效条件：{item.invalidIf}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-sm text-muted-foreground">暂无操作计划。</div>
              )}
            </div>
          </Block>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <LevelList title="支撑位" values={support} currency={currency} symbol={symbol} unit={unit} />
          <LevelList title="压力位" values={resistance} currency={currency} symbol={symbol} unit={unit} />
        </div>

        <Block title="风险因素">
          <List values={riskFactors} />
        </Block>

        {analysis.newsSummary ? (
          <Block title="新闻摘要">
            <p className="text-sm leading-6">{analysis.newsSummary}</p>
            <ReferenceList items={newsReferences} />
          </Block>
        ) : null}

        <CollapsiblePanel title="分析依据与数据来源">
          <div className="space-y-4">
            {dataScope ? (
              <div className="grid gap-2 rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground md:grid-cols-2">
                <ScopeLine label="报价时间" value={formatTime(dataScope.quoteTime)} />
                <ScopeLine label="历史数据" value={`${dataScope.historyRange ?? "--"} / ${dataScope.historyInterval ?? "--"}，${dataScope.historyCandles ?? 0} 根 K 线`} />
                <ScopeLine label="历史范围" value={`${formatDate(dataScope.historyFrom)} 至 ${formatDate(dataScope.historyTo)}`} />
                <ScopeLine label="新闻范围" value={dataScope.newsWindow ?? "--"} />
                <ScopeLine label="新闻数量" value={`${dataScope.newsCount ?? 0} 条传入 AI`} />
                <ScopeLine label="联网检索" value={dataScope.webSearchStatus ?? "--"} />
              </div>
            ) : null}
            {analysis.webSearchSummary ? <p className="text-sm leading-6 text-muted-foreground">{analysis.webSearchSummary}</p> : null}
            <SearchResultList items={webSearchResults} />
          </div>
        </CollapsiblePanel>

        <p className="border-t pt-4 text-xs text-muted-foreground">{analysis.disclaimer || "本内容由 AI 生成，仅供研究参考，不构成投资建议。"}</p>
      </CardContent>
    </Card>
  );
}

function PrimaryAdviceCard({
  analysis,
  primaryAdvice
}: {
  analysis: AiAnalysisResult;
  primaryAdvice: ReturnType<typeof getPrimaryAdvice>;
}) {
  const secondary = primaryAdvice.isHolding ? analysis.entryAdvice : analysis.holdAdvice;
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-primary/25 bg-background/45 p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold text-primary">
          <span>{primaryAdvice.isHolding ? "持仓策略" : "交易情景"}</span>
          <Badge variant="secondary">{primaryAdvice.isHolding ? "持仓跟踪" : "未持仓观察"}</Badge>
        </div>
        {primaryAdvice.action ? (
          <div className="mb-3">
            <StrategyBadge tone={actionTone(primaryAdvice.action)}>{primaryAdvice.action}</StrategyBadge>
          </div>
        ) : null}
        <div className="mb-3 text-sm leading-6 text-muted-foreground">{primaryAdvice.reason}</div>
        {primaryAdvice.isHolding ? (
          <HoldAdviceDetails advice={analysis.holdAdvice ?? null} />
        ) : (
          <EntryAdviceDetails advice={analysis.entryAdvice ?? null} />
        )}
      </div>
      {secondary ? (
        <details className="rounded-md border border-border bg-muted/15 p-3">
          <summary className="cursor-pointer text-sm text-muted-foreground">查看另一种交易情景</summary>
          <div className="mt-3 text-sm leading-6 text-muted-foreground">{secondary.reason}</div>
        </details>
      ) : null}
    </div>
  );
}

function HoldAdviceDetails({ advice }: { advice: AiAnalysisResult["holdAdvice"] }) {
  if (!advice) return null;
  return (
    <>
      <div className="space-y-2 text-sm">
        {advice.stopLoss ? <AdviceRow label="止损计划" value={advice.stopLoss} /> : null}
        {advice.takeProfit ? <AdviceRow label="止盈计划" value={advice.takeProfit} /> : null}
        {advice.positionManagement ? <AdviceRow label="仓位管理" value={advice.positionManagement} /> : null}
        {advice.keyMonitorPoints ? <AdviceRow label="关注重点" value={advice.keyMonitorPoints} /> : null}
      </div>
      {advice.invalidIf ? (
        <div className="mt-3 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          失效条件：{advice.invalidIf}
        </div>
      ) : null}
    </>
  );
}

function EntryAdviceDetails({ advice }: { advice: AiAnalysisResult["entryAdvice"] }) {
  if (!advice) return null;
  return (
    <>
      <div className="space-y-2 text-sm">
        {advice.entryZone ? <AdviceRow label="入场区间" value={advice.entryZone} /> : null}
        {advice.timing ? <AdviceRow label="时间窗口" value={advice.timing} /> : null}
        {advice.triggerCondition ? <AdviceRow label="触发条件" value={advice.triggerCondition} /> : null}
        {advice.firstPositionSize ? <AdviceRow label="首次仓位" value={advice.firstPositionSize} /> : null}
        {advice.stopLoss ? <AdviceRow label="止损计划" value={advice.stopLoss} /> : null}
        {advice.takeProfit ? <AdviceRow label="止盈目标" value={advice.takeProfit} /> : null}
      </div>
      {advice.invalidIf ? (
        <div className="mt-3 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          失效条件：{advice.invalidIf}
        </div>
      ) : null}
    </>
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

function AdviceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 rounded-md bg-background/40 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function ActionGrid({
  item,
  currency,
  symbol,
  unit
}: {
  item: AiAnalysisResult["possibleActions"][number];
  currency?: string;
  symbol?: string;
  unit?: string;
}) {
  const rows = [
    ["触发条件", item.triggerCondition],
    ["参考区间", formatActionValue(item.entryZone, currency, symbol, unit)],
    ["止损计划", formatActionValue(item.stopLossPlan, currency, symbol, unit)],
    ["止盈计划", formatActionValue(item.takeProfitPlan, currency, symbol, unit)],
    ["仓位建议", item.positionSizing],
    ["复盘重点", item.followUpCheck]
  ].filter((row): row is [string, string] => Boolean(row[1]));

  if (!rows.length) return null;

  return (
    <div className="mt-3 grid gap-2 md:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-md border border-border bg-background/40 px-3 py-2">
          <div className="text-[11px] text-muted-foreground">{label}</div>
          <div className="mt-1 text-sm leading-5 text-foreground">{value}</div>
        </div>
      ))}
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

function formatActionValue(value?: string, currency?: string, symbol?: string, unit?: string) {
  if (!value) return "";
  void currency;
  void symbol;
  void unit;
  return value;
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
  const meta = `${item.source ?? "未知来源"}${item.publishedAt ? ` · ${formatTime(item.publishedAt)}` : ""}${item.impactLevel ? ` · ${item.impactLevel}` : ""}`;

  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
      {item.url ? (
        <a className="flex flex-col gap-1 hover:text-primary" href={item.url} target="_blank" rel="noreferrer">
          <span className="flex items-center gap-1 font-medium text-foreground">
            {item.title}
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          </span>
          <span className="text-xs text-muted-foreground">{meta}</span>
          {summary ? <span className="line-clamp-2 text-xs text-muted-foreground">{summary}</span> : null}
        </a>
      ) : (
        <div className="flex flex-col gap-1">
          <span className="font-medium text-foreground">{item.title}</span>
          <span className="text-xs text-muted-foreground">{meta}</span>
          {summary ? <span className="line-clamp-2 text-xs text-muted-foreground">{summary}</span> : null}
        </div>
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

function actionTone(action?: string): "watch" | "wait" | "avoid" | "bullish" | "neutral" {
  const text = action ?? "";
  if (/回避|止损|减仓|离场|不建议/.test(text)) return "avoid";
  if (/等待|回调|观察|观望/.test(text)) return "wait";
  if (/入场|建仓|试探|加仓|增持/.test(text)) return "bullish";
  return "watch";
}

function strategyHeadline(analysis: AiAnalysisResult, action?: string) {
  const trend = trendToStrategy(analysis.trend).label;
  if (/等待|回调|观察|观望/.test(action ?? "")) return `${trend}，但不宜追高`;
  if (/回避|止损|减仓|离场|不建议/.test(action ?? "")) return `${trend}，优先控制风险`;
  if (/入场|建仓|试探|加仓|增持/.test(action ?? "")) return `${trend}，等待触发条件`;
  return `${trend}，保持策略观察`;
}

function riskLevelText(values: string[]) {
  const text = values.join(" ");
  if (/高|重大|过热|止损|下跌|风险/.test(text)) return "高";
  if (values.length) return "中";
  return "低";
}

function formatTime(value?: string | Date | null) {
  if (!value) return "--";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN");
}

function formatDate(value?: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-CN");
}
