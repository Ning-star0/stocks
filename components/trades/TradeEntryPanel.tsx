"use client";

import { useMemo, useState } from "react";
import { CircleDollarSign, Save, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { TradeInstrument } from "@/components/trades/types";
import { readJsonResponse } from "@/lib/clientApi";
import { formatPrice, formatShares, resolveStockDisplayName } from "@/lib/trading/display";
import { cn } from "@/lib/utils";

export function TradeEntryPanel({ instruments, onClose, onSaved }: {
  instruments: TradeInstrument[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [symbol, setSymbol] = useState(instruments[0]?.symbol ?? "");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const selected = useMemo(() => instruments.find((item) => item.symbol === symbol) ?? null, [instruments, symbol]);
  const [price, setPrice] = useState(selected?.price ? String(selected.price) : "");
  const [shares, setShares] = useState("100");
  const [executedAt, setExecutedAt] = useState(toLocalDateTime(new Date()));
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/trades", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol, side, price, shares, executedAt, note })
      });
      const result = await readJsonResponse<{ execution: { symbol: string; side: string; shares: number } }>(response);
      await onSaved(`${result.execution.symbol} ${result.execution.side === "buy" ? "买入" : "卖出"} ${formatShares(result.execution.shares)} 股/份已计入账本。`);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "成交记录保存失败。");
    } finally {
      setSubmitting(false);
    }
  }

  function changeSymbol(nextSymbol: string) {
    setSymbol(nextSymbol);
    const instrument = instruments.find((item) => item.symbol === nextSymbol);
    if (instrument?.price) setPrice(String(instrument.price));
  }

  return (
    <Card className="performance-card overflow-hidden">
      <CardHeader className="flex-row items-center justify-between border-b border-border/70 bg-background/25 p-4">
        <CardTitle className="flex items-center gap-2">
          <CircleDollarSign className="h-4 w-4 text-primary" />
          录入实际成交
        </CardTitle>
        <Button type="button" size="icon" variant="ghost" onClick={onClose} title="关闭成交录入">
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="p-4">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.5fr)_180px_160px_160px_minmax(210px,1fr)]">
            <Field label="标的">
              <Select aria-label="标的" value={symbol} onChange={(event) => changeSymbol(event.target.value)} required>
                {instruments.map((instrument) => (
                  <option key={instrument.symbol} value={instrument.symbol}>
                    {resolveStockDisplayName({ symbol: instrument.symbol, name: instrument.name })} · {instrument.symbol}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="方向">
              <div className="grid h-10 grid-cols-2 rounded-xl border border-border bg-muted/25 p-1">
                {(["buy", "sell"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-label={`${value === "buy" ? "买入" : "卖出"}方向`}
                    aria-pressed={side === value}
                    onClick={() => setSide(value)}
                    className={cn(
                      "rounded-lg text-sm font-medium transition-colors",
                      side === value
                        ? value === "buy" ? "bg-red-500/12 text-red-600 dark:text-red-300" : "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {value === "buy" ? "买入" : "卖出"}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="成交价">
              <Input aria-label="成交价" type="number" min="0" step="0.0001" value={price} onChange={(event) => setPrice(event.target.value)} required />
            </Field>
            <Field label="数量">
              <Input aria-label="数量" type="number" min="100" step="100" value={shares} onChange={(event) => setShares(event.target.value)} required />
            </Field>
            <Field label="成交时间">
              <Input aria-label="成交时间" type="datetime-local" value={executedAt} onChange={(event) => setExecutedAt(event.target.value)} required />
            </Field>
          </div>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <Field label="交易备注">
              <Textarea aria-label="交易备注" value={note} onChange={(event) => setNote(event.target.value)} placeholder="触发条件、执行偏差或复盘结论" className="min-h-20" />
            </Field>
            <Button type="submit" disabled={submitting || !symbol || !instruments.length} className="min-w-36">
              <Save className="h-4 w-4" />
              {submitting ? "保存中" : "计入账本"}
            </Button>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>参考价 {formatPrice(selected?.price)}</span>
            <span>当前持仓 {formatShares(selected?.holdingShares)} 股/份</span>
            <span>成交数量按 100 股/份整数手校验</span>
          </div>
          {error ? <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div> : null}
        </form>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function toLocalDateTime(date: Date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
