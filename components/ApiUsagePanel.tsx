"use client";

import { BarChart3, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ApiQuotaVisibility, NewsRefreshCapacity, QuotaAlertLevel } from "@/lib/apiQuotaVisibility";
import { readJsonResponse } from "@/lib/clientApi";

type UsageItem = {
  key: string;
  label: string;
  provider: string;
  usedToday: number;
  usedMonth: number;
  unit: string;
  dailyLimit: number | null;
  monthlyLimit: number | null;
  remainingToday: number | null;
  remainingMonth: number | null;
  quotaVisibility?: ApiQuotaVisibility;
};

type UsageResponse = {
  generatedAt: string;
  items: UsageItem[];
  newsQuota?: NewsRefreshCapacity;
  aiModels?: ModelUsageItem[];
  aiCost?: {
    currency: string;
    today: number;
    month: number;
  };
  aiBalance?: {
    provider: "deepseek";
    available: boolean;
    checkedAt: string;
    error?: string;
    balanceInfos: Array<{
      currency: string;
      totalBalance: string;
      grantedBalance: string;
      toppedUpBalance: string;
    }>;
  } | null;
};

type ModelUsageItem = {
  model: string;
  usedToday: number;
  usedMonth: number;
  callsToday: number;
  callsMonth: number;
  promptTokensToday: number;
  promptTokensMonth: number;
  completionTokensToday: number;
  completionTokensMonth: number;
  cacheHitTokensToday: number;
  cacheHitTokensMonth: number;
  cacheMissTokensToday: number;
  cacheMissTokensMonth: number;
  estimatedCostToday: number;
  estimatedCostMonth: number;
};

export function ApiUsagePanel() {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/usage", { cache: "no-store" });
      const json = await readJsonResponse<UsageResponse>(response);
      setData(json);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取接口用量失败。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const usageItems = data?.items ?? [];
  const aiItems = usageItems.filter((item) => item.key.startsWith("ai_"));
  const externalItems = usageItems.filter((item) => !item.key.startsWith("ai_"));

  return (
    <Card className="performance-card overflow-hidden">
      <CardHeader className="border-b border-border/70 bg-muted/10 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              API 用量与剩余额度
            </CardTitle>
            <p className="mt-2 text-xs text-muted-foreground">
              新闻额度同时核对本项目本地账本与服务商官方用量；共享密钥产生的差异会单独显示。
            </p>
          </div>
          <Button className="shrink-0" size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            刷新
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-4">
        {error ? <div className="glow-card mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div> : null}
        {loading && !data ? (
          <div className="glow-card rounded-xl border border-border/70 bg-muted/10 px-4 py-8 text-sm text-muted-foreground">正在读取用量...</div>
        ) : (
          <>
            {data?.aiCost ? <AiCostSummary cost={data.aiCost} balance={data.aiBalance ?? null} /> : null}
            {data?.newsQuota ? <NewsQuotaSummaryPanel summary={data.newsQuota} /> : null}
            <UsageSection title="AI 消耗" description="模型调用、Token 与本地估算费用。适合判断今天是否消耗异常。" items={aiItems} compact />
            <UsageSection title="外部接口" description="行情、历史 K 线、新闻和联网检索的调用情况。联网检索默认关闭，只在启用兜底搜索时计数。" items={externalItems} />
            <AiModelUsageTable rows={data?.aiModels ?? []} currency={data?.aiCost?.currency ?? ""} />
          </>
        )}
        {data?.generatedAt ? <div className="text-xs text-muted-foreground">统计时间：{new Date(data.generatedAt).toLocaleString("zh-CN")}</div> : null}
      </CardContent>
    </Card>
  );
}

function NewsQuotaSummaryPanel({ summary }: { summary: NewsRefreshCapacity }) {
  const capacity = summary.estimatedRoutineStockRefreshes;
  const statusText = quotaAlertText(summary.alertLevel);
  const detail = summary.basis === "no_external_provider"
    ? "当前没有可纳入预算估算的外部新闻源。"
    : summary.basis === "limits_not_configured"
      ? "已配置新闻源，但额度上限不完整，无法可靠估算剩余刷新次数。"
      : `按已配置来源的单股最坏调用上限估算${summary.limitingProvider ? `，当前瓶颈为 ${summary.limitingProvider}` : ""}。`;

  return (
    <div className="glow-card rounded-xl border border-primary/20 bg-primary/5 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-medium">新闻检索额度治理</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
        </div>
        <Badge variant={quotaAlertVariant(summary.alertLevel)}>{statusText}</Badge>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Metric
          label="预计剩余普通股票刷新"
          value={capacity === null ? "无法估算" : `${capacity.toLocaleString("zh-CN")} 只`}
          strong
        />
        <Metric label="普通检索" value={summary.routineAllowed ? "允许" : "已停止"} />
        <Metric label="95% 后" value="仅关键风险核验" />
      </div>
      {summary.providers.length ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          {summary.providers.map((provider) => (
            <span key={provider.provider} className="rounded-full border border-border/70 bg-background/60 px-2.5 py-1">
              {provider.provider}：每只最多 {provider.maxCallsPerRefresh} 次，剩余 {provider.estimatedRoutineRefreshes ?? "未设上限"} 只
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AiCostSummary({
  cost,
  balance
}: {
  cost: { currency: string; today: number; month: number };
  balance: UsageResponse["aiBalance"];
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_1fr_0.9fr]">
      <CostCard label="今日 AI 估算费用" value={formatCost(cost.today, cost.currency)} />
      <CostCard label="本月 AI 估算费用" value={formatCost(cost.month, cost.currency)} />
      <BalanceCard balance={balance} />
    </div>
  );
}

function BalanceCard({ balance }: { balance: UsageResponse["aiBalance"] }) {
  const primary = balance?.balanceInfos?.[0] ?? null;
  return (
    <div className="glow-card rounded-xl border border-border/70 bg-background/35 p-4 text-sm leading-6">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-medium text-muted-foreground">DeepSeek 官方余额</div>
        {balance ? <Badge variant={balance.available ? "success" : "warning"}>{balance.available ? "可用" : "不可用"}</Badge> : <Badge variant="secondary">未接入</Badge>}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-normal text-foreground tabular-nums">
        {primary ? `${Number(primary.totalBalance).toLocaleString("zh-CN", { maximumFractionDigits: 4 })} ${primary.currency}` : "--"}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {balance?.error
          ? balance.error
          : primary
            ? `充值余额 ${primary.toppedUpBalance}，赠金 ${primary.grantedBalance}。`
            : "费用估算来自本地 Token 记录，余额来自 DeepSeek 账户接口。"}
      </p>
    </div>
  );
}

function CostCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="glow-card rounded-xl border border-primary/15 bg-primary/5 p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-normal text-foreground tabular-nums">{value}</div>
    </div>
  );
}

function UsageSection({ title, description, items, compact = false }: { title: string; description: string; items: UsageItem[]; compact?: boolean }) {
  if (!items.length) return null;
  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold tracking-normal">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <span className="text-xs text-muted-foreground">{items.length} 项</span>
      </div>
      <div className={`grid gap-3 ${compact ? "md:grid-cols-2" : "md:grid-cols-2 xl:grid-cols-4"}`}>
        {items.map((item) => (
          <UsageCard key={item.key} item={item} />
        ))}
      </div>
    </section>
  );
}

function AiModelUsageTable({ rows, currency }: { rows: ModelUsageItem[]; currency: string }) {
  if (!rows.length) return null;
  return (
    <div className="glow-card rounded-xl border border-border/70 bg-background/35 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">AI 模型 Token 明细</div>
          <p className="mt-1 text-xs text-muted-foreground">按实际记录模型统计；缓存命中/未命中来自 DeepSeek 返回值，应用缓存不会计为模型调用。</p>
        </div>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b border-border/70">
              <th className="py-2 pr-3 text-left font-medium">模型</th>
              <th className="px-3 py-2 text-right font-medium">今日 Token</th>
              <th className="px-3 py-2 text-right font-medium">本月 Token</th>
              <th className="px-3 py-2 text-right font-medium">今日调用</th>
              <th className="px-3 py-2 text-right font-medium">本月调用</th>
              <th className="px-3 py-2 text-right font-medium">今日费用</th>
              <th className="px-3 py-2 text-right font-medium">本月费用</th>
              <th className="pl-3 py-2 text-right font-medium">输入 / 输出</th>
              <th className="pl-3 py-2 text-right font-medium">缓存命中 / 未命中</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.model} className="border-b border-border/60 last:border-0">
                <td className="py-2 pr-3 font-medium">{row.model}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.usedToday.toLocaleString("zh-CN")}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.usedMonth.toLocaleString("zh-CN")}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.callsToday.toLocaleString("zh-CN")}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.callsMonth.toLocaleString("zh-CN")}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCost(row.estimatedCostToday, currency)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCost(row.estimatedCostMonth, currency)}</td>
                <td className="pl-3 py-2 text-right tabular-nums text-muted-foreground">
                  {row.promptTokensMonth.toLocaleString("zh-CN")} / {row.completionTokensMonth.toLocaleString("zh-CN")}
                </td>
                <td className="pl-3 py-2 text-right tabular-nums text-muted-foreground">
                  {row.cacheHitTokensMonth.toLocaleString("zh-CN")} / {row.cacheMissTokensMonth.toLocaleString("zh-CN")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UsageCard({ item }: { item: UsageItem }) {
  const quota = item.quotaVisibility;
  const monthPercent = quota?.usagePercentMonth ?? (item.monthlyLimit ? Math.round((item.usedMonth / item.monthlyLimit) * 100) : null);
  const todayPercent = quota?.usagePercentToday ?? (item.dailyLimit ? Math.round((item.usedToday / item.dailyLimit) * 100) : null);
  return (
    <div className="glow-card glow-click-card rounded-xl border border-border/70 bg-background/45 p-4 transition-colors hover:border-primary/25">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">{item.label}</div>
          <div className="mt-1 text-xs text-muted-foreground">{item.provider}</div>
        </div>
        <Badge variant={quota ? quotaAlertVariant(quota.alertLevel) : statusVariant(monthPercent)}>
          {quota ? quotaAlertText(quota.alertLevel) : monthPercent === null ? "未设额度" : `${formatPercent(monthPercent)}`}
        </Badge>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Metric label={quota ? "本地今日" : "今日已用"} value={formatUsage(item.usedToday, item.unit)} />
        <Metric label={quota ? "本地本月" : "本月已用"} value={formatUsage(item.usedMonth, item.unit)} strong />
      </div>
      {quota ? <QuotaDetails quota={quota} unit={item.unit} /> : null}
      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>今日剩余 {formatRemaining(item.remainingToday, item.unit)}</span>
        <span>本月剩余 {formatRemaining(item.remainingMonth, item.unit)}</span>
      </div>
      <div className="mt-3 space-y-1.5">
        <ProgressLine label="今日" percent={todayPercent} />
        <ProgressLine label="本月" percent={monthPercent} />
      </div>
    </div>
  );
}

function QuotaDetails({ quota, unit }: { quota: ApiQuotaVisibility; unit: string }) {
  const gap = quota.officialLocalGapMonth;
  return (
    <div className="mt-3 space-y-1 rounded-lg border border-border/70 bg-muted/15 px-3 py-2 text-xs leading-5 text-muted-foreground">
      <div className="flex items-center justify-between gap-3">
        <span>官方今日</span>
        <span className="text-right">服务商未提供日维度</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span>官方本月</span>
        <span className="text-right tabular-nums">
          {quota.officialAvailable && quota.officialUsedMonth !== null ? formatUsage(quota.officialUsedMonth, unit) : "未接入 / 同步失败"}
        </span>
      </div>
      {gap !== null ? (
        <div className="flex items-center justify-between gap-3">
          <span>官方－本地差异</span>
          <span className={gap > 0 ? "text-amber-700 dark:text-amber-300" : "tabular-nums"}>{formatSigned(gap, unit)}</span>
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <span>生效口径（含预占）</span>
        <span className="tabular-nums">{formatUsage(quota.effectiveUsedMonth, unit)}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span>关键风险储备（日 / 月）</span>
        <span className="text-right tabular-nums">{formatRemaining(quota.criticalReserveToday, unit)} / {formatRemaining(quota.criticalReserveMonth, unit)}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span>普通查询剩余（日 / 月）</span>
        <span className="text-right tabular-nums">{formatRemaining(quota.routineRemainingToday, unit)} / {formatRemaining(quota.routineRemainingMonth, unit)}</span>
      </div>
      {quota.officialSyncedAt ? <div>官方同步：{new Date(quota.officialSyncedAt).toLocaleString("zh-CN")}</div> : null}
      {quota.officialError ? <div className="text-amber-700 dark:text-amber-300">官方用量不可用：{quota.officialError}</div> : null}
      {gap !== null && gap > 0 ? <div className="text-amber-700 dark:text-amber-300">差异可能来自共享密钥的其他项目消耗，不能归因于本项目。</div> : null}
    </div>
  );
}

function ProgressLine({ label, percent }: { label: string; percent: number | null }) {
  return (
    <div className="grid grid-cols-[2.5rem_1fr_2.5rem] items-center gap-2 text-[11px] text-muted-foreground">
      <span>{label}</span>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent ?? 0}%` }} />
      </div>
      <span className="text-right tabular-nums">{percent === null ? "--" : formatPercent(percent)}</span>
    </div>
  );
}

function Metric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`mt-1 truncate tabular-nums ${strong ? "text-lg font-semibold text-foreground" : "font-medium text-foreground"}`}>{value}</div>
    </div>
  );
}

function formatUsage(value: number, unit: string) {
  return `${value.toLocaleString("zh-CN")} ${unit}`;
}

function formatRemaining(value: number | null, unit: string) {
  return value === null ? "未设置" : `${value.toLocaleString("zh-CN")} ${unit}`;
}

function statusVariant(percent: number | null) {
  if (percent === null) return "secondary";
  if (percent >= 95) return "danger";
  if (percent >= 70) return "warning";
  return "success";
}

function quotaAlertVariant(level: QuotaAlertLevel) {
  if (level === "critical_95" || level === "exhausted") return "danger";
  if (level === "notice_70" || level === "warning_85") return "warning";
  if (level === "normal") return "success";
  return "secondary";
}

function quotaAlertText(level: QuotaAlertLevel) {
  if (level === "exhausted") return "100% 已耗尽";
  if (level === "critical_95") return "95% 仅关键核验";
  if (level === "warning_85") return "85% 高消耗";
  if (level === "notice_70") return "70% 提醒";
  if (level === "normal") return "额度正常";
  return "额度未设置";
}

function formatPercent(value: number) {
  return `${Number(value.toFixed(2))}%`;
}

function formatSigned(value: number, unit: string) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toLocaleString("zh-CN")} ${unit}`;
}

function formatCost(value: number, currency: string) {
  const suffix = currency ? ` ${currency}` : "";
  return `${Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 6 })}${suffix}`;
}
