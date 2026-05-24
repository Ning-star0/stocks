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
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(data?.items ?? []).map((item) => (
              <UsageCard key={item.key} item={item} />
            ))}
          </div>
        )}
        {data?.generatedAt ? <div className="mt-3 text-xs text-muted-foreground">统计时间：{new Date(data.generatedAt).toLocaleString("zh-CN")}</div> : null}
      </CardContent>
    </Card>
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
