"use client";

import { MouseEvent, useMemo, useState } from "react";

import type { Candle } from "@/lib/types";
import { formatCurrency, formatNumber } from "@/lib/utils";

type ChartPoint = Candle & {
  date: string;
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  ma60: number | null;
};

const VIEWBOX_WIDTH = 1000;
const VIEWBOX_HEIGHT = 440;
const PRICE_TOP = 42;
const PRICE_HEIGHT = 260;
const VOLUME_TOP = 326;
const VOLUME_HEIGHT = 76;
const CHART_LEFT = 10;
const CHART_RIGHT = 72;
const CHART_BOTTOM = 34;
const CHART_WIDTH = VIEWBOX_WIDTH - CHART_LEFT - CHART_RIGHT;

const maSeries = [
  { key: "ma5", label: "MA5", color: "#f59e0b" },
  { key: "ma10", label: "MA10", color: "#a78bfa" },
  { key: "ma20", label: "MA20", color: "#38bdf8" },
  { key: "ma60", label: "MA60", color: "#f472b6" }
] as const;

export function StockChart({
  candles,
  currency,
  interval = "1d"
}: {
  candles: Candle[];
  currency?: string;
  interval?: string;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const isIntraday = ["1m", "5m", "15m", "30m", "60m", "1h"].includes(interval);
  const data = useMemo(() => buildChartData(candles, isIntraday), [candles, isIntraday]);
  const latest = data[data.length - 1];
  const hovered = hoverIndex === null ? latest : data[hoverIndex] ?? latest;

  const scale = useMemo(() => buildScale(data), [data]);
  const candleWidth = Math.max(2, Math.min(9, scale.step * 0.58));

  function handleMove(event: MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratioX = ((event.clientX - rect.left) / rect.width) * VIEWBOX_WIDTH;
    if (ratioX < CHART_LEFT || ratioX > CHART_LEFT + CHART_WIDTH || data.length === 0) {
      setHoverIndex(null);
      return;
    }
    setHoverIndex(Math.max(0, Math.min(data.length - 1, Math.round((ratioX - CHART_LEFT - scale.step / 2) / scale.step))));
  }

  if (!data.length) {
    return <div className="flex h-[500px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">暂无可展示的 K 线数据。</div>;
  }

  return (
    <div className="w-full rounded-lg border bg-card p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {maSeries.map((item) => (
            <span key={item.key} className="tabular-nums" style={{ color: item.color }}>
              {item.label}: {formatNumber(latest?.[item.key])}
            </span>
          ))}
        </div>
        <div className="text-xs text-muted-foreground">红涨绿跌，均线按当前周期 K 线计算</div>
      </div>

      <div className="grid gap-3 md:grid-cols-[260px_minmax(0,1fr)]">
        {hovered ? <InfoPanel point={hovered} currency={currency} /> : null}
        <div className="h-[500px] w-full overflow-hidden rounded-md bg-[#0d1118]">
          <svg className="h-full w-full" viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`} preserveAspectRatio="none" onMouseMove={handleMove} onMouseLeave={() => setHoverIndex(null)}>
            <defs>
              <clipPath id="price-clip">
                <rect x={CHART_LEFT} y={PRICE_TOP} width={CHART_WIDTH} height={PRICE_HEIGHT} />
              </clipPath>
              <clipPath id="volume-clip">
                <rect x={CHART_LEFT} y={VOLUME_TOP} width={CHART_WIDTH} height={VOLUME_HEIGHT} />
              </clipPath>
            </defs>

            <rect x={0} y={0} width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} fill="#0d1118" />
            <Grid scale={scale} />

            <g clipPath="url(#price-clip)">
              {data.map((point, index) => (
                <CandleShape key={`${point.timestamp}-${index}`} point={point} index={index} scale={scale} candleWidth={candleWidth} />
              ))}
              {maSeries.map((item) => (
                <path key={item.key} d={buildLinePath(data, item.key, scale)} fill="none" stroke={item.color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
              ))}
            </g>

            <g clipPath="url(#volume-clip)">
              {data.map((point, index) => (
                <VolumeBar key={`${point.timestamp}-volume-${index}`} point={point} index={index} scale={scale} />
              ))}
            </g>

            <Axes data={data} scale={scale} currency={currency} />
            {hovered ? <Crosshair point={hovered} index={data.indexOf(hovered)} scale={scale} /> : null}
          </svg>
        </div>
      </div>
    </div>
  );
}

function buildChartData(candles: Candle[], isIntraday: boolean): ChartPoint[] {
  const ordered = [...candles].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const closes = ordered.map((item) => item.close);
  return ordered.map((candle, index) => ({
    ...candle,
    date: isIntraday
      ? new Date(candle.timestamp).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : new Date(candle.timestamp).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }),
    ma5: movingAverage(closes, index, 5),
    ma10: movingAverage(closes, index, 10),
    ma20: movingAverage(closes, index, 20),
    ma60: movingAverage(closes, index, 60)
  }));
}

function movingAverage(values: number[], index: number, period: number) {
  if (index + 1 < period) return null;
  const slice = values.slice(index + 1 - period, index + 1);
  return slice.reduce((sum, value) => sum + value, 0) / period;
}

function buildScale(data: ChartPoint[]) {
  const priceValues = data.flatMap((item) => [item.high, item.low, item.ma5, item.ma10, item.ma20, item.ma60]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const minPrice = Math.min(...priceValues);
  const maxPrice = Math.max(...priceValues);
  const padding = Math.max((maxPrice - minPrice) * 0.08, maxPrice * 0.005, 0.01);
  const priceMin = Math.max(0, minPrice - padding);
  const priceMax = maxPrice + padding;
  const maxVolume = Math.max(...data.map((item) => item.volume), 1);
  const step = CHART_WIDTH / Math.max(data.length, 1);

  return {
    step,
    maxVolume,
    priceMin,
    priceMax,
    x(index: number) {
      return CHART_LEFT + index * step + step / 2;
    },
    y(price: number) {
      const ratio = (priceMax - price) / Math.max(priceMax - priceMin, 0.000001);
      return PRICE_TOP + ratio * PRICE_HEIGHT;
    },
    volumeY(volume: number) {
      return VOLUME_TOP + VOLUME_HEIGHT - (volume / maxVolume) * VOLUME_HEIGHT;
    }
  };
}

function CandleShape({
  point,
  index,
  scale,
  candleWidth
}: {
  point: ChartPoint;
  index: number;
  scale: ReturnType<typeof buildScale>;
  candleWidth: number;
}) {
  const x = scale.x(index);
  const openY = scale.y(point.open);
  const closeY = scale.y(point.close);
  const highY = scale.y(point.high);
  const lowY = scale.y(point.low);
  const up = point.close >= point.open;
  const color = up ? "#ef4444" : "#10b981";
  const bodyTop = Math.min(openY, closeY);
  const bodyHeight = Math.max(1, Math.abs(closeY - openY));

  return (
    <g>
      <line x1={x} x2={x} y1={highY} y2={lowY} stroke={color} strokeWidth={1.1} vectorEffect="non-scaling-stroke" />
      <rect
        x={x - candleWidth / 2}
        y={bodyTop}
        width={candleWidth}
        height={bodyHeight}
        fill={up ? "rgba(239,68,68,0.08)" : "rgba(16,185,129,0.38)"}
        stroke={color}
        strokeWidth={1.1}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}

function VolumeBar({ point, index, scale }: { point: ChartPoint; index: number; scale: ReturnType<typeof buildScale> }) {
  const x = scale.x(index);
  const y = scale.volumeY(point.volume);
  const up = point.close >= point.open;
  const color = up ? "rgba(239,68,68,0.42)" : "rgba(16,185,129,0.42)";
  return <rect x={x - Math.max(1, scale.step * 0.56) / 2} y={y} width={Math.max(1, scale.step * 0.56)} height={VOLUME_TOP + VOLUME_HEIGHT - y} fill={color} />;
}

function Grid({ scale }: { scale: ReturnType<typeof buildScale> }) {
  const priceTicks = getPriceTicks(scale.priceMin, scale.priceMax, 5);
  const xTicks = Array.from({ length: 6 }, (_, index) => CHART_LEFT + (CHART_WIDTH / 5) * index);
  return (
    <g>
      {priceTicks.map((tick) => (
        <line key={tick} x1={CHART_LEFT} x2={CHART_LEFT + CHART_WIDTH} y1={scale.y(tick)} y2={scale.y(tick)} stroke="rgba(148,163,184,0.18)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      ))}
      {xTicks.map((x) => (
        <line key={x} x1={x} x2={x} y1={PRICE_TOP} y2={VOLUME_TOP + VOLUME_HEIGHT} stroke="rgba(148,163,184,0.12)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      ))}
      <line x1={CHART_LEFT} x2={CHART_LEFT + CHART_WIDTH} y1={VOLUME_TOP - 12} y2={VOLUME_TOP - 12} stroke="rgba(148,163,184,0.2)" vectorEffect="non-scaling-stroke" />
    </g>
  );
}

function Axes({ data, scale, currency }: { data: ChartPoint[]; scale: ReturnType<typeof buildScale>; currency?: string }) {
  const priceTicks = getPriceTicks(scale.priceMin, scale.priceMax, 5);
  const xTickIndexes = getIndexTicks(data.length, 6);
  return (
    <g>
      {priceTicks.map((tick) => (
        <text key={tick} x={CHART_LEFT + CHART_WIDTH + 8} y={scale.y(tick) + 4} fill="rgb(148,163,184)" fontSize={12}>
          {formatAxisPrice(tick, currency)}
        </text>
      ))}
      {xTickIndexes.map((index) => (
        <text key={index} x={scale.x(index)} y={VIEWBOX_HEIGHT - CHART_BOTTOM + 20} fill="rgb(148,163,184)" fontSize={12} textAnchor="middle">
          {data[index]?.date}
        </text>
      ))}
      <text x={CHART_LEFT} y={VOLUME_TOP - 18} fill="rgb(148,163,184)" fontSize={12}>
        成交量
      </text>
    </g>
  );
}

function Crosshair({ point, index, scale }: { point: ChartPoint; index: number; scale: ReturnType<typeof buildScale> }) {
  const x = scale.x(index);
  const y = scale.y(point.close);
  return (
    <g pointerEvents="none">
      <line x1={x} x2={x} y1={PRICE_TOP} y2={VOLUME_TOP + VOLUME_HEIGHT} stroke="rgba(226,232,240,0.32)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <line x1={CHART_LEFT} x2={CHART_LEFT + CHART_WIDTH} y1={y} y2={y} stroke="rgba(226,232,240,0.24)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <circle cx={x} cy={y} r={3.5} fill="#e2e8f0" />
    </g>
  );
}

function InfoPanel({ point, currency }: { point: ChartPoint; currency?: string }) {
  const change = point.close - point.open;
  const changePct = point.open ? (change / point.open) * 100 : 0;
  const up = change >= 0;
  return (
    <div className="h-full rounded-md border border-border bg-popover/95 p-3 text-xs shadow-lg backdrop-blur">
      <div className="mb-2 font-medium text-popover-foreground">{point.date}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
        <span>开盘</span>
        <span className="text-right tabular-nums text-foreground">{formatCurrency(point.open, currency)}</span>
        <span>最高</span>
        <span className="text-right tabular-nums text-foreground">{formatCurrency(point.high, currency)}</span>
        <span>最低</span>
        <span className="text-right tabular-nums text-foreground">{formatCurrency(point.low, currency)}</span>
        <span>收盘</span>
        <span className="text-right tabular-nums text-foreground">{formatCurrency(point.close, currency)}</span>
        <span>涨跌</span>
        <span className={`text-right tabular-nums ${up ? "text-red-400" : "text-emerald-400"}`}>
          {change >= 0 ? "+" : ""}
          {formatNumber(change)} / {changePct >= 0 ? "+" : ""}
          {changePct.toFixed(2)}%
        </span>
        <span>成交量</span>
        <span className="text-right tabular-nums text-foreground">{formatNumber(point.volume)}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border pt-2">
        {maSeries.map((item) => (
          <span key={item.key} className="tabular-nums" style={{ color: item.color }}>
            {item.label}: {formatNumber(point[item.key])}
          </span>
        ))}
      </div>
    </div>
  );
}

function buildLinePath(data: ChartPoint[], key: (typeof maSeries)[number]["key"], scale: ReturnType<typeof buildScale>) {
  let path = "";
  data.forEach((point, index) => {
    const value = point[key];
    if (value === null) return;
    const command = path ? "L" : "M";
    path += `${command}${scale.x(index).toFixed(2)},${scale.y(value).toFixed(2)} `;
  });
  return path.trim();
}

function getPriceTicks(min: number, max: number, count: number) {
  if (count <= 1) return [max];
  return Array.from({ length: count }, (_, index) => max - ((max - min) / (count - 1)) * index);
}

function getIndexTicks(length: number, count: number) {
  if (length <= 1) return [0];
  const output = new Set<number>();
  for (let index = 0; index < count; index += 1) {
    output.add(Math.round(((length - 1) / (count - 1)) * index));
  }
  return [...output];
}

function formatAxisPrice(value: number, currency?: string) {
  if (currency === "CNY") return value > 100 ? value.toFixed(2) : value.toFixed(3);
  return value > 100 ? value.toFixed(2) : value.toFixed(4);
}
