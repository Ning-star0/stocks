"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, Loader2, Plus, Save, Trash2, UserRoundPen } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageContainer, SectionHeader } from "@/components/ui/layout";
import { Textarea } from "@/components/ui/textarea";
import { readJsonResponse } from "@/lib/clientApi";

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
      const data = await readJsonResponse<MemoryState>(response);
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
      await readJsonResponse(response);
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
      await readJsonResponse(response);
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
      await readJsonResponse(response);
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
    <PageContainer className="max-w-5xl">
      <SectionHeader
        title="交易记忆"
        action={
          <>
            <Badge variant="secondary">{state.entries.length} 条</Badge>
            {state.updatedAt ? <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">最近更新：{new Date(state.updatedAt).toLocaleString("zh-CN")}</span> : null}
            {message ? <span className="glow-card rounded-xl border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">{message}</span> : null}
          </>
        }
      />

      <Card className="performance-card overflow-hidden">
        <CardHeader className="border-b border-border/60 bg-background/20 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="flex items-center gap-2">
              <UserRoundPen className="h-4 w-4 text-primary" />
              手动添加记忆
            </CardTitle>
            <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">去重整理</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 p-4">
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
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <MemoryList title="手动记忆" icon={<UserRoundPen className="h-4 w-4" />} entries={manualEntries} saving={saving} onDelete={deleteEntry} />
        <MemoryList title="自动记忆" icon={<Bot className="h-4 w-4" />} entries={autoEntries} saving={saving} onDelete={deleteEntry} />
      </div>

      <Card className="performance-card overflow-hidden">
        <CardHeader className="flex-row items-center justify-between gap-3 border-b border-border/60 bg-background/20 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>高级编辑</CardTitle>
            <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">{rawOpen ? "正在编辑" : "已折叠"}</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => setRawOpen((value) => !value)}>
            {rawOpen ? "收起" : "编辑原文"}
          </Button>
        </CardHeader>
        {rawOpen ? (
          <CardContent className="space-y-3 p-4">
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
    </PageContainer>
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
    <Card className="performance-card overflow-hidden">
      <CardHeader className="border-b border-border/60 bg-background/20 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="flex items-center gap-2">
            {icon}
            {title}
          </CardTitle>
          <Badge variant="secondary">{entries.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        {entries.length ? (
          <div className="space-y-2">
            {entries.map((entry) => (
              <div key={entry.id} className="glow-card flex items-start gap-3 rounded-xl border border-border bg-background/30 p-3">
                <p className="min-w-0 flex-1 text-sm leading-6">{entry.text}</p>
                <button
                  onClick={() => onDelete(entry.id)}
                  disabled={saving}
                  className="glow-card glow-click-card rounded-lg border border-transparent p-1 text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-red-400 disabled:opacity-50"
                  aria-label="删除记忆"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="glow-card rounded-xl border border-dashed border-border bg-background/20 p-4 text-sm text-muted-foreground">暂无{title}。</div>
        )}
      </CardContent>
    </Card>
  );
}
