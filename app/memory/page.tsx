"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, Clock3, Loader2, Plus, RefreshCw, Save, Trash2, UserRoundPen } from "lucide-react";

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
  const totalTextLength = useMemo(() => state.entries.reduce((sum, entry) => sum + entry.text.length, 0), [state.entries]);
  const formattedUpdatedAt = state.updatedAt
    ? new Date(state.updatedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "暂无";

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
    <PageContainer className="max-w-[90rem]">
      <SectionHeader
        title="交易记忆"
        action={
          <>
            <Badge variant="secondary">{state.entries.length} 条</Badge>
            <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">最近更新：{formattedUpdatedAt}</span>
            {message ? <span className="glow-card rounded-xl border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">{message}</span> : null}
            <Button size="sm" variant="outline" onClick={load} disabled={loading || saving}>
              <RefreshCw className="h-4 w-4" />
              刷新
            </Button>
          </>
        }
      />

      <div className="grid gap-2 md:grid-cols-4">
        <MemoryMetric label="全部记忆" value={`${state.entries.length} 条`} />
        <MemoryMetric label="手动维护" value={`${manualEntries.length} 条`} tone="success" />
        <MemoryMetric label="自动沉淀" value={`${autoEntries.length} 条`} tone="warning" />
        <MemoryMetric label="文本规模" value={`${totalTextLength} 字`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)] xl:items-start">
        <div className="space-y-4 xl:sticky xl:top-20">
          <Card className="performance-card overflow-hidden">
            <CardHeader className="border-b border-border/60 bg-background/20 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="flex items-center gap-2">
                  <UserRoundPen className="h-4 w-4 text-primary" />
                  添加记忆
                </CardTitle>
                <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">手动规则</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              <Textarea
                rows={5}
                value={newMemory}
                onChange={(event) => setNewMemory(event.target.value)}
                placeholder="例如：单只股票最多投入总本金的 20%；不追涨停后的次日高开；ETF 更看重行业景气度。"
              />
              <Button className="w-full justify-center" onClick={addManualMemory} disabled={saving || !newMemory.trim()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                添加记忆
              </Button>
            </CardContent>
          </Card>

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
                  className="min-h-[320px] font-mono text-xs"
                  value={rawContent}
                  onChange={(event) => setRawContent(event.target.value)}
                />
                <Button className="w-full justify-center" onClick={saveRaw} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  保存原文
                </Button>
              </CardContent>
            ) : (
              <CardContent className="p-4">
                <div className="glow-card rounded-xl border border-border bg-muted/15 px-3 py-2 text-xs leading-5 text-muted-foreground">
                  原文编辑用于一次性整理全部记忆，日常维护优先使用上方添加和右侧删除。
                </div>
              </CardContent>
            )}
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <MemoryList title="手动记忆" icon={<UserRoundPen className="h-4 w-4" />} entries={manualEntries} saving={saving} onDelete={deleteEntry} />
          <MemoryList title="自动记忆" icon={<Bot className="h-4 w-4" />} entries={autoEntries} saving={saving} onDelete={deleteEntry} />
        </div>
      </div>
    </PageContainer>
  );
}

function MemoryMetric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "success" | "warning" | "neutral" }) {
  return (
    <div className="glow-card rounded-xl border border-border/70 bg-card/80 px-3 py-2.5 shadow-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${tone === "success" ? "text-emerald-500" : tone === "warning" ? "text-amber-500" : "text-foreground"}`}>{value}</div>
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
      <CardContent className="p-3 sm:p-4">
        {entries.length ? (
          <div className="grid max-h-[680px] gap-2 overflow-auto pr-1">
            {entries.map((entry) => (
              <div key={entry.id} className="glow-card grid gap-2 rounded-xl border border-border bg-background/30 p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Clock3 className="h-3 w-3" />
                    <span>{entry.source === "manual" ? "手动维护" : "自动沉淀"}</span>
                  </div>
                  <p className="text-sm leading-6">{entry.text}</p>
                </div>
                <button
                  onClick={() => onDelete(entry.id)}
                  disabled={saving}
                  className="glow-card glow-click-card h-8 w-8 rounded-lg border border-transparent p-1 text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-red-400 disabled:opacity-50"
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
