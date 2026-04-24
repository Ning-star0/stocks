"use client";

import { Area, Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { Candle } from "@/lib/types";
import { formatCurrency, formatNumber } from "@/lib/utils";

export function StockChart({
  candles,
  currency,
  interval = "1d"
}: {
  candles: Candle[];
  currency?: string;
  interval?: string;
}) {
  const isIntraday = ["1m", "5m", "15m", "30m", "60m", "1h"].includes(interval);
  const data = candles.map((candle) => ({
    ...candle,
    date: isIntraday
      ? new Date(candle.timestamp).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : new Date(candle.timestamp).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })
  }));

  return (
    <div className="h-[420px] w-full rounded-lg border bg-card p-3">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} minTickGap={28} />
          <YAxis
            yAxisId="price"
            orientation="right"
            tickFormatter={(value) => formatNumber(value)}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
            domain={[(dataMin: number) => Math.max(0, dataMin * 0.98), (dataMax: number) => dataMax * 1.02]}
          />
          <YAxis yAxisId="volume" hide domain={[0, "dataMax * 5"]} />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              color: "hsl(var(--popover-foreground))"
            }}
            formatter={(value, name) => [name === "volume" ? formatNumber(Number(value)) : formatCurrency(Number(value), currency), name === "volume" ? "成交量" : "收盘价"]}
          />
          <Area yAxisId="price" type="monotone" dataKey="close" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.16)" strokeWidth={2} />
          <Bar yAxisId="volume" dataKey="volume" fill="hsl(var(--accent) / 0.35)" barSize={4} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
