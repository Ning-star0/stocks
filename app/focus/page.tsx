"use client";

import { useEffect, useState } from "react";
import { Brain, Loader2, Plus, Save, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type FocusData = {
  name: string;
  symbols: string[];
  newsFetchTime: string;
  analysisTimes: string[];
  lastNewsFetch: string | null;
  lastAnalysis: string | null;
};

type StockItem = { symbol: string; note?: string | null };

export default function FocusPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusData>({ name: "今日关注", symbols: [], newsFetchTime: "09:30", analysisTimes: [], lastNewsFetch: null, lastAnalysis: null });
  const [watchlist, setWatchlist] = useState<StockItem[]>([]);
  const [newTime, setNewTime] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/focus").then((r) => r.json()),
      fetch("/api/watchlist").then((r) => r.json())
    ])
      .then(([focusData, wlData]) => {
        setFocus((prev) => ({ ...prev, ...focusData }));
        const items = (wlData.watchlists?.[0]?.items || wlData.items || []).map((item: { symbol: string; note?: string | null }) => ({
          symbol: item.symbol,
          note: item.note
        }));
        setWatchlist(items);
      })
      .catch(() => setMessage("加载失败"))
      .finally(() => setLoading(false));
  }, []);

  function toggleSymbol(symbol: string) {
    setFocus((prev) => {
      const has = prev.symbols.includes(symbol);
      return { ...prev, symbols: has ? prev.symbols.filter((s) => s !== symbol) : [...prev.symbols, symbol] };
    });
  }

  function addAnalysisTime() {
    const t = newTime.trim();
    if (!/^\d{1,2}:\d{2}$/.test(t)) return;
    setFocus((prev) => ({
      ...prev,
      analysisTimes: [...new Set([...prev.analysisTimes, t])].sort()
    }));
    setNewTime("");
  }

  function removeAnalysisTime(t: string) {
    setFocus((prev) => ({ ...prev, analysisTimes: prev.analysisTimes.filter((x) => x !== t) }));
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/focus", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(focus)
      });
      if (!res.ok) throw new Error((await res.json()).error?.message ?? "保存失败");
      setMessage("已保存");
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存失败");
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
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">今日关注</h1>
          <p className="mt-1 text-sm text-muted-foreground">从自选股中二次挑选，只对这些股票自动分析，避免消耗不必要的 token。</p>
        </div>
        <Button onClick={save} disabled={saving || !focus.symbols.length}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? "保存中..." : "保存配置"}
        </Button>
      </div>

      {message ? <div className="rounded-md bg-muted/30 px-3 py-2 text-sm">{message}</div> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 选股区 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">选择关注股票</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {watchlist.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无自选股，请先在 /watchlist 添加。</p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  已选 {focus.symbols.length} 只
                </p>
                <div className="max-h-64 space-y-1 overflow-y-auto">
                  {watchlist.map((item) => (
                    <label
                      key={item.symbol}
                      className={`flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted/50 ${
                        focus.symbols.includes(item.symbol) ? "bg-primary/10" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={focus.symbols.includes(item.symbol)}
                        onChange={() => toggleSymbol(item.symbol)}
                        className="h-4 w-4 rounded accent-primary"
                      />
                      <span className="font-medium tabular-nums">{item.symbol}</span>
                      {item.note ? <span className="text-xs text-muted-foreground">{item.note}</span> : null}
                    </label>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* 时间设置区 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">分析时间设置</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">每日新闻抓取时间</label>
              <Input
                type="time"
                value={focus.newsFetchTime}
                onChange={(e) => setFocus((prev) => ({ ...prev, newsFetchTime: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">自动 AI 分析时间</label>
              <div className="flex gap-2">
                <Input
                  type="time"
                  value={newTime}
                  onChange={(e) => setNewTime(e.target.value)}
                  placeholder="如 10:00"
                  className="flex-1"
                />
                <Button variant="outline" size="icon" onClick={addAnalysisTime}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {focus.analysisTimes.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {focus.analysisTimes.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs">
                      {t}
                      <button onClick={() => removeAnalysisTime(t)} className="text-muted-foreground hover:text-red-400">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">未设置，添加后在这些时间点自动触发 AI 分析。</p>
              )}
            </div>

            <div className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground space-y-1">
              <p>状态：</p>
              <p>新闻抓取：{focus.lastNewsFetch ? `上次 ${new Date(focus.lastNewsFetch).toLocaleString("zh-CN")}` : "尚未执行"}</p>
              <p>AI 分析：{focus.lastAnalysis ? `上次 ${new Date(focus.lastAnalysis).toLocaleString("zh-CN")}` : "尚未执行"}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 分析结果 */}
      {focus.symbols.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Brain className="h-4 w-4" />
              最近分析
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3">
              {focus.symbols.map((symbol) => (
                <FocusAnalysisCard key={symbol} symbol={symbol} />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function FocusAnalysisCard({ symbol }: { symbol: string }) {
  const [analysis, setAnalysis] = useState<{ summary?: string; trend?: string; confidence?: number; holdAdvice?: { action?: string; reason?: string }; entryAdvice?: { action?: string; reason?: string } } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/stocks/${symbol}/analysis/latest`)
      .then((r) => r.json())
      .then((data) => {
        setAnalysis(data.outputJson ?? data.analysis?.outputJson ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [symbol]);

  if (loading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />{symbol} 加载中...</div>;
  if (!analysis) return <div className="text-sm text-muted-foreground">{symbol}：暂无分析，点击右上角保存后等待自动分析。</div>;

  const trendLabel = analysis.trend === "bullish" ? "📈 看多" : analysis.trend === "bearish" ? "📉 看空" : "➡️ 中性";

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="font-semibold text-sm">{symbol}</span>
        <span className="text-xs text-muted-foreground">{trendLabel} · 置信度 {(analysis.confidence ?? 0) * 100}%</span>
      </div>
      <p className="text-xs text-muted-foreground mb-2">{analysis.summary ?? "暂无摘要"}</p>
      {analysis.holdAdvice?.action ? <p className="text-xs">持有建议：{analysis.holdAdvice.action} — {analysis.holdAdvice.reason}</p> : null}
      {analysis.entryAdvice?.action ? <p className="text-xs">入场建议：{analysis.entryAdvice.action} — {analysis.entryAdvice.reason}</p> : null}
    </div>
  );
}
