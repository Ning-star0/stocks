import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { IndicatorSnapshot } from "@/lib/types";
import { formatNumber, formatPriceValue } from "@/lib/utils";

export function IndicatorPanel({
  indicators,
  price,
  support = [],
  resistance = [],
  currency,
  symbol,
  unit
}: {
  indicators: IndicatorSnapshot;
  price?: number | null;
  support?: number[];
  resistance?: number[];
  currency?: string;
  symbol?: string;
  unit?: string;
}) {
  const rows = [
    { label: "RSI14", value: indicators.rsi14, state: rsiState(indicators.rsi14) },
    { label: "MACD", value: indicators.macd, state: macdState(indicators.macd, indicators.macdSignal) },
    { label: "SMA20", value: indicators.sma20, state: maState(price, indicators.sma20) },
    { label: "SMA50", value: indicators.sma50, state: maState(price, indicators.sma50) },
    { label: "SMA200", value: indicators.sma200, state: maState(price, indicators.sma200) },
    { label: "布林上轨", value: indicators.bollingerUpper, state: "压力" },
    { label: "布林中轨", value: indicators.bollingerMiddle, state: "中枢" },
    { label: "布林下轨", value: indicators.bollingerLower, state: "支撑" }
  ];
  return (
    <Card className="performance-card overflow-hidden">
      <CardHeader className="border-b border-border/70 bg-muted/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>技术指标</CardTitle>
          <span className="rounded-full border border-border bg-background/55 px-3 py-1 text-xs text-muted-foreground">{rows.length} 项</span>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        <div className="glow-card overflow-hidden rounded-xl border border-border bg-background/35">
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-border px-3 py-2.5 text-sm last:border-b-0">
              <div className="text-muted-foreground">{row.label}</div>
              <div className="font-semibold tabular-nums">{formatNumber(row.value)}</div>
              <StateBadge value={row.state} />
            </div>
          ))}
        </div>
        <div className="mt-3 grid gap-3 text-sm">
          <LevelLine title="支撑位" values={support} currency={currency} symbol={symbol} unit={unit} />
          <LevelLine title="压力位" values={resistance} currency={currency} symbol={symbol} unit={unit} />
        </div>
      </CardContent>
    </Card>
  );
}

function LevelLine({ title, values, currency, symbol, unit }: { title: string; values: number[]; currency?: string; symbol?: string; unit?: string }) {
  return (
    <div className="glow-card rounded-xl border border-border bg-muted/20 px-3 py-2">
      <div className="text-xs text-muted-foreground">{title}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {values.length ? values.slice(0, 3).map((value) => (
          <span key={value} className="rounded-lg border border-border/70 bg-background/70 px-2 py-1 text-xs font-medium tabular-nums">
            {formatPriceValue(value, { currency, symbol, unit })}
          </span>
        )) : <span className="text-xs text-muted-foreground">--</span>}
      </div>
    </div>
  );
}

function StateBadge({ value }: { value: string }) {
  const variant = /偏空|低于|超买/.test(value) ? "warning" : /高于|偏多|正常/.test(value) ? "success" : "secondary";
  return <Badge variant={variant} className="justify-center whitespace-nowrap">{value}</Badge>;
}

function rsiState(value: number | null) {
  if (value === null) return "--";
  if (value < 30) return "超卖";
  if (value > 70) return "超买";
  return "正常";
}

function macdState(macd: number | null, signal: number | null) {
  if (macd === null || signal === null) return "--";
  if (macd > signal) return "偏多";
  if (macd < signal) return "偏空";
  return "中性";
}

function maState(price?: number | null, ma?: number | null) {
  if (price === null || price === undefined || ma === null || ma === undefined) return "--";
  return price >= ma ? "价高于均线" : "价低于均线";
}
