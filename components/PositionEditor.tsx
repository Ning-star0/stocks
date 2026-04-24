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
  timeHorizon?: string | null;
  riskLevel?: string | null;
  note?: string | null;
};

export function PositionEditor({ itemId, holdingPrice, targetPrice, stopLoss, timeHorizon, riskLevel, note }: PositionEditorProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);

    const response = await fetch(`/api/watchlist/items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        holdingPrice: optionalNumber(form.get("holdingPrice")),
        targetPrice: optionalNumber(form.get("targetPrice")),
        stopLoss: optionalNumber(form.get("stopLoss")),
        timeHorizon: form.get("timeHorizon"),
        riskLevel: form.get("riskLevel"),
        note: String(form.get("note") ?? "")
      })
    });
    const json = await response.json();
    setSaving(false);

    if (!response.ok) {
      setMessage(json.error?.message ?? "保存失败。");
      return;
    }

    setMessage("已保存。刷新页面后 AI 分析会使用新的持仓上下文。");
  }

  return (
    <form className="space-y-3 text-sm" onSubmit={submit}>
      <div className="grid gap-3">
        <Field label="持仓成本">
          <Input name="holdingPrice" type="number" step="0.001" defaultValue={holdingPrice ?? ""} placeholder="例如 2.10" />
        </Field>
        <Field label="目标价">
          <Input name="targetPrice" type="number" step="0.001" defaultValue={targetPrice ?? ""} placeholder="例如 2.40" />
        </Field>
        <Field label="止损价">
          <Input name="stopLoss" type="number" step="0.001" defaultValue={stopLoss ?? ""} placeholder="例如 1.95" />
        </Field>
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
        <Field label="持仓备注">
          <Textarea name="note" defaultValue={note ?? ""} placeholder="记录买入时间、买入理由、仓位计划或风险点" />
        </Field>
      </div>
      {message ? <div className="text-xs text-muted-foreground">{message}</div> : null}
      <Button type="submit" className="w-full" disabled={saving}>
        <Save className="h-4 w-4" />
        {saving ? "保存中..." : "保存持仓设置"}
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

function optionalNumber(value: FormDataEntryValue | null) {
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}
