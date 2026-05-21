"use client";

import { useEffect, useState } from "react";
import { Loader2, Save, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function MemoryPage() {
  const [content, setContent] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/memory")
      .then((r) => r.json())
      .then((data) => {
        if (data.content) setContent(data.content);
        if (data.updatedAt) setUpdatedAt(data.updatedAt);
      })
      .catch(() => setMessage("加载失败"))
      .finally(() => setLoading(false));
  }, []);

  async function clear() {
    setContent("");
    setMessage(null);
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content })
      });
      if (!res.ok) throw new Error("保存失败");
      setMessage("已保存");
      setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage("保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto flex max-w-3xl items-center justify-center px-4 py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-bold">交易记忆</h1>
      <p className="text-sm text-muted-foreground">
        记录你的交易习惯、偏好和历史总结。这些内容会在 AI 分析和智能问答中作为背景参考。
        AI 对话中会自动更新记忆。{updatedAt ? ` 最近更新：${new Date(updatedAt).toLocaleString("zh-CN")}` : ""}
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">编辑记忆</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <textarea
            className="w-full rounded-md border border-input bg-background p-3 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            rows={20}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="例如：

## 买入习惯
- 偏好波段交易，持仓周期 1-3 个月
- 喜欢在回调至支撑位时分批建仓
- 单只股票仓位不超过总资金的 15%

## 风险偏好
- 中风险，单笔最大亏损控制在 5%
- 达到止损价无条件离场

## 持仓习惯
- 同时持有不超过 8 只股票
- 每周复核一次持仓
- 关注行业：科技、新能源、消费"
          />
          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "保存中..." : "保存记忆"}
            </Button>
            <Button variant="outline" onClick={clear} disabled={saving || !content} className="text-red-400">
              <Trash2 className="h-4 w-4" />
              清空
            </Button>
            {message ? <span className="text-sm text-muted-foreground">{message}</span> : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
