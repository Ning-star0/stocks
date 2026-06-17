"use client";

import Link from "next/link";
import { Activity, BarChart3 } from "lucide-react";

import { TrendBadge } from "@/components/TrendBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber, formatPercent, formatPriceValue } from "@/lib/utils";

type StockCardProps = {
  symbol: string;
  name?: string | null;
  price?: number | null;
  currency?: string | null;
  changePercent?: number | null;
  volume?: number | null;
  trend?: string | null;
  summary?: string | null;
};

export function StockCard({ symbol, name, price, currency, changePercent, volume, trend, summary }: StockCardProps) {
  const isUp = changePercent !== null && changePercent !== undefined && changePercent >= 0;

  return (
    <Link href={`/stocks/${symbol}`}>
      <Card className="glow-click-card h-full transition-colors hover:border-primary/60">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <div className="flex items-start gap-2">
            <BarChart3 className="mt-0.5 h-4 w-4 text-primary" />
            <div>
              <CardTitle>{name ?? symbol}</CardTitle>
              {name ? <div className="mt-1 text-xs text-muted-foreground">{symbol}</div> : null}
            </div>
          </div>
          <TrendBadge trend={trend} />
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <div className="text-2xl font-semibold tabular-nums">{formatPriceValue(price, { currency, symbol })}</div>
            <div className={isUp ? "text-sm text-emerald-500" : "text-sm text-red-500"}>{formatPercent(changePercent)}</div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Activity className="h-3.5 w-3.5" />
            成交量 {formatNumber(volume)}
          </div>
          <p className="line-clamp-2 text-sm text-muted-foreground">{summary ?? "暂无 AI 分析"}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
