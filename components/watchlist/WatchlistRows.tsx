"use client";

import Link from "next/link";
import { Brain, Eye, Trash2 } from "lucide-react";

import { RiskBadge } from "@/components/RiskBadge";
import { StrategyBadge } from "@/components/StrategyBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { changeClass, formatQuoteStatus, riskLabel } from "@/components/watchlist/model";
import type { WatchlistRowModel } from "@/components/watchlist/types";
import { cn, formatPercent, formatPriceValue } from "@/lib/utils";

export function WatchlistRows({
  rows,
  analyzing,
  onAnalyze,
  onRemove
}: {
  rows: WatchlistRowModel[];
  analyzing: string | null;
  onAnalyze: (symbol: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <>
      <div className="hidden lg:block">
        <Table className="table-fixed">
          <colgroup>
            <col className="w-[18%]" />
            <col className="w-[10%]" />
            <col className="w-[8%]" />
            <col className="w-[9%]" />
            <col className="w-[18%]" />
            <col className="w-[22%]" />
            <col className="w-[15%]" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>名称 / 代码</TableHead>
              <TableHead className="text-right">价格</TableHead>
              <TableHead className="text-right">涨跌幅</TableHead>
              <TableHead>策略方向</TableHead>
              <TableHead>状态 / 动作</TableHead>
              <TableHead>关键理由</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.item.id} className="table-row-focus h-16">
                <TableCell className="py-2.5">
                  <Link href={`/stocks/${row.symbol}`} className="font-semibold text-primary">
                    {row.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">{row.symbol}</div>
                </TableCell>
                <TableCell className="py-2.5 text-right font-medium tabular-nums">
                  {row.quote?.price === null || !row.quote ? (
                    <span className="text-xs text-red-500">{formatQuoteStatus(row.quote?.status)}</span>
                  ) : (
                    formatPriceValue(row.quote.price, { currency: row.quote.currency, symbol: row.quote.symbol })
                  )}
                </TableCell>
                <TableCell className={cn("py-2.5 text-right tabular-nums", changeClass(row.quote?.changePct))}>
                  {row.quote?.changePct === null || !row.quote ? "--" : formatPercent(row.quote.changePct)}
                </TableCell>
                <TableCell className="py-2.5">
                  <StrategyBadge tone={row.strategy.tone}>{row.strategy.label}</StrategyBadge>
                </TableCell>
                <TableCell className="py-2.5">
                  <div className="flex flex-wrap gap-1.5">
                    <RiskBadge risk={riskLabel(row.riskBucket)} />
                    <StrategyBadge tone={row.action.tone}>{row.action.label}</StrategyBadge>
                    <Badge variant={row.isHolding ? "success" : "secondary"}>{row.isHolding ? "已持仓" : "未持仓观察"}</Badge>
                  </div>
                </TableCell>
                <TableCell className="py-2.5">
                  <ReasonTags tags={row.tags} fallback={row.item.note ?? "暂无理由"} />
                </TableCell>
                <TableCell className="py-2.5">
                  <div className="row-actions flex justify-end gap-1.5">
                    <Button size="sm" variant="ghost" className="px-2" asChild>
                      <Link href={`/stocks/${row.symbol}`}>
                        <Eye className="h-4 w-4" />
                        详情
                      </Link>
                    </Button>
                    <Button size="sm" variant="outline" className="px-2" onClick={() => onAnalyze(row.symbol)} disabled={analyzing === row.symbol}>
                      <Brain className="h-4 w-4" />
                      {analyzing === row.symbol ? "排队中" : "分析"}
                    </Button>
                    <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => onRemove(row.item.id)} aria-label={`删除 ${row.symbol}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="space-y-3 lg:hidden">
        {rows.map((row) => (
          <div key={row.item.id} className="motion-card-enter rounded-lg border border-border bg-background/50 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Link href={`/stocks/${row.symbol}`} className="font-semibold text-primary">
                  {row.name}
                </Link>
                <div className="text-xs text-muted-foreground">{row.symbol}</div>
              </div>
              <div className="text-right">
                <div className="font-medium tabular-nums">{formatPriceValue(row.quote?.price, { currency: row.quote?.currency, symbol: row.quote?.symbol ?? row.symbol })}</div>
                <div className={cn("text-xs tabular-nums", changeClass(row.quote?.changePct))}>{formatPercent(row.quote?.changePct)}</div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <StrategyBadge tone={row.strategy.tone}>{row.strategy.label}</StrategyBadge>
              <RiskBadge risk={riskLabel(row.riskBucket)} />
              <StrategyBadge tone={row.action.tone}>{row.action.label}</StrategyBadge>
              <Badge variant={row.isHolding ? "success" : "secondary"}>{row.isHolding ? "已持仓" : "未持仓观察"}</Badge>
            </div>
            <div className="mt-3">
              <ReasonTags tags={row.tags} fallback={row.item.note ?? "暂无理由"} />
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="ghost" asChild>
                <Link href={`/stocks/${row.symbol}`}>
                  <Eye className="h-4 w-4" />
                  详情
                </Link>
              </Button>
              <Button size="sm" variant="outline" onClick={() => onAnalyze(row.symbol)} disabled={analyzing === row.symbol}>
                <Brain className="h-4 w-4" />
                {analyzing === row.symbol ? "排队中" : "分析"}
              </Button>
              <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => onRemove(row.item.id)} aria-label={`删除 ${row.symbol}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function ReasonTags({ tags, fallback }: { tags: string[]; fallback: string }) {
  if (!tags.length) return <span className="text-sm text-muted-foreground">{fallback}</span>;

  const visible = tags.slice(0, 2);
  const hidden = tags.slice(2);
  return (
    <div className="flex flex-wrap gap-1 sm:gap-1.5">
      {visible.map((tag) => (
        <span key={tag} className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground sm:px-2 sm:text-xs">
          {tag}
        </span>
      ))}
      {hidden.length ? (
        <span title={hidden.join("、")} className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground sm:px-2 sm:text-xs">
          +{hidden.length}
        </span>
      ) : null}
    </div>
  );
}
