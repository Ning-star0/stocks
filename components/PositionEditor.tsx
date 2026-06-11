"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { readJsonResponse } from "@/lib/clientApi";

type PositionEditorProps = {
  itemId: string;
  isHolding?: boolean | null;
  holdingPrice?: number | null;
  holdingShares?: number | null;
  targetPrice?: number | null;
  stopLoss?: number | null;
  positionOpenedAt?: string | Date | null;
  timeHorizon?: string | null;
  riskLevel?: string | null;
  note?: string | null;
};

export function PositionEditor({
  itemId,
  isHolding,
  holdingPrice,
  holdingShares,
  targetPrice,
  stopLoss,
  positionOpenedAt,
  timeHorizon,
  riskLevel,
  note
}: PositionEditorProps) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const openedDate = toDateInputValue(positionOpenedAt);
  const holdingDays = openedDate ? daysSince(openedDate) : null;
  const targetReturn = calcPercent(targetPrice, holdingPrice);
  const stopLossReturn = calcPercent(stopLoss, holdingPrice);
  const positionCost = holdingPrice && holdingShares ? holdingPrice * holdingShares : null;

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
          isHolding: form.get("isHolding") === "on",
          holdingPrice: optionalNumber(form.get("holdingPrice")),
          holdingShares: optionalNumber(form.get("holdingShares")),
          targetPrice: optionalNumber(form.get("targetPrice")),
          stopLoss: optionalNumber(form.get("stopLoss")),
          positionOpenedAt: optionalDateValue(form.get("positionOpenedAt")),
          timeHorizon: form.get("timeHorizon"),
          riskLevel: form.get("riskLevel"),
          note: String(form.get("note") ?? "")
        }),
        signal: controller.signal
      });
      await readJsonResponse(response);

      setMessage("已保存。");
      router.refresh();
    } catch (err) {
      setSaving(false);
      if (err instanceof DOMException && err.name === "AbortError") {
        setMessage("保存超时，请检查网络后重试。");
      } else {
        setMessage(err instanceof Error ? err.message : "保存失败，请重试。");
      }
    } finally {
      setSaving(false);
      clearTimeout(timeout);
    }
  }

  return (
    <form className="space-y-4 text-sm" onSubmit={submit}>
      <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-border bg-muted/15 p-3">
        <span>
          <span className="block font-medium">是否已购买 / 已持仓</span>
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">AI 会优先使用这个状态判断“持仓观察”或“未持仓观察”，不再只根据持仓价反推。</span>
        </span>
        <input
          name="isHolding"
          type="checkbox"
          defaultChecked={Boolean(isHolding)}
          className="mt-1 h-4 w-4 shrink-0 rounded border-input accent-primary"
        />
      </label>

      <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/20 p-2 text-xs sm:grid-cols-4">
        <Metric label="持仓天数" value={holdingDays === null ? "--" : `${holdingDays} 天`} />
        <Metric label="持仓数量" value={holdingShares ? `${formatQuantity(holdingShares)} 股/份` : "--"} />
        <Metric label="目标空间" value={targetReturn === null ? "--" : `${targetReturn >= 0 ? "+" : ""}${targetReturn.toFixed(1)}%`} tone={targetReturn && targetReturn > 0 ? "up" : "neutral"} />
        <Metric label="止损空间" value={stopLossReturn === null ? "--" : `${stopLossReturn.toFixed(1)}%`} tone={stopLossReturn && stopLossReturn < 0 ? "down" : "neutral"} />
      </div>

      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="持仓成本">
            <Input name="holdingPrice" type="number" step="0.001" defaultValue={holdingPrice ?? ""} placeholder="例如 2.10" />
          </Field>
          <Field label="持仓数量（股/份）">
            <Input name="holdingShares" type="number" step="1" defaultValue={holdingShares ?? ""} placeholder="例如 200" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="建仓日期">
            <Input name="positionOpenedAt" type="date" defaultValue={openedDate} />
          </Field>
          <Field label="持仓金额">
            <Input value={positionCost === null ? "--" : positionCost.toFixed(2)} readOnly aria-label="持仓金额" />
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

// 表单输入为空或无效时返回 null，后端会清空对应持仓字段。
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

function formatQuantity(value: number) {
  return Number.isInteger(value) ? value.toLocaleString("zh-CN") : value.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
}
