"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Bell, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/alerts", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message ?? "加载提醒规则失败。");
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
    const json = await response.json();
    if (!response.ok) {
      setError(json.error?.message ?? "创建提醒规则失败。");
      return;
    }
    event.currentTarget.reset();
    await load();
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>创建提醒规则</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 md:grid-cols-5" onSubmit={onSubmit}>
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
        </CardContent>
      </Card>

      {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div> : null}

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>提醒规则</CardTitle>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-sm text-muted-foreground">正在加载提醒规则...</div>
          ) : alerts.length === 0 ? (
            <div className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-md border border-dashed text-center">
              <div className="text-sm font-medium">还没有提醒规则。</div>
              <p className="text-sm text-muted-foreground">创建价格、RSI 或成交量规则后，会在这里显示触发状态。</p>
            </div>
          ) : (
            <Table>
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
                  <TableRow key={alert.id}>
                    <TableCell className="font-semibold">{alert.symbol}</TableCell>
                    <TableCell>{formatAlertType(alert.alertType)}</TableCell>
                    <TableCell>
                      {alert.operator === "gt" ? "高于" : "低于"} {alert.threshold}
                    </TableCell>
                    <TableCell className="tabular-nums">{alert.currentValue ?? "--"}</TableCell>
                    <TableCell>
                      <span className={alert.triggeredAt ? "text-amber-500" : "text-muted-foreground"}>
                        {alert.triggeredAt ? "已触发" : alert.evaluationReason ? alert.evaluationReason : alert.isActive ? "启用中" : "已停用"}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{new Date(alert.createdAt).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatAlertType(type: string) {
  if (type === "price") return "价格";
  if (type === "rsi") return "RSI";
  if (type === "volume") return "成交量";
  return type;
}
