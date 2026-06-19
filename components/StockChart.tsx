"use client";

import type { CSSProperties, MouseEvent } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { motionClassNames } from "@/lib/motion";
import type { Candle } from "@/lib/types";
import { cn, formatNumber, formatPriceValue } from "@/lib/utils";

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
  area: "price" | "volume";
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
const SVG_FONT_FAMILY = "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

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
  interval = "1m"
}: {
  candles: Candle[];
  currency?: string;
  symbol?: string;
  unit?: string;
  interval?: string;
}) {
  const clipPathBaseId = useId().replace(/:/g, "");
  const [cursor, setCursor] = useState<CursorPoint | null>(null);
  const pendingCursorRef = useRef<CursorPoint | null>(null);
  const frameRef = useRef<number | null>(null);
  const isIntraday = ["1m", "5m", "15m", "30m", "60m", "1h"].includes(interval);
  const isTimeSharing = interval === "1m";
  const showMovingAverages = !isTimeSharing;
  const data = useMemo(() => buildChartData(candles, isIntraday), [candles, isIntraday]);
  const dataDateLabel = useMemo(() => formatDataDateRange(data, isIntraday), [data, isIntraday]);
  const latest = data[data.length - 1];
  const hovered = cursor ? data[cursor.nearestIndex] ?? latest : latest;
  const scale = useMemo(() => buildScale(data, showMovingAverages), [data, showMovingAverages]);
  const candleWidth = Math.max(2, Math.min(9, scale.step * 0.58));
  const latestPriceLabel = isTimeSharing ? intradayLatestPriceLabel(latest) : "收盘价";
  const priceClipId = `${clipPathBaseId}-price`;
  const volumeClipId = `${clipPathBaseId}-volume`;

  useEffect(() => () => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  function handleMove(event: MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * VIEWBOX_WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * VIEWBOX_HEIGHT;
    const insideX = x >= CHART_LEFT && x <= CHART_LEFT + CHART_WIDTH;
    const insideY = y >= PRICE_TOP && y <= VOLUME_TOP + VOLUME_HEIGHT;
    if (!insideX || !insideY || data.length === 0) {
      clearCursor();
      return;
    }

    const nearestIndex = nearestIndexForX(x, scale, data.length);
    const isVolumeArea = y >= VOLUME_TOP;
    const nearestPoint = data[nearestIndex];
    const snappedX = scale.x(nearestIndex);
    const snappedY = nearestPoint ? scale.y(nearestPoint.close) : clamp(y, PRICE_TOP, PRICE_TOP + PRICE_HEIGHT);

    queueCursor({
      x: snappedX,
      y: snappedY,
      price: nearestPoint?.close ?? 0,
      volume: nearestPoint?.volume ?? null,
      timeLabel: nearestPoint?.date ?? "--",
      nearestIndex,
      area: isVolumeArea ? "volume" : "price"
    });
  }

  function queueCursor(next: CursorPoint) {
    pendingCursorRef.current = next;
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      setCursor(pendingCursorRef.current);
    });
  }

  function clearCursor() {
    pendingCursorRef.current = null;
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    setCursor((current) => (current === null ? current : null));
  }

  if (!data.length) {
    return (
      <div className={cn(motionClassNames.shimmer, "glow-card flex h-[360px] items-center justify-center rounded-xl border border-dashed border-border bg-muted/10 text-sm text-muted-foreground md:h-[430px]")}>
        暂无可展示的 K 线数据。
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="mb-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0 space-y-1.5">
          <div className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <InfoItem label={latestPriceLabel} value={formatPriceValue(latest?.close, { currency, symbol, unit })} strong className="text-primary" />
            <InfoItem label="成交量" value={formatNumber(latest?.volume)} />
            <InfoItem label="截至" value={latest?.date ?? "--"} />
          </div>
          <div className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
            {maSeries.map((item) => (
              <InfoItem
                key={item.key}
                label={item.label}
                value={showMovingAverages ? formatNumber(latest?.[item.key]) : "--"}
                title={showMovingAverages ? formatNumber(latest?.[item.key]) : "分时图不计算均线"}
                className="font-normal"
                style={{ color: item.color }}
              />
            ))}
          </div>
          <div className="text-xs text-muted-foreground">
            {dataDateLabel}
            {isIntraday ? "，非交易日会显示最近一个交易日的数据" : ""}
          </div>
        </div>
        <div className="text-xs text-muted-foreground xl:pt-1">{isTimeSharing ? "1 分钟分时线，柱状图为成交量" : "红涨绿跌，均线按当前周期 K 线计算"}</div>
      </div>

      <div className="space-y-3">
        {hovered ? <InfoPanel point={hovered} cursor={cursor} currency={currency} symbol={symbol} unit={unit} showMovingAverages={showMovingAverages} isTimeSharing={isTimeSharing} /> : null}
        <div className={cn(motionClassNames.chartEnter, "glow-card h-[360px] min-w-0 overflow-hidden rounded-xl border border-border bg-white md:h-[430px] dark:bg-[#0d1118]")}>
          <svg
            className="h-full w-full"
            viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
            preserveAspectRatio="none"
            onMouseMove={handleMove}
            onMouseLeave={clearCursor}
            style={{ fontFamily: SVG_FONT_FAMILY }}
          >
            <defs>
              <clipPath id={priceClipId}>
                <rect x={CHART_LEFT} y={PRICE_TOP} width={CHART_WIDTH} height={PRICE_HEIGHT} />
              </clipPath>
              <clipPath id={volumeClipId}>
                <rect x={CHART_LEFT} y={VOLUME_TOP} width={CHART_WIDTH} height={VOLUME_HEIGHT} />
              </clipPath>
            </defs>

            <rect x={0} y={0} width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} className="fill-white dark:fill-[#0d1118]" />
            <Grid scale={scale} />

            <g clipPath={`url(#${priceClipId})`}>
              {isTimeSharing ? (
                <>
                  <path d={buildAreaPath(data, scale)} fill="rgba(20,184,166,0.12)" />
                  <path d={buildCloseLinePath(data, scale)} fill="none" stroke="#14b8a6" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                </>
              ) : (
                <>
                  {data.map((point, index) => (
                    <CandleShape key={`${point.timestamp}-${index}`} point={point} index={index} scale={scale} candleWidth={candleWidth} />
                  ))}
                  {maSeries.map((item) => (
                    <path key={item.key} d={buildLinePath(data, item.key, scale)} fill="none" stroke={item.color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
                  ))}
                </>
              )}
            </g>

            <g clipPath={`url(#${volumeClipId})`}>
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
  const ordered = candles
    .map(normalizeCandle)
    .filter((item): item is Candle => item !== null)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
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

function normalizeCandle(candle: Candle): Candle | null {
  const timestampMs = new Date(candle.timestamp).getTime();
  const open = finiteNumber(candle.open);
  const high = finiteNumber(candle.high);
  const low = finiteNumber(candle.low);
  const close = finiteNumber(candle.close);
  if (!Number.isFinite(timestampMs) || open === null || high === null || low === null || close === null) return null;
  return {
    ...candle,
    open,
    high,
    low,
    close,
    volume: Math.max(0, finiteNumber(candle.volume) ?? 0)
  };
}

function finiteNumber(value: number) {
  return Number.isFinite(value) ? value : null;
}

function formatDataDateRange(data: ChartPoint[], isIntraday: boolean) {
  if (!data.length) return "暂无数据";
  const first = new Date(data[0].timestamp);
  const last = new Date(data[data.length - 1].timestamp);
  if (isIntraday) {
    const date = last.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
    const start = first.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    const end = last.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    return `数据日期 ${date} ${start}-${end}`;
  }
  return `数据范围 ${first.toLocaleDateString("zh-CN")} 至 ${last.toLocaleDateString("zh-CN")}`;
}

function intradayLatestPriceLabel(point?: ChartPoint) {
  if (!point) return "最新价";
  const date = new Date(point.timestamp);
  if (Number.isNaN(date.getTime())) return "最新价";
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes >= 15 * 60 ? "收盘价" : "最新价";
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

function buildScale(data: ChartPoint[], includeMovingAverages = true) {
  const priceValues = data
    .flatMap((item) => (includeMovingAverages ? [item.high, item.low, item.ma5, item.ma10, item.ma20, item.ma60] : [item.high, item.low, item.close]))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
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
        <line key={tick} x1={CHART_LEFT} x2={CHART_LEFT + CHART_WIDTH} y1={scale.y(tick)} y2={scale.y(tick)} className="stroke-slate-300/80 dark:stroke-slate-400/20" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      ))}
      {xTicks.map((x) => (
        <line key={x} x1={x} x2={x} y1={PRICE_TOP} y2={VOLUME_TOP + VOLUME_HEIGHT} className="stroke-slate-300/70 dark:stroke-slate-400/15" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      ))}
      <line x1={CHART_LEFT} x2={CHART_LEFT + CHART_WIDTH} y1={VOLUME_TOP - 12} y2={VOLUME_TOP - 12} className="stroke-slate-300 dark:stroke-slate-400/25" vectorEffect="non-scaling-stroke" />
    </g>
  );
}

function Axes({ data, scale, currency, symbol, unit }: { data: ChartPoint[]; scale: ReturnType<typeof buildScale>; currency?: string; symbol?: string; unit?: string }) {
  const priceTicks = getPriceTicks(scale.priceMin, scale.priceMax, 5);
  const xTickIndexes = getIndexTicks(data.length, 6);
  return (
    <g>
      {priceTicks.map((tick) => (
        <text key={tick} x={CHART_LEFT + CHART_WIDTH + 8} y={scale.y(tick) + 4} className="fill-slate-500 dark:fill-slate-400" fontSize={12}>
          {formatAxisPrice(tick, currency, symbol, unit)}
        </text>
      ))}
      {xTickIndexes.map((index) => (
        <text key={index} x={scale.x(index)} y={VIEWBOX_HEIGHT - CHART_BOTTOM + 20} className="fill-slate-500 dark:fill-slate-400" fontSize={12} textAnchor="middle">
          {data[index]?.date}
        </text>
      ))}
      <text x={CHART_LEFT} y={VOLUME_TOP - 18} className="fill-slate-500 dark:fill-slate-400" fontSize={12}>
        成交量
      </text>
    </g>
  );
}

function CursorCrosshair({ cursor, currency, symbol, unit }: { cursor: CursorPoint; currency?: string; symbol?: string; unit?: string }) {
  const tooltipWidth = 196;
  const tooltipHeight = 72;
  const tooltipX = cursor.x + tooltipWidth + 18 > CHART_LEFT + CHART_WIDTH ? cursor.x - tooltipWidth - 14 : cursor.x + 14;
  const tooltipY = cursor.y + tooltipHeight + 14 > VOLUME_TOP + VOLUME_HEIGHT ? cursor.y - tooltipHeight - 14 : cursor.y + 14;
  const priceLabelY = clamp(cursor.y, PRICE_TOP + 10, PRICE_TOP + PRICE_HEIGHT - 6);

  return (
    <g pointerEvents="none">
      <line x1={cursor.x} x2={cursor.x} y1={PRICE_TOP} y2={VOLUME_TOP + VOLUME_HEIGHT} className="stroke-slate-500/55 dark:stroke-slate-200/40" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <line x1={CHART_LEFT} x2={CHART_LEFT + CHART_WIDTH} y1={cursor.y} y2={cursor.y} className="stroke-slate-500/45 dark:stroke-slate-200/30" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <circle cx={cursor.x} cy={cursor.y} r={3.5} className="fill-slate-700 dark:fill-slate-200" />

      <rect x={CHART_LEFT + CHART_WIDTH + 5} y={priceLabelY - 12} width={64} height={20} rx={4} className="fill-white stroke-slate-300 dark:fill-slate-900 dark:stroke-slate-400/40" />
      <text x={CHART_LEFT + CHART_WIDTH + 37} y={priceLabelY + 3} className="fill-slate-700 dark:fill-slate-100" fontSize={11} textAnchor="middle">
        {formatAxisPrice(cursor.price, currency, symbol, unit)}
      </text>

      <rect x={tooltipX} y={tooltipY} width={tooltipWidth} height={tooltipHeight} rx={6} className="fill-white stroke-slate-300 dark:fill-slate-900 dark:stroke-slate-400/40" />
      <text x={tooltipX + 10} y={tooltipY + 18} className="fill-slate-800 dark:fill-slate-100" fontSize={12}>
        {cursor.timeLabel}
      </text>
      <text x={tooltipX + 10} y={tooltipY + 38} className="fill-slate-800 dark:fill-slate-100" fontSize={12}>
        价格 {formatPriceValue(cursor.price, { currency, symbol, unit })}
      </text>
      <text x={tooltipX + 10} y={tooltipY + 58} className="fill-slate-500 dark:fill-slate-400" fontSize={11}>
        成交量 {formatNumber(cursor.volume)}
      </text>
    </g>
  );
}

function InfoPanel({
  point,
  cursor,
  currency,
  symbol,
  unit,
  showMovingAverages,
  isTimeSharing
}: {
  point: ChartPoint;
  cursor: CursorPoint | null;
  currency?: string;
  symbol?: string;
  unit?: string;
  showMovingAverages: boolean;
  isTimeSharing: boolean;
}) {
  const change = point.close - point.open;
  const changePct = point.open ? (change / point.open) * 100 : 0;
  const up = change >= 0;
  const cursorTime = cursor?.timeLabel ?? point.date;
  const cursorPrice = point.close;
  return (
    <div className="glow-card rounded-xl border border-border bg-popover/80 px-3 py-2 text-xs shadow-sm backdrop-blur">
      <div className="grid gap-x-6 gap-y-1.5 md:grid-cols-4">
        <InfoItem label="时间" value={cursorTime} />
        <InfoItem label="价格" value={formatPriceValue(cursorPrice, { currency, symbol, unit })} strong />
        <InfoItem label="成交量" value={formatNumber(cursor?.volume ?? point.volume)} />
        <InfoItem
          label="涨跌"
          value={`${change >= 0 ? "+" : ""}${formatNumber(change)}/${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`}
          className={up ? "text-red-500" : "text-emerald-500"}
          title={`${change >= 0 ? "+" : ""}${formatNumber(change)}/${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`}
        />
      </div>
      <div className="mt-1.5 border-t border-border/70 pt-1.5">
        <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-4">
          <InfoItem label="开盘" value={formatPriceValue(point.open, { currency, symbol, unit })} />
          <InfoItem label="最高" value={formatPriceValue(point.high, { currency, symbol, unit })} />
          <InfoItem label="最低" value={formatPriceValue(point.low, { currency, symbol, unit })} />
          <InfoItem label={isTimeSharing ? intradayLatestPriceLabel(point) : "收盘"} value={formatPriceValue(point.close, { currency, symbol, unit })} />
        </div>
        <div className="mt-1.5 grid gap-x-6 gap-y-1.5 border-t border-border/50 pt-1.5 sm:grid-cols-2 lg:grid-cols-4">
          {maSeries.map((item) => (
            <InfoItem
              key={item.key}
              label={item.label}
              value={showMovingAverages ? formatNumber(point[item.key]) : "--"}
              title={showMovingAverages ? formatNumber(point[item.key]) : "分时图不计算均线"}
              className="font-normal"
              style={{ color: item.color }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function InfoItem({
  label,
  value,
  strong = false,
  title,
  className,
  style
}: {
  label: string;
  value: string;
  strong?: boolean;
  title?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const hasCustomColor = Boolean(style?.color);
  return (
    <span className="grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2 whitespace-nowrap" style={style}>
      <span className={hasCustomColor ? "" : "text-muted-foreground"}>{label}</span>
      <span key={value} className={cn(motionClassNames.numberChange, "min-w-0 truncate tabular-nums leading-5", hasCustomColor ? "" : "text-foreground", strong ? "font-semibold" : "", className)} title={title ?? value}>
        {value}
      </span>
    </span>
  );
}

function nearestIndexForX(x: number, scale: ReturnType<typeof buildScale>, length: number) {
  return clamp(Math.round(fractionalIndexForX(x, scale)), 0, Math.max(0, length - 1));
}

function fractionalIndexForX(x: number, scale: ReturnType<typeof buildScale>) {
  return (x - CHART_LEFT - scale.step / 2) / scale.step;
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

function buildCloseLinePath(data: ChartPoint[], scale: ReturnType<typeof buildScale>) {
  let path = "";
  data.forEach((point, index) => {
    const command = path ? "L" : "M";
    path += `${command}${scale.x(index).toFixed(2)},${scale.y(point.close).toFixed(2)} `;
  });
  return path.trim();
}

function buildAreaPath(data: ChartPoint[], scale: ReturnType<typeof buildScale>) {
  const line = buildCloseLinePath(data, scale);
  if (!line || data.length === 0) return "";
  const firstX = scale.x(0).toFixed(2);
  const lastX = scale.x(data.length - 1).toFixed(2);
  const baseline = (PRICE_TOP + PRICE_HEIGHT).toFixed(2);
  return `${line} L${lastX},${baseline} L${firstX},${baseline} Z`;
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
