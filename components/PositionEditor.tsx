"use client";

import { FormEvent, useState } from "react";
import { Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type PositionEditorProps = {
  itemId: string;
  holdingPrice?: number | null;
  targetPrice?: number | null;
  stopLoss?: number | null;
  positionOpenedAt?: string | Date | null;
  timeHorizon?: string | null;
  riskLevel?: string | null;
  note?: string | null;
};

export function PositionEditor({
  itemId,
  holdingPrice,
  targetPrice,
  stopLoss,
  positionOpenedAt,
  timeHorizon,
  riskLevel,
  note
}: PositionEditorProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const openedDate = toDateInputValue(positionOpenedAt);
  const holdingDays = openedDate ? daysSince(openedDate) : null;
  const targetReturn = calcPercent(targetPrice, holdingPrice);
  const stopLossReturn = calcPercent(stopLoss, holdingPrice);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const form = new FormData(event.currentTarget);

      const response = await fetch(`/api/watchlist/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          holdingPrice: optionalNumber(form.get("holdingPrice")),
          targetPrice: optionalNumber(form.get("targetPrice")),
          stopLoss: optionalNumber(form.get("stopLoss")),
          positionOpenedAt: optionalDateValue(form.get("positionOpenedAt")),
          timeHorizon: form.get("timeHorizon"),
          riskLevel: form.get("riskLevel"),
          note: String(form.get("note") ?? "")
        }),
        signal: controller.signal
      });
      const json = await response.json();
      setSaving(false);

      if (!response.ok) {
        setMessage(json.error?.message ?? "保存失败。");
        return;
      }

      setMessage("已保存，正在刷新数据...");
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      setSaving(false);
      if (err instanceof DOMException && err.name === "AbortError") {
        setMessage("保存超时，请检查网络后重试。");
      } else {
        setMessage(err instanceof Error ? err.message : "保存失败，请重试。");
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  return (
    <form className="space-y-4 text-sm" onSubmit={submit}>
      <div className="grid grid-cols-3 gap-2 rounded-md border border-border bg-muted/20 p-2 text-xs">
        <Metric label="持仓天数" value={holdingDays === null ? "--" : `${holdingDays} 天`} />
        <Metric label="目标空间" value={targetReturn === null ? "--" : `${targetReturn >= 0 ? "+" : ""}${targetReturn.toFixed(1)}%`} tone={targetReturn && targetReturn > 0 ? "up" : "neutral"} />
        <Metric label="止损空间" value={stopLossReturn === null ? "--" : `${stopLossReturn.toFixed(1)}%`} tone={stopLossReturn && stopLossReturn < 0 ? "down" : "neutral"} />
      </div>

      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="持仓成本">
            <Input name="holdingPrice" type="number" step="0.001" defaultValue={holdingPrice ?? ""} placeholder="例如 2.10" />
          </Field>
          <Field label="建仓日期">
            <Input name="positionOpenedAt" type="date" defaultValue={openedDate} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="目标价">
            <Input name="targetPrice" type="number" step="0.001" defaultValue={targetPrice ?? ""} placeholder="例如 2.40" />
          </Field>
          <Field label="止损价">
            <Input name="stopLoss" type="number" step="0.001" defaultValue={stopLoss ?? ""} placeholder="例如 1.95" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="交易周期">
            <Select name="timeHorizon" defaultValue={timeHorizon ?? "swing_trade"}>
              <option value="day_trade">日内交易</option>
              <option value="swing_trade">波段交易</option>
              <option value="long_term">长期持有</option>
            </Select>
          </Field>
          <Field label="风险等级">
            <Select name="riskLevel" defaultValue={riskLevel ?? "medium"}>
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
            </Select>
          </Field>
        </div>

        <Field label="持仓备注">
          <Textarea name="note" defaultValue={note ?? ""} rows={4} placeholder="记录买入理由、仓位比例、计划加减仓条件、需要复核的风险点。" />
        </Field>
      </div>

      {message ? <div className="text-xs text-muted-foreground">{message}</div> : null}
      <Button type="submit" className="w-full" disabled={saving}>
        <Save className="h-4 w-4" />
        {saving ? "保存中..." : "保存持仓计划"}
      </Button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1.5">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "up" | "down" | "neutral" }) {
  const color = tone === "up" ? "text-red-400" : tone === "down" ? "text-emerald-400" : "text-foreground";
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className={`mt-1 font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

// 表单输入为空或无效时返回 null，让后端保留原有值
function optionalNumber(value: FormDataEntryValue | null) {
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function optionalDateValue(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function toDateInputValue(value?: string | Date | null) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function daysSince(dateText: string) {
  const start = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - start.getTime()) / (24 * 60 * 60 * 1000)));
}

function calcPercent(value?: number | null, base?: number | null) {
  if (!value || !base || base <= 0) return null;
  return ((value - base) / base) * 100;
}
