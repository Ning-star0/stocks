"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { StockChart } from "@/components/StockChart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Candle } from "@/lib/types";
import { cn } from "@/lib/utils";

const rangeOptions = [
  { value: "1mo", label: "1月" },
  { value: "3mo", label: "3月" },
  { value: "6mo", label: "6月" },
  { value: "1y", label: "1年" },
  { value: "2y", label: "2年" },
  { value: "5y", label: "5年" },
  { value: "all", label: "全部" }
];

const intradayRangeOptions = [
  { value: "1d", label: "最近交易日" },
  { value: "5d", label: "5日" },
  { value: "1mo", label: "1月" },
  { value: "3mo", label: "3月" }
];

const intervalOptions = [
  { value: "1m", label: "分时" },
  { value: "5m", label: "5分" },
  { value: "15m", label: "15分" },
  { value: "30m", label: "30分" },
  { value: "60m", label: "60分" },
  { value: "1d", label: "日K" },
  { value: "1wk", label: "周K" },
  { value: "1mo", label: "月K" }
];

type StockChartPanelProps = {
  symbol: string;
  initialCandles: Candle[];
  initialRange: string;
  initialInterval: string;
  currency?: string;
  unit?: string;
};

export function StockChartPanel({
  symbol,
  initialCandles,
  initialRange,
  initialInterval,
  currency,
  unit
}: StockChartPanelProps) {
  const [candles, setCandles] = useState(initialCandles);
  const [range, setRange] = useState(initialRange);
  const [interval, setInterval] = useState(initialInterval);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef(0);
  const foregroundRequestIdRef = useRef<number | null>(null);
  const ranges = useMemo(() => (isIntraday(interval) ? intradayRangeOptions : rangeOptions), [interval]);

  const updateChart = useCallback(async (nextInterval: string, nextRange: string, options: { force?: boolean; background?: boolean } = {}) => {
    const normalizedRange = normalizeRange(nextRange, nextInterval);
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const isBackground = Boolean(options.background);
    setError(null);
    if (!isBackground) {
      foregroundRequestIdRef.current = requestId;
      setInterval(nextInterval);
      setRange(normalizedRange);
      setIsLoading(true);
    }
    try {
      const params = new URLSearchParams({
        interval: nextInterval,
        range: normalizedRange
      });
      if (options.force) params.set("refresh", "1");
      const response = await fetch(`/api/stocks/${encodeURIComponent(symbol)}/history?${params.toString()}`, {
        cache: "no-store"
      });
      const json = await readJsonResponse(response);
      if (!response.ok) throw new Error(json?.error?.message ?? "行情数据加载失败。");
      if (requestId === requestIdRef.current) {
        const nextCandles = Array.isArray(json.candles) ? json.candles : [];
        if (nextCandles.length) {
          setCandles(nextCandles);
        } else if (!isBackground) {
          setError("本次没有返回可展示的 K 线数据，已保留上一组图表数据。");
        }
      }
    } catch (err) {
      if (requestId === requestIdRef.current) setError(err instanceof Error ? err.message : "行情数据加载失败。");
    } finally {
      if (!isBackground && foregroundRequestIdRef.current === requestId) {
        foregroundRequestIdRef.current = null;
        setIsLoading(false);
      }
    }
  }, [symbol]);

  useEffect(() => {
    setCandles(initialCandles);
    setRange(initialRange);
    setInterval(initialInterval);
  }, [initialCandles, initialInterval, initialRange, symbol]);

  useEffect(() => {
    if (isLoading) return;
    if (!isIntraday(interval)) return;
    void updateChart(interval, range, { force: true, background: true });
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && shouldRefreshIntradayChart()) {
        void updateChart(interval, range, { force: true, background: true });
      }
    }, 45_000);
    return () => window.clearInterval(timer);
  }, [interval, isLoading, range, updateChart]);

  return (
    <Card className="soft-card">
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <CardTitle>价格走势</CardTitle>
          <div className="rounded-lg border border-border bg-muted/10 p-2">
            <div className="grid gap-2 lg:grid-cols-[auto_auto] lg:items-center">
              <div className="text-[11px] font-medium text-muted-foreground">周期</div>
              <div className="flex flex-wrap gap-1">
                {intervalOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => updateChart(option.value, normalizeRange(range, option.value), { force: true })}
                    disabled={isLoading}
                    className={cn(
                      "min-w-11 rounded-md border px-2.5 py-1 text-center text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                      interval === option.value
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background/40 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="text-[11px] font-medium text-muted-foreground">范围</div>
              <div className="flex flex-wrap gap-1">
                {ranges.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => updateChart(interval, option.value, { force: true })}
                    disabled={isLoading}
                    className={cn(
                      "min-w-11 rounded-md border px-2.5 py-1 text-center text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                      range === option.value
                        ? "border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-200"
                        : "border-border bg-background/40 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative min-h-[460px] md:min-h-[520px]">
          {candles.length ? (
            <StockChart candles={candles} currency={currency} symbol={symbol} unit={unit} interval={interval} />
          ) : (
            <div className="flex min-h-[460px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground md:min-h-[520px]">
              暂无可展示的 K 线数据。
            </div>
          )}
          {isLoading ? (
            <div className="pointer-events-none absolute inset-0 rounded-md bg-background/35 backdrop-blur-[1px]">
              <div className="absolute right-3 top-3 rounded-full border border-border bg-background/80 px-3 py-1 text-xs text-muted-foreground shadow-sm">
                正在更新图表...
              </div>
            </div>
          ) : null}
        </div>
        {error ? <div className="mt-3 rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">{error}</div> : null}
      </CardContent>
    </Card>
  );
}

function normalizeRange(value: string | undefined, interval: string) {
  const allowed = isIntraday(interval) ? intradayRangeOptions.map((option) => option.value) : rangeOptions.map((option) => option.value);
  if (value && allowed.includes(value)) return value;
  if (interval === "1m") return "1d";
  return isIntraday(interval) ? "1mo" : "6mo";
}

function isIntraday(interval: string) {
  return ["1m", "5m", "15m", "30m", "60m", "1h"].includes(interval);
}

function shouldRefreshIntradayChart() {
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  return (minutes >= 9 * 60 + 25 && minutes <= 11 * 60 + 35) || (minutes >= 12 * 60 + 55 && minutes <= 15 * 60 + 5);
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: { message: response.ok ? "行情数据格式异常。" : `行情接口返回异常（HTTP ${response.status}）。` } };
  }
}
