"use client";

import { FormEvent, useState } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type AddStockDialogProps = {
  onAdded?: () => void;
};

export function AddStockDialog({ onAdded }: AddStockDialogProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const payload = {
      symbol: String(form.get("symbol") ?? "").toUpperCase(),
      market: "CN",
      note: String(form.get("note") ?? ""),
      timeHorizon: "swing_trade",
      riskLevel: "medium"
    };

    const response = await fetch("/api/watchlist/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setSubmitting(false);

    const json = await response.json();
    if (!response.ok) {
      setError(json.error?.message ?? "保存股票失败。");
      return;
    }

    setOpen(false);
    onAdded?.();
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        添加自选股
      </Button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/45 p-4 backdrop-blur-xl">
          <div className="liquid-glass w-full max-w-lg rounded-2xl">
            <div className="flex items-center justify-between border-b border-white/30 p-4 dark:border-white/10">
              <div>
                <div className="font-semibold">添加自选股</div>
                <div className="mt-1 text-xs text-muted-foreground">只需要输入代码。买入时间、成本、目标价等在股票详情页里再填。</div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="关闭">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <form className="space-y-4 p-4" onSubmit={onSubmit}>
              <label className="space-y-1.5 text-sm">
                <span className="text-muted-foreground">股票 / ETF 代码</span>
                <Input name="symbol" placeholder="例如 561380、600519.SH、000001.SZ" required autoFocus />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="text-muted-foreground">备注，可选</span>
                <Textarea name="note" placeholder="例如：电网设备方向观察" />
              </label>
              {error ? <div className="text-sm text-red-500">{error}</div> : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  取消
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "保存中..." : "加入自选股"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
