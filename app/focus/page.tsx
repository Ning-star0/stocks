"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Brain, CalendarClock, Check, CheckCircle2, Clock3, Loader2, Plus, Save, Sparkles, Trash2, WalletCards } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type FocusData = {
  name: string;
  symbols: string[];
  capital: number | null;
  newsFetchTime: string;
  analysisTimes: string[];
  lastNewsFetch: string | null;
  lastAnalysis: string | null;
};

type StockItem = { symbol: string; name?: string; note?: string | null };

type FocusDecision = {
  summary: string;
  recommendedAction: "buy" | "wait";
  capital: number;
  totalBudgetToUse: number;
  totalEstimatedFee: number;
  totalEstimatedCost: number;
  cashReserve: number;
  fallbackReason?: string | null;
  fromCache?: boolean;
  stale?: boolean;
  generatedAt?: string;
  persistedAt?: string;
  scheduledFor?: string | null;
  source?: string;
  orders: Array<{
    symbol: string;
    name?: string | null;
    action: "buy" | "watch" | "avoid";
    amount: number;
    shares: number;
    estimatedPrice: number | null;
    estimatedFee: number;
    totalCost: number;
    reason: string;
    riskControl: string;
    invalidIf: string;
  }>;
  ranking: Array<{ symbol: string; rank: number; view: string; reason: string }>;
  disclaimer: string;
};

export default function FocusPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusData>({ name: "今日关注", symbols: [], capital: null, newsFetchTime: "09:30", analysisTimes: [], lastNewsFetch: null, lastAnalysis: null });
  const [watchlist, setWatchlist] = useState<StockItem[]>([]);
  const [newTime, setNewTime] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const [decision, setDecision] = useState<FocusDecision | null>(null);
  const [decisionLoading, setDecisionLoading] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [decisionNotice, setDecisionNotice] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/focus").then((r) => r.json()),
      fetch("/api/watchlist").then((r) => r.json())
    ])
      .then(async ([focusData, wlData]) => {
        setFocus((prev) => ({ ...prev, ...focusData }));
        const items = (wlData.watchlists?.[0]?.items || wlData.items || []).map((item: { symbol: string; note?: string | null; quote?: { name?: string | null } | null }) => ({
          symbol: item.symbol,
          name: item.quote?.name ?? undefined,
          note: item.note
        }));
        setWatchlist(items);
        setNames(Object.fromEntries(items.filter((item: StockItem) => item.name).map((item: StockItem) => [item.symbol, item.name as string])));
      })
      .catch(() => setMessage("加载失败"))
      .finally(() => setLoading(false));
  }, []);

  function toggleSymbol(symbol: string) {
    setDecision(null);
    setDecisionNotice(null);
    setFocus((prev) => {
      const has = prev.symbols.includes(symbol);
      return { ...prev, symbols: has ? prev.symbols.filter((s) => s !== symbol) : [...prev.symbols, symbol] };
    });
  }

  async function doSave(data: FocusData) {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/focus", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
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

  function addAnalysisTime() {
    const t = newTime.trim();
    if (!/^\d{1,2}:\d{2}$/.test(t)) return;
    setFocus((prev) => {
      const next = { ...prev, analysisTimes: [...new Set([...prev.analysisTimes, t])].sort() };
      doSave(next);
      return next;
    });
    setNewTime("");
  }

  function removeAnalysisTime(t: string) {
    setFocus((prev) => {
      const next = { ...prev, analysisTimes: prev.analysisTimes.filter((x) => x !== t) };
      doSave(next);
      return next;
    });
  }

  async function save() {
    doSave(focus);
  }

  useEffect(() => {
    if (loading || decision || decisionLoading || decisionError || decisionNotice) return;
    if (!focus.symbols.length || !focus.capital) return;
    void loadDecision("GET");
  }, [decision, decisionError, decisionLoading, decisionNotice, focus.capital, focus.symbols.length, loading]);

  async function loadDecision(method: "GET" | "POST") {
    setDecisionLoading(true);
    setDecisionError(null);
    setDecisionNotice(null);
    try {
      const response = await fetch("/api/focus/decision", { method });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message ?? "生成决策失败");
      if (json.decisionUnavailable) {
        setDecision(null);
        setDecisionNotice(json.message ?? "等待下一个自动分析时间生成买入决策。");
        return;
      }
      setDecision(json);
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : "生成决策失败");
    } finally {
      setDecisionLoading(false);
    }
  }

  async function generateDecision() {
    await loadDecision("POST");
  }

  if (loading) {
    return (
      <div className="mx-auto flex max-w-3xl items-center justify-center px-4 py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 py-4">
      <div className="flex flex-col gap-4 rounded-lg border border-border/80 bg-card/80 px-5 py-5 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-normal">今日关注</h1>
            <Badge variant={focus.symbols.length ? "success" : "secondary"}>{focus.symbols.length} 只已关注</Badge>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">从自选股中挑出今天真正需要盯盘的标的，定时抓取新闻并触发 AI 分析，减少无效消耗。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {message ? <span className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">{message}</span> : null}
          <Button onClick={save} disabled={saving || !focus.symbols.length} className="min-w-32">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "保存中" : "保存配置"}
          </Button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        {/* 选股区 */}
        <Card className="bg-card/90">
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3">
              <span>选择关注股票</span>
              <span className="text-xs font-normal text-muted-foreground">来自自选股</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {watchlist.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无自选股，请先在 /watchlist 添加。</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                  <Metric label="自选股" value={watchlist.length} />
                  <Metric label="已关注" value={focus.symbols.length} />
                  <Metric label="剩余" value={Math.max(0, watchlist.length - focus.symbols.length)} />
                </div>
                <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                  {watchlist.map((item) => (
                    <label
                      key={item.symbol}
                      className={cn(
                        "group flex cursor-pointer items-start gap-3 rounded-md border px-3 py-3 text-sm transition-colors",
                        focus.symbols.includes(item.symbol)
                          ? "border-primary/30 bg-primary/10"
                          : "border-border/70 bg-background/30 hover:border-primary/30 hover:bg-muted/40"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={focus.symbols.includes(item.symbol)}
                        onChange={() => toggleSymbol(item.symbol)}
                        className="sr-only"
                      />
                      <span
                        className={cn(
                          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors",
                          focus.symbols.includes(item.symbol) ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background"
                        )}
                      >
                        {focus.symbols.includes(item.symbol) ? <Check className="h-3.5 w-3.5" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-medium leading-5">{names[item.symbol] || item.symbol}</span>
                          <span className="text-xs tabular-nums text-muted-foreground">{item.symbol}</span>
                        </span>
                        {item.note ? <span className="mt-1 block truncate text-xs text-muted-foreground">{item.note}</span> : null}
                      </span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* 时间设置区 */}
        <Card className="bg-card/90">
          <CardHeader>
            <CardTitle>配置与分析时间</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-medium">总本金</label>
              <Input
                type="number"
                step="100"
                min="0"
                value={focus.capital ?? ""}
                onChange={(e) => {
                  setDecision(null);
                  setDecisionNotice(null);
                  setFocus((prev) => ({ ...prev, capital: e.target.value ? Number(e.target.value) : null }));
                }}
                placeholder="例如 100000"
              />
              <p className="text-xs text-muted-foreground">用于 AI 计算首次建仓股数和仓位比例。</p>
            </div>

            <TimeField
              label="每日新闻抓取时间"
              icon={<CalendarClock className="h-4 w-4" />}
              value={focus.newsFetchTime}
              onChange={(value) => setFocus((prev) => ({ ...prev, newsFetchTime: value }))}
            />

            <div className="space-y-2">
              <label className="text-sm font-medium">自动 AI 分析时间</label>
              <div className="flex gap-2">
                <TimeInput value={newTime} onChange={setNewTime} className="flex-1" />
                <Button variant="outline" size="icon" onClick={addAnalysisTime}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {focus.analysisTimes.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {focus.analysisTimes.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs">
                      {t}
                      <button onClick={() => removeAnalysisTime(t)} className="rounded text-muted-foreground hover:text-red-400" aria-label={`删除 ${t}`}>
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">未设置，添加后在这些时间点自动触发 AI 分析。</p>
              )}
            </div>

            <div className="grid gap-2 rounded-md border border-border bg-muted/20 p-3 text-sm">
              <StatusLine label="新闻抓取" value={formatDateTime(focus.lastNewsFetch)} />
              <StatusLine label="AI 分析" value={formatDateTime(focus.lastAnalysis)} />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/90">
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              AI 买入决策
            </CardTitle>
            <p className="mt-2 text-sm text-muted-foreground">按你设置的自动分析时间后台生成并保存；打开页面直接读取最近一次决策。按钮用于手动强制刷新。</p>
          </div>
          <Button onClick={generateDecision} disabled={decisionLoading || !focus.symbols.length || !focus.capital}>
            {decisionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <WalletCards className="h-4 w-4" />}
            {decisionLoading ? "更新中" : "刷新决策"}
          </Button>
        </CardHeader>
        <CardContent>
          {decisionError ? <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{decisionError}</div> : null}
          {decisionNotice ? <div className="mb-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">{decisionNotice}</div> : null}
          {!focus.capital ? (
            <div className="rounded-md border border-dashed border-border bg-background/20 p-4 text-sm text-muted-foreground">先填写总本金，AI 才能计算买入金额和手续费。</div>
          ) : decision ? (
            <FocusDecisionPanel decision={decision} />
          ) : decisionLoading ? (
            <div className="flex items-center gap-2 rounded-md border border-border bg-background/20 p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在读取买入决策
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border bg-background/20 p-4 text-sm text-muted-foreground">到达自动分析时间后，这里会显示系统后台生成的推荐买入计划、预计手续费、总成本和保留现金。</div>
          )}
        </CardContent>
      </Card>

      {/* 分析结果 */}
      {focus.symbols.length > 0 ? (
        <Card className="bg-card/90">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-4 w-4" />
              最近分析
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 xl:grid-cols-3">
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

function FocusDecisionPanel({ decision }: { decision: FocusDecision }) {
  const shouldBuy = decision.recommendedAction === "buy" && decision.orders.length > 0;
  return (
    <div className="space-y-4">
      {decision.fallbackReason ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">{decision.fallbackReason}</div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {decision.generatedAt ? <span>生成时间：{formatDateTime(decision.generatedAt)}</span> : null}
        {decision.scheduledFor ? <span>计划时间：{formatDateTime(decision.scheduledFor)}</span> : null}
        {decision.persistedAt ? <span>保存时间：{formatDateTime(decision.persistedAt)}</span> : null}
        {decision.source === "scheduled" ? <Badge variant="success">定时决策</Badge> : null}
        {decision.fromCache ? <Badge variant="secondary">已保存决策</Badge> : <Badge variant="success">最新决策</Badge>}
        {decision.stale ? <Badge variant="secondary">配置已变化</Badge> : null}
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="总本金" value={Math.round(decision.capital)} />
        <Metric label="计划买入" value={Math.round(decision.totalBudgetToUse)} />
        <Metric label="预计手续费" value={Math.round(decision.totalEstimatedFee)} />
        <Metric label="保留现金" value={Math.round(decision.cashReserve)} />
      </div>
      <div className={cn("rounded-md border px-4 py-3", shouldBuy ? "border-primary/30 bg-primary/10" : "border-amber-500/30 bg-amber-500/10")}>
        <div className="mb-1 text-sm font-semibold">{shouldBuy ? "建议买入" : "建议等待"}</div>
        <p className="text-sm leading-6 text-muted-foreground">{decision.summary}</p>
      </div>
      {decision.orders.length ? (
        <div className="grid gap-3 xl:grid-cols-2">
          {decision.orders.map((order) => (
            <div key={order.symbol} className="rounded-md border border-border bg-background/30 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{order.name || order.symbol}</div>
                  <div className="mt-1 text-xs tabular-nums text-muted-foreground">{order.symbol}</div>
                </div>
                <Badge variant="success">买入</Badge>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <DecisionNumber label="数量" value={`${order.shares} 股/份`} />
                <DecisionNumber label="参考价" value={formatMoney(order.estimatedPrice)} />
                <DecisionNumber label="成交金额" value={formatMoney(order.amount)} />
                <DecisionNumber label="手续费" value={formatMoney(order.estimatedFee)} />
                <DecisionNumber label="总成本" value={formatMoney(order.totalCost)} className="col-span-2" />
              </div>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">{order.reason}</p>
              {order.riskControl ? <p className="mt-2 text-xs leading-5 text-muted-foreground">风控：{order.riskControl}</p> : null}
              {order.invalidIf ? <p className="mt-1 text-xs leading-5 text-amber-300">失效：{order.invalidIf}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
      {decision.ranking.length ? (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">候选排序</div>
          <div className="grid gap-2 md:grid-cols-3">
            {decision.ranking.slice(0, 6).map((item) => (
              <div key={`${item.symbol}-${item.rank}`} className="rounded-md border border-border bg-muted/15 px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{item.rank}. {item.symbol}</span>
                  <span className="text-xs text-muted-foreground">{item.view}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.reason}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <p className="border-t border-border pt-3 text-xs text-muted-foreground">{decision.disclaimer}</p>
    </div>
  );
}

function DecisionNumber({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("rounded-md border border-border bg-muted/20 px-3 py-2", className)}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium tabular-nums">{value}</div>
    </div>
  );
}

function formatMoney(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 }).format(value);
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function TimeField({ label, icon, value, onChange }: { label: string; icon: ReactNode; value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      <TimeInput value={value} onChange={onChange} icon={icon} />
    </div>
  );
}

function TimeInput({ value, onChange, icon, className }: { value: string; onChange: (value: string) => void; icon?: ReactNode; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
        {icon ?? <Clock3 className="h-4 w-4" />}
      </span>
      <Input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-9 [&::-webkit-calendar-picker-indicator]:opacity-0"
      />
    </div>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right tabular-nums">{value}</span>
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

  if (loading) {
    return (
      <div className="flex min-h-36 items-center gap-2 rounded-md border border-border bg-background/30 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {symbol} 加载中
      </div>
    );
  }
  if (!analysis) {
    return (
      <div className="min-h-36 rounded-md border border-dashed border-border bg-background/20 p-4 text-sm text-muted-foreground">
        <div className="font-medium text-foreground">{symbol}</div>
        <p className="mt-2 leading-6">暂无分析。保存配置后，等待下一个自动分析时间触发。</p>
      </div>
    );
  }

  const trend = getTrendMeta(analysis.trend);
  const confidence = Math.round((analysis.confidence ?? 0) * 100);
  const summary = makeFriendlySummary(analysis.summary);

  return (
    <div className="flex min-h-48 flex-col rounded-md border border-border bg-background/30 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold tabular-nums">{symbol}</div>
          <div className="mt-1 text-xs text-muted-foreground">置信度 {confidence}%</div>
        </div>
        <Badge variant={trend.variant}>{trend.label}</Badge>
      </div>
      <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">{summary}</p>
      <div className="mt-4 space-y-2 border-t border-border pt-3 text-sm">
        {analysis.holdAdvice?.action ? <AdviceLine label="持仓" value={analysis.holdAdvice.action} /> : null}
        {analysis.entryAdvice?.action ? <AdviceLine label="入场" value={analysis.entryAdvice.action} /> : null}
      </div>
    </div>
  );
}

function AdviceLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function getTrendMeta(trend?: string): { label: string; variant: "success" | "warning" | "danger" | "secondary" } {
  if (trend === "bullish") return { label: "偏强", variant: "success" };
  if (trend === "bearish") return { label: "偏弱", variant: "danger" };
  if (trend === "neutral") return { label: "中性", variant: "warning" };
  return { label: "待确认", variant: "secondary" };
}

function makeFriendlySummary(summary?: string) {
  if (!summary) return "暂无摘要。";
  if (summary.includes("AI 服务请求失败") || summary.includes("API 连接失败") || summary.includes("This operation was aborted")) {
    return "AI 服务暂时不可用，当前结果为本地规则生成的临时分析。服务恢复后建议重新分析。";
  }
  return summary.replace(/\s*本分析截至\s*\d{4}-\d{2}-\d{2}T\S+/g, "").trim();
}

function formatDateTime(value?: string | null) {
  if (!value) return "尚未执行";
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
