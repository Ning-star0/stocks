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
      <Card className="performance-card glow-click-card motion-hover-lift h-full transition-all hover:border-primary/40">
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 p-4 pb-2">
          <div className="flex items-start gap-2">
            <BarChart3 className="mt-0.5 h-4 w-4 text-primary" />
            <div>
              <CardTitle>{item.name}</CardTitle>
              <div className="mt-1 text-xs text-muted-foreground">{item.symbol}</div>
            </div>
          </div>
          <span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">{formatQuoteStatus(quote?.status)}</span>
        </CardHeader>
        <CardContent className="space-y-2 p-4 pt-0">
          <div className="flex items-end justify-between gap-3">
            <div className="text-xl font-semibold tabular-nums">{loading ? "--" : formatPriceValue(quote?.price, { symbol: quote?.symbol ?? item.symbol, unit: "point" })}</div>
            <div className={cn("text-sm tabular-nums", changeClass(quote?.changePct))}>{loading ? "--" : formatPercent(quote?.changePct)}</div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" />
              成交量 {loading ? "--" : formatNumber(quote?.volume)}
            </span>
            <span>{quote?.updatedAt ? new Date(quote.updatedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "大盘指数"}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
