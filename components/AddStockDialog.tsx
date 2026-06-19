"use client";

import { FormEvent, useState } from "react";
import { CheckCircle2, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { readJsonResponse } from "@/lib/clientApi";

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
    const note = String(form.get("note") ?? "").trim();
    const payload: { symbol: string; market: string; note?: string } = {
      symbol: String(form.get("symbol") ?? "").toUpperCase(),
      market: String(form.get("market") ?? "CN").toUpperCase()
    };
    if (note) payload.note = note;

    try {
      const response = await fetch("/api/watchlist/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      await readJsonResponse(response);
      setOpen(false);
      onAdded?.();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "保存股票失败。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        添加自选股
      </Button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/48 p-3 backdrop-blur-xl sm:p-4">
          <div className="performance-card w-full max-w-2xl overflow-hidden rounded-xl border border-border">
            <div className="flex items-start justify-between gap-4 border-b border-border/70 bg-muted/10 p-4 sm:p-5">
              <div className="min-w-0">
                <div className="text-base font-semibold">添加自选股</div>
                <div className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
                  先把标的放入观察池，持仓、成本、目标价和交易记录可以在详情页继续补充。
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="关闭">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <form className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_15rem]" onSubmit={onSubmit}>
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
                  <label className="space-y-1.5 text-sm">
                    <span className="font-medium text-foreground">市场</span>
                    <Select name="market" defaultValue="CN">
                      <option value="CN">A 股</option>
                      <option value="HK">港股</option>
                      <option value="US">美股</option>
                    </Select>
                  </label>
                  <label className="space-y-1.5 text-sm">
                    <span className="font-medium text-foreground">股票 / ETF 代码</span>
                    <Input name="symbol" placeholder="例如 561380、600519.SH、0700.HK、NVDA" required autoFocus />
                    <span className="block text-xs leading-5 text-muted-foreground">
                      A 股可直接填 6 位代码；港股、美股建议保留市场后缀。
                    </span>
                  </label>
                </div>
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium text-foreground">观察备注</span>
                  <Textarea name="note" placeholder="例如：电网设备方向观察；等待回调后再看成交量" />
                </label>
              </div>

              <aside className="glow-card rounded-xl border border-border bg-muted/15 p-3 text-xs leading-5 text-muted-foreground">
                <div className="mb-2 text-sm font-medium text-foreground">添加后会同步</div>
                <div className="space-y-2">
                  {["行情与涨跌幅", "AI 分析入口", "提醒与持仓补充"].map((item) => (
                    <div key={item} className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 rounded-lg border border-border/70 bg-background/45 px-3 py-2">
                  输入越规范，后续行情匹配越稳定。
                </div>
              </aside>

              <div className="lg:col-span-2">
                {error ? <div className="mb-3 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-500 dark:text-red-300">{error}</div> : null}
                <div className="flex flex-col-reverse gap-2 rounded-xl border border-border bg-muted/15 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs leading-5 text-muted-foreground">保存后列表会自动刷新，不会改动已有持仓记录。</div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                      取消
                    </Button>
                    <Button type="submit" disabled={submitting}>
                      {submitting ? "保存中..." : "加入自选股"}
                    </Button>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
