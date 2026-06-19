"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Bell, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { readJsonResponse } from "@/lib/clientApi";

type AlertRow = {
  id: string;
  symbol: string;
  alertType: string;
  operator: string;
  threshold: number;
  isActive: boolean;
  triggeredAt?: string | null;
  createdAt: string;
  currentValue?: number | null;
  evaluationReason?: string | null;
};

export function AlertRuleForm() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const triggeredCount = alerts.filter((alert) => alert.triggeredAt).length;
  const activeCount = alerts.filter((alert) => alert.isActive && !alert.triggeredAt).length;
  const inactiveCount = alerts.filter((alert) => !alert.isActive).length;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/alerts", { cache: "no-store" });
      const json = await readJsonResponse<{ alerts?: AlertRow[] }>(response);
      setAlerts(json.alerts ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载提醒规则失败。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    try {
      const response = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: String(form.get("symbol") ?? "").toUpperCase(),
          alertType: String(form.get("alertType") ?? "price"),
          operator: String(form.get("operator") ?? "gt"),
          threshold: Number(form.get("threshold") ?? 0)
        })
      });
      await readJsonResponse(response);
      event.currentTarget.reset();
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "创建提醒规则失败。");
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2 md:grid-cols-4">
        <AlertMetric label="全部规则" value={`${alerts.length} 条`} />
        <AlertMetric label="启用中" value={`${activeCount} 条`} tone="success" />
        <AlertMetric label="已触发" value={`${triggeredCount} 条`} tone="warning" />
        <AlertMetric label="已停用" value={`${inactiveCount} 条`} />
      </div>

      {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)] xl:items-start">
        <Card className="performance-card overflow-hidden xl:sticky xl:top-20">
          <CardHeader className="border-b border-border/60 bg-background/20 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>创建提醒规则</CardTitle>
              <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">价格 / RSI / 成交量</span>
            </div>
          </CardHeader>
          <CardContent className="p-4">
            <form className="grid gap-3" onSubmit={onSubmit}>
              <Input name="symbol" placeholder="AAPL" required />
              <Select name="alertType" defaultValue="price">
                <option value="price">价格</option>
                <option value="rsi">RSI</option>
                <option value="volume">成交量倍数</option>
              </Select>
              <Select name="operator" defaultValue="gt">
                <option value="gt">高于</option>
                <option value="lt">低于</option>
              </Select>
              <Input name="threshold" type="number" step="0.01" placeholder="阈值" required />
              <Button type="submit">
                <Bell className="h-4 w-4" />
                创建
              </Button>
            </form>
            <div className="mt-3 rounded-xl border border-border/70 bg-background/35 px-3 py-2 text-xs leading-5 text-muted-foreground">
              规则会按后台任务检查，已触发的规则会保留在列表中用于复盘。
            </div>
          </CardContent>
        </Card>

        <Card className="performance-card overflow-hidden">
          <CardHeader className="flex-row items-center justify-between gap-3 border-b border-border/60 bg-background/20 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>提醒规则</CardTitle>
              <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">{alerts.length} 条</span>
              <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">已触发 {triggeredCount}</span>
            </div>
            <Button size="sm" variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className="h-4 w-4" />
              刷新
            </Button>
          </CardHeader>
          <CardContent className="p-3 sm:p-4">
            {loading ? (
              <div className="glow-card rounded-xl border border-border bg-muted/10 px-4 py-8 text-sm text-muted-foreground">正在加载提醒规则...</div>
            ) : alerts.length === 0 ? (
              <div className="glow-card flex min-h-36 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/10 text-center">
                <div className="text-sm font-medium">还没有提醒规则。</div>
                <p className="text-sm text-muted-foreground">创建价格、RSI 或成交量规则后，会在这里显示触发状态。</p>
              </div>
            ) : (
              <Table className="table-fixed">
                <colgroup>
                  <col className="w-[15%]" />
                  <col className="w-[12%]" />
                  <col className="w-[16%]" />
                  <col className="w-[14%]" />
                  <col className="w-[23%]" />
                  <col className="w-[20%]" />
                </colgroup>
                <TableHeader>
                  <TableRow>
                    <TableHead>代码</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>条件</TableHead>
                    <TableHead>当前值</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>创建时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alerts.map((alert) => (
                    <TableRow key={alert.id} className="table-row-focus h-14">
                      <TableCell className="py-2 font-semibold">{alert.symbol}</TableCell>
                      <TableCell className="py-2">{formatAlertType(alert.alertType)}</TableCell>
                      <TableCell className="py-2">
                        {alert.operator === "gt" ? "高于" : "低于"} {alert.threshold}
                      </TableCell>
                      <TableCell className="py-2 tabular-nums">{alert.currentValue ?? "--"}</TableCell>
                      <TableCell className="py-2">
                        <span className={alertStatusClass(alert)}>
                          {alert.triggeredAt ? "已触发" : alert.evaluationReason ? alert.evaluationReason : alert.isActive ? "启用中" : "已停用"}
                        </span>
                      </TableCell>
                      <TableCell className="py-2 text-muted-foreground">{new Date(alert.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AlertMetric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "success" | "warning" | "neutral" }) {
  return (
    <div className="glow-card rounded-xl border border-border/70 bg-card/80 px-3 py-2.5 shadow-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${tone === "success" ? "text-emerald-500" : tone === "warning" ? "text-amber-500" : "text-foreground"}`}>{value}</div>
    </div>
  );
}

function alertStatusClass(alert: AlertRow) {
  if (alert.triggeredAt) return "rounded-full bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-600 dark:text-amber-300";
  if (!alert.isActive) return "rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground";
  if (alert.evaluationReason) return "rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground";
  return "rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-300";
}

function formatAlertType(type: string) {
  if (type === "price") return "价格";
  if (type === "rsi") return "RSI";
  if (type === "volume") return "成交量";
  return type;
}
