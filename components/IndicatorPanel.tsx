import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { IndicatorSnapshot } from "@/lib/types";
import { formatNumber } from "@/lib/utils";

const rows: Array<{ key: keyof IndicatorSnapshot; label: string }> = [
  { key: "rsi14", label: "RSI 14" },
  { key: "macd", label: "MACD" },
  { key: "macdSignal", label: "MACD 信号线" },
  { key: "sma20", label: "20 日均线" },
  { key: "sma50", label: "50 日均线" },
  { key: "sma200", label: "200 日均线" },
  { key: "ema20", label: "20 日 EMA" },
  { key: "bollingerUpper", label: "布林上轨" },
  { key: "bollingerMiddle", label: "布林中轨" },
  { key: "bollingerLower", label: "布林下轨" }
];

export function IndicatorPanel({ indicators, price }: { indicators: IndicatorSnapshot; price?: number | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>技术指标</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {rows.map((row) => (
            <div key={row.key} className="rounded-md border border-border bg-muted/25 p-3">
              <div className="text-xs text-muted-foreground">{row.label}</div>
              <div className="mt-1 text-sm font-semibold tabular-nums">{formatNumber(indicators[row.key] as number | null)}</div>
            </div>
          ))}
        </div>
        <div className="space-y-2 rounded-md border border-border p-3">
          <StateRow label="RSI 状态" value={rsiState(indicators.rsi14)} />
          <StateRow label="MACD 状态" value={macdState(indicators.macd, indicators.macdSignal)} />
          <StateRow label="SMA20" value={maState(price, indicators.sma20)} />
          <StateRow label="SMA50" value={maState(price, indicators.sma50)} />
          <StateRow label="SMA200" value={maState(price, indicators.sma200)} />
        </div>
      </CardContent>
    </Card>
  );
}

function StateRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Badge variant="secondary">{value}</Badge>
    </div>
  );
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
  return price >= ma ? "价格高于均线" : "价格低于均线";
}
