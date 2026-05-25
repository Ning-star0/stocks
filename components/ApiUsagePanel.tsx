"use client";

import { BarChart3, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
};

type UsageResponse = {
  generatedAt: string;
  items: UsageItem[];
  aiModels?: ModelUsageItem[];
  aiCost?: {
    currency: string;
    today: number;
    month: number;
  };
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
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message ?? "读取接口用量失败。");
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

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            API 用量与剩余额度
          </CardTitle>
          <p className="mt-2 text-xs text-muted-foreground">
            剩余额度按本地配置的额度上限计算；未配置额度时显示“未设置”。
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          刷新
        </Button>
      </CardHeader>
      <CardContent>
        {error ? <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div> : null}
        {loading && !data ? (
          <div className="py-6 text-sm text-muted-foreground">正在读取用量...</div>
        ) : (
          <div className="space-y-4">
            {data?.aiCost ? <AiCostSummary cost={data.aiCost} /> : null}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {(data?.items ?? []).map((item) => (
                <UsageCard key={item.key} item={item} />
              ))}
            </div>
            <AiModelUsageTable rows={data?.aiModels ?? []} />
          </div>
        )}
        {data?.generatedAt ? <div className="mt-3 text-xs text-muted-foreground">统计时间：{new Date(data.generatedAt).toLocaleString("zh-CN")}</div> : null}
      </CardContent>
    </Card>
  );
}

function AiCostSummary({ cost }: { cost: { currency: string; today: number; month: number } }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg border border-border bg-muted/10 p-3">
        <div className="text-xs text-muted-foreground">今日 AI 估算费用</div>
        <div className="mt-1 text-xl font-semibold tabular-nums">{formatCost(cost.today, cost.currency)}</div>
      </div>
      <div className="rounded-lg border border-border bg-muted/10 p-3">
        <div className="text-xs text-muted-foreground">本月 AI 估算费用</div>
        <div className="mt-1 text-xl font-semibold tabular-nums">{formatCost(cost.month, cost.currency)}</div>
      </div>
    </div>
  );
}

function AiModelUsageTable({ rows }: { rows: ModelUsageItem[] }) {
  if (!rows.length) return null;
  return (
    <div className="rounded-lg border border-border bg-muted/10 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">AI 模型 Token 明细</div>
          <p className="mt-1 text-xs text-muted-foreground">按实际记录模型统计，包括 Pro / Flash 等不同模型。</p>
        </div>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b border-border">
              <th className="py-2 pr-3 text-left font-medium">模型</th>
              <th className="px-3 py-2 text-right font-medium">今日 Token</th>
              <th className="px-3 py-2 text-right font-medium">本月 Token</th>
              <th className="px-3 py-2 text-right font-medium">今日调用</th>
              <th className="px-3 py-2 text-right font-medium">本月调用</th>
              <th className="px-3 py-2 text-right font-medium">本月费用</th>
              <th className="pl-3 py-2 text-right font-medium">输入 / 输出</th>
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
                <td className="px-3 py-2 text-right tabular-nums">{formatCost(row.estimatedCostMonth, "")}</td>
                <td className="pl-3 py-2 text-right tabular-nums text-muted-foreground">
                  {row.promptTokensMonth.toLocaleString("zh-CN")} / {row.completionTokensMonth.toLocaleString("zh-CN")}
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
  const monthPercent = item.monthlyLimit ? Math.min(100, Math.round((item.usedMonth / item.monthlyLimit) * 100)) : null;
  return (
    <div className="rounded-lg border border-border bg-muted/15 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium">{item.label}</div>
          <div className="mt-1 text-xs text-muted-foreground">{item.provider}</div>
        </div>
        <Badge variant={statusVariant(monthPercent)}>{monthPercent === null ? "未设额度" : `${monthPercent}%`}</Badge>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <Metric label="今日已用" value={formatUsage(item.usedToday, item.unit)} />
        <Metric label="今日剩余" value={formatRemaining(item.remainingToday, item.unit)} />
        <Metric label="本月已用" value={formatUsage(item.usedMonth, item.unit)} />
        <Metric label="本月剩余" value={formatRemaining(item.remainingMonth, item.unit)} />
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${monthPercent ?? 0}%` }} />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background/35 px-2 py-1.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-medium tabular-nums">{value}</div>
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
  if (percent >= 90) return "danger";
  if (percent >= 70) return "warning";
  return "success";
}

function formatCost(value: number, currency: string) {
  const suffix = currency ? ` ${currency}` : "";
  return `${Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 6 })}${suffix}`;
}
