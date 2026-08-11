"use client";

import { useEffect, useMemo, useState } from "react";
import { Archive, Bot, Download, ExternalLink, FileJson, FileText, Loader2, RefreshCw, Sparkles } from "lucide-react";

import { StockIdentity } from "@/components/StockIdentity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageContainer, SectionHeader } from "@/components/ui/layout";
import { Select } from "@/components/ui/select";
import { readJsonResponse } from "@/lib/clientApi";
import type { ResearchExportFile, ResearchExportOptions, ResearchExportResult, ResearchSymbolForecast } from "@/lib/research/types";
import { formatDateTime, formatPrice } from "@/lib/trading/display";
import { cn } from "@/lib/utils";

export default function ResearchPage() {
  const [options, setOptions] = useState<ResearchExportOptions | null>(null);
  const [symbols, setSymbols] = useState<string[]>([]);
  const [range, setRange] = useState("1y");
  const [interval, setInterval] = useState("1d");
  const [newsDays, setNewsDays] = useState(30);
  const [includeForecast, setIncludeForecast] = useState(true);
  const [result, setResult] = useState<ResearchExportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadOptions(applyDefaults = false) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/research-export", { cache: "no-store" });
      const data = await readJsonResponse<ResearchExportOptions>(response);
      setOptions(data);
      if (applyDefaults) {
        setSymbols(data.defaults.symbols);
        setRange(data.defaults.range);
        setInterval(data.defaults.interval);
        setNewsDays(data.defaults.newsDays);
        setIncludeForecast(data.defaults.includeForecast);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "研究包配置读取失败。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadOptions(true); }, []);

  const selectedNames = useMemo(() => new Map((options?.instruments ?? []).map((item) => [item.symbol, item.name])), [options]);

  function toggleSymbol(symbol: string) {
    setError(null);
    setSymbols((current) => {
      if (current.includes(symbol)) return current.filter((item) => item !== symbol);
      if (current.length >= 8) {
        setError("单个研究包最多包含 8 个标的。");
        return current;
      }
      return [...current, symbol];
    });
  }

  function changeInterval(value: string) {
    setInterval(value);
    if (value === "60m" && !["1mo", "3mo"].includes(range)) setRange("3mo");
  }

  async function generate() {
    if (!symbols.length) {
      setError("请至少选择一个标的。");
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const response = await fetch("/api/research-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols, range, interval, newsDays, includeForecast })
      });
      const data = await readJsonResponse<ResearchExportResult>(response);
      setResult(data);
      setOptions((current) => current ? { ...current, files: mergeFiles(data.files, current.files) } : current);
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "研究包生成失败。");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <PageContainer>
      <SectionHeader
        eyebrow="模型研究"
        title="ChatGPT 研究包"
        action={
          <>
            <Button asChild size="sm" variant="outline">
              <a href="https://chatgpt.com/" target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                ChatGPT
              </a>
            </Button>
            <Button size="icon" variant="outline" onClick={() => void loadOptions(false)} disabled={loading} title="刷新归档">
              <RefreshCw className={cn("h-4 w-4", loading ? "animate-spin" : "")} />
            </Button>
          </>
        }
      />

      {error ? <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div> : null}

      <Card className="performance-card overflow-hidden">
        <CardHeader className="border-b border-border/70 bg-background/25 p-4">
          <CardTitle className="flex items-center gap-2"><Archive className="h-4 w-4 text-primary" />数据范围</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 p-4">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {(options?.instruments ?? []).map((item) => {
              const checked = symbols.includes(item.symbol);
              return (
                <label key={item.symbol} className={cn("flex min-w-0 cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 transition-colors", checked ? "border-primary/35 bg-primary/8" : "border-border bg-background/35 hover:bg-muted/35")}>
                  <input type="checkbox" checked={checked} onChange={() => toggleSymbol(item.symbol)} className="h-4 w-4 accent-primary" />
                  <div className="min-w-0 flex-1"><StockIdentity symbol={item.symbol} name={item.name} compact /></div>
                  {item.isHolding ? <Badge variant="warning">持仓</Badge> : item.isFocused ? <Badge variant="secondary">关注</Badge> : null}
                </label>
              );
            })}
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[180px_180px_180px_minmax(240px,1fr)_auto] xl:items-end">
            <Field label="K 线周期">
              <Select value={interval} onChange={(event) => changeInterval(event.target.value)}>
                <option value="1d">日线</option>
                <option value="60m">60 分钟</option>
              </Select>
            </Field>
            <Field label="K 线范围">
              <Select value={range} onChange={(event) => setRange(event.target.value)}>
                <option value="1mo">近 1 个月</option>
                <option value="3mo">近 3 个月</option>
                {interval === "1d" ? <option value="6mo">近 6 个月</option> : null}
                {interval === "1d" ? <option value="1y">近 1 年</option> : null}
                {interval === "1d" ? <option value="2y">近 2 年</option> : null}
              </Select>
            </Field>
            <Field label="新闻窗口">
              <Select value={String(newsDays)} onChange={(event) => setNewsDays(Number(event.target.value))}>
                <option value="7">近 7 天</option>
                <option value="14">近 14 天</option>
                <option value="30">近 30 天</option>
                <option value="90">近 90 天</option>
              </Select>
            </Field>
            <label className="flex h-10 cursor-pointer items-center justify-between gap-3 rounded-md border border-border bg-background/35 px-3">
              <span className="flex items-center gap-2 text-sm font-medium"><Bot className="h-4 w-4 text-primary" />DeepSeek 场景预测</span>
              <input type="checkbox" checked={includeForecast} onChange={(event) => setIncludeForecast(event.target.checked)} className="h-4 w-4 accent-primary" />
            </label>
            <Button onClick={() => void generate()} disabled={generating || loading || !symbols.length} className="min-w-36">
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {generating ? "生成中" : "生成研究包"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {result ? <ResearchResult result={result} names={selectedNames} /> : null}
      <ResearchArchive files={options?.files ?? []} />
    </PageContainer>
  );
}

function ResearchResult({ result, names }: { result: ResearchExportResult; names: Map<string, string | null> }) {
  return (
    <>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {result.symbols.map((item) => (
          <div key={item.symbol} className="rounded-md border border-border bg-background/35 p-4">
            <StockIdentity symbol={item.symbol} name={item.name ?? names.get(item.symbol)} />
            <div className="mt-3 flex gap-4 text-xs text-muted-foreground"><span>K 线 {item.candles}</span><span>新闻 {item.news}</span></div>
            {item.historyError ? <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">{item.historyError}</div> : null}
          </div>
        ))}
      </div>
      {result.forecast ? (
        <Card className="performance-card overflow-hidden">
          <CardHeader className="flex-row items-center justify-between gap-3 border-b border-border/70 bg-background/25 p-4">
            <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" />DeepSeek 概率场景</CardTitle>
            <Badge variant={result.forecast.status === "ai" ? "success" : "warning"}>{result.forecast.status === "ai" ? result.forecast.model : "本地基线"}</Badge>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            <p className="text-sm leading-6 text-muted-foreground">{result.forecast.marketView}</p>
            <div className="grid gap-3 xl:grid-cols-2">
              {result.forecast.symbols.map((forecast) => <ForecastCard key={forecast.symbol} forecast={forecast} />)}
            </div>
          </CardContent>
        </Card>
      ) : null}
      {result.strategyBacktests.length ? (
        <Card className="performance-card overflow-hidden">
          <CardHeader className="border-b border-border/70 bg-background/25 p-4"><CardTitle className="flex items-center gap-2"><Bot className="h-4 w-4 text-primary" />研究包内策略回测</CardTitle></CardHeader>
          <CardContent className="p-0">
            {result.strategyBacktestPortfolio ? <div className="flex flex-wrap items-center gap-4 border-b border-border/70 px-4 py-3 text-sm"><Badge variant={result.strategyBacktestPortfolio.status === "validated" ? "success" : "warning"}>{result.strategyBacktestPortfolio.recommendedPresetName}</Badge><span>样本外平均 <b className={result.strategyBacktestPortfolio.validationAverageReturnPct >= 0 ? "text-red-500" : "text-emerald-500"}>{result.strategyBacktestPortfolio.validationAverageReturnPct > 0 ? "+" : ""}{result.strategyBacktestPortfolio.validationAverageReturnPct.toFixed(2)}%</b></span><span className="text-muted-foreground">盈利标的 {result.strategyBacktestPortfolio.validationProfitableSymbols}/{result.strategyBacktestPortfolio.symbolCount}</span>{result.strategyBacktestPortfolio.rollingGate ? <span>滚动门控改善 <b className={result.strategyBacktestPortfolio.rollingGate.averageImprovementPct >= 0 ? "text-red-500" : "text-emerald-500"}>{result.strategyBacktestPortfolio.rollingGate.averageImprovementPct > 0 ? "+" : ""}{result.strategyBacktestPortfolio.rollingGate.averageImprovementPct.toFixed(2)}%</b></span> : null}<span className="text-xs text-muted-foreground">{result.strategyBacktestPortfolio.note}</span></div> : null}
            <div className="grid gap-px bg-border/65 md:grid-cols-2 xl:grid-cols-4">
            {result.strategyBacktests.map((item) => <div key={item.symbol} className="bg-card/95 p-4"><StockIdentity symbol={item.symbol} /><div className="mt-2 text-xs text-muted-foreground">训练区间选中 {item.recommendedPreset}</div><div className={cn("mt-1 text-xl font-semibold tabular-nums", item.netReturnPct >= 0 ? "text-red-500" : "text-emerald-500")}>{item.netReturnPct > 0 ? "+" : ""}{item.netReturnPct.toFixed(2)}%</div><div className="mt-2 flex gap-4 text-xs text-muted-foreground"><span>样本外平仓 {item.closedTrades}</span><span>回撤 {item.maxDrawdownPct.toFixed(2)}%</span></div></div>)}
            </div>
          </CardContent>
        </Card>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/25 bg-primary/8 px-4 py-3">
        <span className="mr-auto text-sm">生成时间 {formatDateTime(result.generatedAt)}</span>
        {result.files.map((file) => <DownloadButton key={file.name} file={file} />)}
      </div>
    </>
  );
}

function ForecastCard({ forecast }: { forecast: ResearchSymbolForecast }) {
  return (
    <div className="rounded-md border border-border bg-background/35 p-4">
      <div className="flex items-start justify-between gap-3"><StockIdentity symbol={forecast.symbol} name={forecast.name} /><Badge variant={forecast.bias === "bullish" ? "danger" : forecast.bias === "bearish" ? "success" : "secondary"}>{forecast.bias === "bullish" ? "偏多" : forecast.bias === "bearish" ? "偏空" : "震荡"}</Badge></div>
      <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-muted">
        <div className="bg-red-500" style={{ width: `${forecast.upProbability}%` }} />
        <div className="bg-amber-400" style={{ width: `${forecast.sidewaysProbability}%` }} />
        <div className="bg-emerald-500" style={{ width: `${forecast.downProbability}%` }} />
      </div>
      <div className="mt-2 grid grid-cols-3 text-xs tabular-nums"><span className="text-red-500">上涨 {forecast.upProbability}%</span><span className="text-center text-amber-600">震荡 {forecast.sidewaysProbability}%</span><span className="text-right text-emerald-500">下跌 {forecast.downProbability}%</span></div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-xs"><ForecastValue label="低位" value={formatPrice(forecast.expectedLow)} /><ForecastValue label="基准" value={formatPrice(forecast.expectedBase)} /><ForecastValue label="高位" value={formatPrice(forecast.expectedHigh)} /></div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">{forecast.rationale}</p>
    </div>
  );
}

function ForecastValue({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-border/70 px-2 py-2"><div className="text-muted-foreground">{label}</div><div className="mt-1 font-semibold tabular-nums">{value}</div></div>;
}

function ResearchArchive({ files }: { files: ResearchExportFile[] }) {
  const packages = files.slice(0, 10);
  return (
    <Card className="performance-card overflow-hidden">
      <CardHeader className="border-b border-border/70 bg-background/25 p-4"><CardTitle className="flex items-center gap-2"><Archive className="h-4 w-4 text-primary" />服务器归档</CardTitle></CardHeader>
      <CardContent className="p-0">
        {packages.length ? <div className="divide-y divide-border/70">{packages.map((file) => <div key={file.name} className="flex flex-wrap items-center gap-3 px-4 py-3"><span className="min-w-0 flex-1 truncate text-sm font-medium">{file.name}</span><span className="text-xs text-muted-foreground">{formatFileSize(file.size)}</span><span className="text-xs text-muted-foreground">{formatDateTime(file.createdAt)}</span><DownloadButton file={file} compact /></div>)}</div> : <div className="px-4 py-10 text-center text-sm text-muted-foreground">暂无研究包归档。</div>}
      </CardContent>
    </Card>
  );
}

function DownloadButton({ file, compact = false }: { file: ResearchExportFile; compact?: boolean }) {
  const Icon = file.format === "markdown" ? FileText : FileJson;
  return <Button asChild size={compact ? "icon" : "sm"} variant="outline"><a href={file.downloadUrl} download title={`下载 ${file.name}`}><Icon className="h-4 w-4" />{compact ? null : file.format === "markdown" ? "Markdown" : "JSON"}<Download className={cn("h-3.5 w-3.5", compact ? "hidden" : "")} /></a></Button>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">{label}</span>{children}</label>;
}

function mergeFiles(next: ResearchExportFile[], current: ResearchExportFile[]) {
  const byName = new Map([...next, ...current].map((file) => [file.name, file]));
  return [...byName.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12);
}

function formatFileSize(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
