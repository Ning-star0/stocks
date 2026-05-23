import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { IndicatorSnapshot } from "@/lib/types";
import { formatNumber } from "@/lib/utils";

export function IndicatorPanel({ indicators, price }: { indicators: IndicatorSnapshot; price?: number | null }) {
  const rows = [
    { label: "RSI14", value: indicators.rsi14, state: rsiState(indicators.rsi14) },
    { label: "MACD", value: indicators.macd, state: macdState(indicators.macd, indicators.macdSignal) },
    { label: "MACD 信号", value: indicators.macdSignal, state: "--" },
    { label: "SMA20", value: indicators.sma20, state: maState(price, indicators.sma20) },
    { label: "SMA50", value: indicators.sma50, state: maState(price, indicators.sma50) },
    { label: "SMA200", value: indicators.sma200, state: maState(price, indicators.sma200) },
    { label: "EMA20", value: indicators.ema20, state: maState(price, indicators.ema20) },
    { label: "布林上轨", value: indicators.bollingerUpper, state: "压力" },
    { label: "布林中轨", value: indicators.bollingerMiddle, state: "中枢" },
    { label: "布林下轨", value: indicators.bollingerLower, state: "支撑" }
  ];
  return (
    <Card className="soft-card">
      <CardHeader>
        <CardTitle>技术指标</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-lg border border-border">
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-border px-3 py-2.5 text-sm last:border-b-0">
              <div className="text-muted-foreground">{row.label}</div>
              <div className="font-semibold tabular-nums">{formatNumber(row.value)}</div>
              <StateBadge value={row.state} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
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
