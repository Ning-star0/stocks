"use client";

import { MouseEvent, useMemo, useState } from "react";

import type { Candle } from "@/lib/types";
import { formatNumber, formatPriceValue } from "@/lib/utils";

type ChartPoint = Candle & {
  date: string;
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  ma60: number | null;
};

type CursorPoint = {
  x: number;
  y: number;
  price: number;
  volume: number | null;
  timeLabel: string;
  nearestIndex: number;
  yLabel: "价格" | "成交量";
};

const VIEWBOX_WIDTH = 1200;
const VIEWBOX_HEIGHT = 520;
const PRICE_TOP = 42;
const PRICE_HEIGHT = 330;
const VOLUME_TOP = 404;
const VOLUME_HEIGHT = 82;
const CHART_LEFT = 8;
const CHART_RIGHT = 74;
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
  symbol,
  unit,
  interval = "1d"
}: {
  candles: Candle[];
  currency?: string;
  symbol?: string;
  unit?: string;
  interval?: string;
}) {
  const [cursor, setCursor] = useState<CursorPoint | null>(null);
  const isIntraday = ["1m", "5m", "15m", "30m", "60m", "1h"].includes(interval);
  const data = useMemo(() => buildChartData(candles, isIntraday), [candles, isIntraday]);
  const latest = data[data.length - 1];
  const hovered = cursor ? data[cursor.nearestIndex] ?? latest : latest;
  const scale = useMemo(() => buildScale(data), [data]);
  const candleWidth = Math.max(2, Math.min(9, scale.step * 0.58));

  function handleMove(event: MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * VIEWBOX_WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * VIEWBOX_HEIGHT;
    const insideX = x >= CHART_LEFT && x <= CHART_LEFT + CHART_WIDTH;
    const insideY = y >= PRICE_TOP && y <= VOLUME_TOP + VOLUME_HEIGHT;
    if (!insideX || !insideY || data.length === 0) {
      setCursor(null);
      return;
    }

    const nearestIndex = nearestIndexForX(x, scale, data.length);
    const priceY = clamp(y, PRICE_TOP, PRICE_TOP + PRICE_HEIGHT);
    const volumeY = clamp(y, VOLUME_TOP, VOLUME_TOP + VOLUME_HEIGHT);
    const isVolumeArea = y >= VOLUME_TOP;

    setCursor({
      x,
      y,
      price: priceFromY(priceY, scale),
      volume: isVolumeArea ? volumeFromY(volumeY, scale) : null,
      timeLabel: timeLabelForX(data, x, scale, isIntraday),
      nearestIndex,
      yLabel: isVolumeArea ? "成交量" : "价格"
    });
  }

  if (!data.length) {
    return <div className="flex h-[620px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">暂无可展示的 K 线数据。</div>;
  }

  return (
    <div className="w-full">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {maSeries.map((item) => (
            <span key={item.key} className="tabular-nums" style={{ color: item.color }}>
              {item.label}: {formatNumber(latest?.[item.key])}
            </span>
          ))}
        </div>
        <div className="text-xs text-muted-foreground">红涨绿跌，十字线显示鼠标当前位置的时间和数值</div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[220px_minmax(760px,1fr)]">
        {hovered ? <InfoPanel point={hovered} cursor={cursor} currency={currency} symbol={symbol} unit={unit} /> : null}
        <div className="h-[620px] min-w-0 overflow-hidden rounded-md bg-[#0d1118]">
          <svg className="h-full w-full" viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`} preserveAspectRatio="none" onMouseMove={handleMove} onMouseLeave={() => setCursor(null)}>
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

            <Axes data={data} scale={scale} currency={currency} symbol={symbol} unit={unit} />
            {cursor ? <CursorCrosshair cursor={cursor} currency={currency} symbol={symbol} unit={unit} /> : null}
          </svg>
        </div>
      </div>
    </div>
  );
}

function buildChartData(candles: Candle[], isIntraday: boolean): ChartPoint[] {
  const ordered = [...candles].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const closes = ordered.map((item) => item.close);
  const ma5 = buildMovingAverageSeries(closes, 5);
  const ma10 = buildMovingAverageSeries(closes, 10);
  const ma20 = buildMovingAverageSeries(closes, 20);
  const ma60 = buildMovingAverageSeries(closes, 60);
  return ordered.map((candle, index) => ({
    ...candle,
    date: isIntraday
      ? new Date(candle.timestamp).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : new Date(candle.timestamp).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }),
    ma5: ma5[index],
    ma10: ma10[index],
    ma20: ma20[index],
    ma60: ma60[index]
  }));
}

function buildMovingAverageSeries(values: number[], period: number) {
  const output: Array<number | null> = Array(values.length).fill(null);
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index];
    if (index >= period) sum -= values[index - period];
    if (index + 1 >= period) output[index] = sum / period;
  }
  return output;
}

function buildScale(data: ChartPoint[]) {
  const priceValues = data.flatMap((item) => [item.high, item.low, item.ma5, item.ma10, item.ma20, item.ma60]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const minPrice = priceValues.length ? Math.min(...priceValues) : 0;
  const maxPrice = priceValues.length ? Math.max(...priceValues) : 1;
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
  const width = Math.max(1, scale.step * 0.56);
  return <rect x={x - width / 2} y={y} width={width} height={VOLUME_TOP + VOLUME_HEIGHT - y} fill={color} />;
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

function Axes({ data, scale, currency, symbol, unit }: { data: ChartPoint[]; scale: ReturnType<typeof buildScale>; currency?: string; symbol?: string; unit?: string }) {
  const priceTicks = getPriceTicks(scale.priceMin, scale.priceMax, 5);
  const xTickIndexes = getIndexTicks(data.length, 6);
  return (
    <g>
      {priceTicks.map((tick) => (
        <text key={tick} x={CHART_LEFT + CHART_WIDTH + 8} y={scale.y(tick) + 4} fill="rgb(148,163,184)" fontSize={12}>
          {formatAxisPrice(tick, currency, symbol, unit)}
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

function CursorCrosshair({ cursor, currency, symbol, unit }: { cursor: CursorPoint; currency?: string; symbol?: string; unit?: string }) {
  const tooltipWidth = 210;
  const tooltipHeight = cursor.volume === null ? 54 : 72;
  const tooltipX = cursor.x + tooltipWidth + 18 > CHART_LEFT + CHART_WIDTH ? cursor.x - tooltipWidth - 14 : cursor.x + 14;
  const tooltipY = cursor.y + tooltipHeight + 14 > VOLUME_TOP + VOLUME_HEIGHT ? cursor.y - tooltipHeight - 14 : cursor.y + 14;
  const priceLabelY = clamp(cursor.y, PRICE_TOP + 10, PRICE_TOP + PRICE_HEIGHT - 6);

  return (
    <g pointerEvents="none">
      <line x1={cursor.x} x2={cursor.x} y1={PRICE_TOP} y2={VOLUME_TOP + VOLUME_HEIGHT} stroke="rgba(226,232,240,0.38)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <line x1={CHART_LEFT} x2={CHART_LEFT + CHART_WIDTH} y1={cursor.y} y2={cursor.y} stroke="rgba(226,232,240,0.3)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <circle cx={cursor.x} cy={cursor.y} r={3.5} fill="#e2e8f0" />

      <rect x={CHART_LEFT + CHART_WIDTH + 5} y={priceLabelY - 12} width={64} height={20} rx={4} fill="#111827" stroke="rgba(148,163,184,0.35)" />
      <text x={CHART_LEFT + CHART_WIDTH + 37} y={priceLabelY + 3} fill="#e2e8f0" fontSize={11} textAnchor="middle">
        {formatAxisPrice(cursor.price, currency, symbol, unit)}
      </text>

      <rect x={tooltipX} y={tooltipY} width={tooltipWidth} height={tooltipHeight} rx={6} fill="rgba(15,23,42,0.96)" stroke="rgba(148,163,184,0.35)" />
      <text x={tooltipX + 10} y={tooltipY + 18} fill="#e2e8f0" fontSize={12}>
        X: {cursor.timeLabel}
      </text>
      <text x={tooltipX + 10} y={tooltipY + 38} fill="#e2e8f0" fontSize={12}>
        Y({cursor.yLabel}): {cursor.volume === null ? formatPriceValue(cursor.price, { currency, symbol, unit }) : formatNumber(cursor.volume)}
      </text>
      {cursor.volume !== null ? (
        <text x={tooltipX + 10} y={tooltipY + 58} fill="#94a3b8" fontSize={11}>
          对应价格: {formatPriceValue(cursor.price, { currency, symbol, unit })}
        </text>
      ) : null}
    </g>
  );
}

function InfoPanel({ point, cursor, currency, symbol, unit }: { point: ChartPoint; cursor: CursorPoint | null; currency?: string; symbol?: string; unit?: string }) {
  const change = point.close - point.open;
  const changePct = point.open ? (change / point.open) * 100 : 0;
  const up = change >= 0;
  return (
    <div className="h-full rounded-md border border-border bg-popover/95 p-3 text-xs shadow-lg backdrop-blur">
      {cursor ? (
        <div className="mb-3 rounded-md border border-primary/25 bg-primary/10 p-2">
          <div className="font-medium text-popover-foreground">鼠标位置</div>
          <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
            <span>X 时间</span>
            <span className="text-right text-foreground">{cursor.timeLabel}</span>
            <span>Y 价格</span>
            <span className="text-right tabular-nums text-foreground">{formatPriceValue(cursor.price, { currency, symbol, unit })}</span>
            {cursor.volume !== null ? (
              <>
                <span>Y 成交量</span>
                <span className="text-right tabular-nums text-foreground">{formatNumber(cursor.volume)}</span>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mb-2 font-medium text-popover-foreground">最近 K 线：{point.date}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
        <span>开盘</span>
        <span className="text-right tabular-nums text-foreground">{formatPriceValue(point.open, { currency, symbol, unit })}</span>
        <span>最高</span>
        <span className="text-right tabular-nums text-foreground">{formatPriceValue(point.high, { currency, symbol, unit })}</span>
        <span>最低</span>
        <span className="text-right tabular-nums text-foreground">{formatPriceValue(point.low, { currency, symbol, unit })}</span>
        <span>收盘</span>
        <span className="text-right tabular-nums text-foreground">{formatPriceValue(point.close, { currency, symbol, unit })}</span>
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

function nearestIndexForX(x: number, scale: ReturnType<typeof buildScale>, length: number) {
  return clamp(Math.round(fractionalIndexForX(x, scale)), 0, Math.max(0, length - 1));
}

function fractionalIndexForX(x: number, scale: ReturnType<typeof buildScale>) {
  return (x - CHART_LEFT - scale.step / 2) / scale.step;
}

function priceFromY(y: number, scale: ReturnType<typeof buildScale>) {
  const ratio = (y - PRICE_TOP) / PRICE_HEIGHT;
  return scale.priceMax - ratio * (scale.priceMax - scale.priceMin);
}

function volumeFromY(y: number, scale: ReturnType<typeof buildScale>) {
  const ratio = (VOLUME_TOP + VOLUME_HEIGHT - y) / VOLUME_HEIGHT;
  return Math.max(0, ratio * scale.maxVolume);
}

function timeLabelForX(data: ChartPoint[], x: number, scale: ReturnType<typeof buildScale>, isIntraday: boolean) {
  if (!data.length) return "--";
  const fractional = clamp(fractionalIndexForX(x, scale), 0, data.length - 1);
  const leftIndex = Math.floor(fractional);
  const rightIndex = Math.min(data.length - 1, Math.ceil(fractional));
  const leftTime = new Date(data[leftIndex]?.timestamp ?? data[0].timestamp).getTime();
  const rightTime = new Date(data[rightIndex]?.timestamp ?? data[data.length - 1].timestamp).getTime();
  const ratio = rightIndex === leftIndex ? 0 : fractional - leftIndex;
  const time = leftTime + (rightTime - leftTime) * ratio;
  const date = new Date(time);
  return isIntraday
    ? date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("zh-CN", { year: "numeric", month: "numeric", day: "numeric" });
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

function formatAxisPrice(value: number, currency?: string, symbol?: string, unit?: string) {
  if (unit === "point") return value > 100 ? value.toFixed(2) : value.toFixed(3);
  if (currency === "CNY") return value > 100 ? value.toFixed(2) : value.toFixed(3);
  if (symbol) return formatPriceValue(value, { currency, symbol, unit });
  return value > 100 ? value.toFixed(2) : value.toFixed(4);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
