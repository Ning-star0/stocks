"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, Loader2, Plus, Save, Trash2, UserRoundPen } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

type MemoryEntry = {
  id: string;
  text: string;
  source: "manual" | "auto";
};

type MemoryState = {
  content: string;
  updatedAt: string | null;
  entries: MemoryEntry[];
};

export default function MemoryPage() {
  const [state, setState] = useState<MemoryState>({ content: "", updatedAt: null, entries: [] });
  const [newMemory, setNewMemory] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rawOpen, setRawOpen] = useState(false);
  const [rawContent, setRawContent] = useState("");

  useEffect(() => {
    load();
  }, []);

  const manualEntries = useMemo(() => state.entries.filter((entry) => entry.source === "manual"), [state.entries]);
  const autoEntries = useMemo(() => state.entries.filter((entry) => entry.source === "auto"), [state.entries]);

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/memory", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "加载失败");
      setState(data);
      setRawContent(data.content ?? "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  async function addManualMemory() {
    const text = newMemory.trim();
    if (!text) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "添加失败");
      setNewMemory("");
      await load();
      setMessage("已添加");
      setTimeout(() => setMessage(null), 2500);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "添加失败");
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(id: string) {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/memory?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "删除失败");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败");
    } finally {
      setSaving(false);
    }
  }

  async function saveRaw() {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: rawContent })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message ?? "保存失败");
      await load();
      setMessage("已保存");
      setTimeout(() => setMessage(null), 2500);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto flex max-w-4xl items-center justify-center px-4 py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-4">
      <div className="rounded-lg border border-border/80 bg-card/80 px-5 py-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-normal">交易记忆</h1>
              <Badge variant="secondary">{state.entries.length} 条</Badge>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              AI 会在对话中自动沉淀你的偏好；你也可以手动添加明确规则。所有股票分析、聊天和策略观察都会参考这些记忆。
            </p>
            {state.updatedAt ? <p className="mt-2 text-xs text-muted-foreground">最近更新：{new Date(state.updatedAt).toLocaleString("zh-CN")}</p> : null}
          </div>
          {message ? <span className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">{message}</span> : null}
        </div>
      </div>

      <Card className="bg-card/90">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserRoundPen className="h-4 w-4 text-primary" />
            手动添加记忆
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            rows={3}
            value={newMemory}
            onChange={(event) => setNewMemory(event.target.value)}
            placeholder="例如：单只股票最多投入总本金的 20%；不追涨停后的次日高开；ETF 更看重行业景气度。"
          />
          <div className="flex items-center gap-3">
            <Button onClick={addManualMemory} disabled={saving || !newMemory.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              添加记忆
            </Button>
            <span className="text-xs text-muted-foreground">每行或每段会自动整理成独立记忆，并去掉重复项。</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <MemoryList title="手动记忆" icon={<UserRoundPen className="h-4 w-4" />} entries={manualEntries} saving={saving} onDelete={deleteEntry} />
        <MemoryList title="自动记忆" icon={<Bot className="h-4 w-4" />} entries={autoEntries} saving={saving} onDelete={deleteEntry} />
      </div>

      <Card className="bg-card/90">
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle>高级编辑</CardTitle>
          <Button variant="outline" size="sm" onClick={() => setRawOpen((value) => !value)}>
            {rawOpen ? "收起" : "编辑原文"}
          </Button>
        </CardHeader>
        {rawOpen ? (
          <CardContent className="space-y-3">
            <Textarea
              className="font-mono"
              rows={16}
              value={rawContent}
              onChange={(event) => setRawContent(event.target.value)}
            />
            <Button onClick={saveRaw} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              保存原文
            </Button>
          </CardContent>
        ) : null}
      </Card>
    </div>
  );
}

function MemoryList({
  title,
  icon,
  entries,
  saving,
  onDelete
}: {
  title: string;
  icon: React.ReactNode;
  entries: MemoryEntry[];
  saving: boolean;
  onDelete: (id: string) => void;
}) {
  return (
    <Card className="bg-card/90">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
          <Badge variant="secondary">{entries.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length ? (
          <div className="space-y-2">
            {entries.map((entry) => (
              <div key={entry.id} className="flex items-start gap-3 rounded-md border border-border bg-background/30 p-3">
                <p className="min-w-0 flex-1 text-sm leading-6">{entry.text}</p>
                <button
                  onClick={() => onDelete(entry.id)}
                  disabled={saving}
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-red-400 disabled:opacity-50"
                  aria-label="删除记忆"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border bg-background/20 p-4 text-sm text-muted-foreground">暂无{title}。</div>
        )}
      </CardContent>
    </Card>
  );
}
