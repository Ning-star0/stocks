"use client";

import Link from "next/link";
import { Activity, BarChart3 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { changeClass, formatQuoteStatus } from "@/components/watchlist/model";
import type { MarketIndexItem } from "@/components/watchlist/types";
import { cn, formatNumber, formatPercent, formatPriceValue } from "@/lib/utils";

export function MarketIndexCard({ item, loading }: { item: MarketIndexItem; loading: boolean }) {
  const quote = item.quote;
  const href = `/stocks/${quote?.symbol ?? item.symbol}`;

  return (
    <Link href={href}>
      <Card className="performance-card motion-hover-lift h-full transition-all hover:border-primary/40">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <div className="flex items-start gap-2">
            <BarChart3 className="mt-0.5 h-4 w-4 text-primary" />
            <div>
              <CardTitle>{item.name}</CardTitle>
              <div className="mt-1 text-xs text-muted-foreground">{item.symbol}</div>
            </div>
          </div>
          <span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">{formatQuoteStatus(quote?.status)}</span>
        </CardHeader>
        <CardContent className="space-y-2">
          <div>
            <div className="text-xl font-semibold tabular-nums">{loading ? "--" : formatPriceValue(quote?.price, { symbol: quote?.symbol ?? item.symbol, unit: "point" })}</div>
            <div className={cn("text-sm tabular-nums", changeClass(quote?.changePct))}>{loading ? "--" : formatPercent(quote?.changePct)}</div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Activity className="h-3.5 w-3.5" />
            成交量 {loading ? "--" : formatNumber(quote?.volume)}
          </div>
          <p className="text-xs text-muted-foreground">{quote?.updatedAt ? `更新时间 ${new Date(quote.updatedAt).toLocaleString("zh-CN")}` : "大盘指数"}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
