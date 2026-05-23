"use client";

import { Activity, Bot, Database, KeyRound, Loader2, RefreshCw, Server, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type HealthResponse = {
  ok: boolean;
  database: string;
  aiModel: string;
  aiBaseUrl: string;
  aiKeyConfigured: boolean;
  stockDataProvider: string;
  newsProvider: string;
  backgroundWorkerEnabled: boolean;
  timestamp: string;
};

export function ApiHealthPanel() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message ?? "健康检查失败。");
      setHealth(json);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "健康检查失败。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <Activity className="h-4 w-4 text-primary" />
              实时系统状态
              {health?.ok ? <Badge variant="success">正常</Badge> : error ? <Badge variant="danger">异常</Badge> : <Badge variant="secondary">检测中</Badge>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {health?.timestamp ? `最近检查：${new Date(health.timestamp).toLocaleString("zh-CN")}` : "正在读取 /api/health"}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            刷新状态
          </Button>
        </div>

        {error ? <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div> : null}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatusTile icon={<Database className="h-4 w-4" />} label="数据库" value={health?.database ?? "--"} ok={health?.database === "ok"} />
          <StatusTile icon={<Bot className="h-4 w-4" />} label="AI 模型" value={health?.aiModel ?? "--"} ok={Boolean(health?.aiKeyConfigured)} />
          <StatusTile icon={<KeyRound className="h-4 w-4" />} label="AI Key" value={health?.aiKeyConfigured ? "已配置" : "未配置"} ok={Boolean(health?.aiKeyConfigured)} />
          <StatusTile icon={<Server className="h-4 w-4" />} label="后台 Worker" value={health?.backgroundWorkerEnabled ? "已启用" : "未启用"} ok={Boolean(health?.backgroundWorkerEnabled)} />
          <StatusTile icon={<ShieldCheck className="h-4 w-4" />} label="行情源" value={health?.stockDataProvider ?? "--"} />
          <StatusTile icon={<ShieldCheck className="h-4 w-4" />} label="新闻源" value={health?.newsProvider ?? "--"} />
          <StatusTile icon={<Server className="h-4 w-4" />} label="AI 地址" value={compactUrl(health?.aiBaseUrl)} className="md:col-span-2" />
        </div>
      </CardContent>
    </Card>
  );
}

function StatusTile({
  icon,
  label,
  value,
  ok,
  className
}: {
  icon: ReactNode;
  label: string;
  value: string;
  ok?: boolean;
  className?: string;
}) {
  return (
    <div className={`rounded-md border border-border bg-muted/15 p-3 ${className ?? ""}`}>
      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {icon}
          {label}
        </span>
        {ok === undefined ? null : <span className={ok ? "text-emerald-600 dark:text-emerald-300" : "text-red-600 dark:text-red-300"}>{ok ? "OK" : "检查"}</span>}
      </div>
      <div className="truncate text-sm font-medium">{value}</div>
    </div>
  );
}

function compactUrl(value?: string) {
  if (!value) return "--";
  return value.replace(/^https?:\/\//, "");
}
