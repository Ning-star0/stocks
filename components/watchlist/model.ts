import { trendToStrategy } from "@/components/StrategyBadge";
import { getPrimaryAdvice, hasUserPosition } from "@/lib/positionAdvice";
import type { AiAnalysisResult } from "@/lib/types";
import type {
  ActionCategory,
  DashboardResponse,
  MarketIndexItem,
  RiskBucket,
  SortKey,
  WatchlistItem,
  WatchlistRowModel
} from "@/components/watchlist/types";

export const WATCHLIST_PAGE_SIZE = 6;

export function buildWatchlistRows(items: WatchlistItem[], data: DashboardResponse | null): WatchlistRowModel[] {
  return items.map((item, index) => {
    const quote = data?.quotes[item.symbol];
    const latest = data?.latestAnalyses[item.symbol] ?? null;
    const analysis = latest?.outputJson;
    const primaryAdvice = getPrimaryAdvice(analysis, item);
    const isHolding = hasUserPosition(item);
    const strategy = trendToStrategy(analysis?.trend);
    const action = normalizeAction(analysis?.decisionStatus, primaryAdvice.action, primaryAdvice.isHolding);
    const hasAnalysis = Boolean(analysis);
    const actionCategory = classifyAction(analysis?.decisionStatus, action, hasAnalysis);
    const riskBucket = classifyRisk(item, analysis, actionCategory);
    const tags = reasonTags(analysis, primaryAdvice.reason);
    const isFocus = riskBucket === "high" || actionCategory === "entry" || actionCategory === "wait" || actionCategory === "avoid" || actionCategory === "insufficient" || analysis?.trend === "bearish";
    const isWatch = actionCategory === "watch" && riskBucket !== "high";
    const name = quote?.name ?? item.symbol;
    return {
      item,
      quote,
      latest,
      name,
      symbol: item.symbol,
      strategy,
      action,
      actionCategory,
      riskBucket,
      isHolding,
      hasAnalysis,
      tags,
      isFocus,
      isWatch,
      searchText: `${name} ${item.symbol}`.toLowerCase(),
      index
    };
  });
}

export function filterAndSortRows(
  rows: WatchlistRowModel[],
  filters: {
    search: string;
    riskFilter: "all" | RiskBucket;
    actionFilter: "all" | ActionCategory;
    holdingFilter: "all" | "holding" | "watching";
    sortKey: SortKey;
  }
) {
  const keyword = filters.search.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (keyword && !row.searchText.includes(keyword)) return false;
    if (filters.riskFilter !== "all" && row.riskBucket !== filters.riskFilter) return false;
    if (filters.actionFilter !== "all" && row.actionCategory !== filters.actionFilter) return false;
    if (filters.holdingFilter === "holding" && !row.isHolding) return false;
    if (filters.holdingFilter === "watching" && row.isHolding) return false;
    return true;
  });

  return [...filtered].sort((a, b) => {
    if (filters.sortKey === "changeDesc") return sortableChange(b) - sortableChange(a);
    if (filters.sortKey === "changeAsc") return sortableChange(a) - sortableChange(b);
    if (filters.sortKey === "riskFirst") return riskRank(a.riskBucket) - riskRank(b.riskBucket) || a.index - b.index;
    if (filters.sortKey === "focusFirst") return Number(b.isFocus) - Number(a.isFocus) || a.index - b.index;
    return a.index - b.index;
  });
}

export function riskLabel(risk: RiskBucket) {
  return { high: "高风险", medium: "中风险", low: "低风险" }[risk];
}

export function changeClass(changePct?: number | null) {
  if (changePct === null || changePct === undefined) return "text-muted-foreground";
  return changePct >= 0 ? "text-red-500" : "text-emerald-500";
}

export function defaultMarketIndices(): MarketIndexItem[] {
  return [
    { symbol: "000001.SH", name: "上证指数", quote: null },
    { symbol: "399001.SZ", name: "深证成指", quote: null },
    { symbol: "000688.SH", name: "科创50", quote: null }
  ];
}

export function formatQuoteStatus(status?: string) {
  const map: Record<string, string> = {
    normal: "实时",
    cached: "缓存",
    stale: "旧行情",
    unavailable: "不可用",
    error: "行情错误"
  };
  return status ? map[status] ?? status : "不可用";
}

function normalizeAction(
  decisionStatus?: AiAnalysisResult["decisionStatus"],
  action?: string,
  isHolding?: boolean
): { label: string; tone: "watch" | "wait" | "avoid" | "bullish" | "neutral" } {
  if (decisionStatus === "insufficient_data") return { label: "数据不足", tone: "wait" };
  if (decisionStatus === "rejected") return { label: "暂不考虑", tone: "avoid" };
  if (decisionStatus === "research_candidate") return { label: "继续研究", tone: "neutral" };
  if (decisionStatus === "setup_wait") return { label: "等待条件", tone: "wait" };
  if (decisionStatus === "conditional_entry") return { label: "条件已满足", tone: "bullish" };
  if (decisionStatus === "manage_position") return { label: "持仓管理", tone: "watch" };
  if (decisionStatus === "exit_risk") return { label: "退出风险", tone: "avoid" };
  const text = action || "";
  if (/回避|止损|减仓|离场|不建议/.test(text)) return { label: "风险规避", tone: "avoid" };
  if (/等待|回调|观察|观望/.test(text)) return { label: "等待回调", tone: "wait" };
  if (/加仓|增持|持有/.test(text)) return { label: isHolding ? "持仓跟踪" : "谨慎追踪", tone: "watch" };
  if (/入场|建仓|买入|试探/.test(text)) return { label: "谨慎追踪", tone: "bullish" };
  return { label: isHolding ? "持仓跟踪" : "继续观察", tone: "neutral" };
}

function classifyAction(
  decisionStatus: AiAnalysisResult["decisionStatus"] | undefined,
  action: ReturnType<typeof normalizeAction>,
  hasAnalysis: boolean
): ActionCategory {
  if (!hasAnalysis) return "none";
  if (decisionStatus === "conditional_entry") return "entry";
  if (decisionStatus === "insufficient_data") return "insufficient";
  if (decisionStatus === "rejected" || decisionStatus === "exit_risk") return "avoid";
  if (decisionStatus === "setup_wait") return "wait";
  if (decisionStatus === "research_candidate" || decisionStatus === "manage_position") return "watch";
  if (action.tone === "avoid") return "avoid";
  if (action.tone === "wait") return "wait";
  return "watch";
}

function classifyRisk(item: WatchlistItem, analysis: AiAnalysisResult | undefined, actionCategory: ActionCategory): RiskBucket {
  const text = `${item.riskLevel} ${(analysis?.riskFactors ?? []).join(" ")} ${analysis?.summary ?? ""}`.toLowerCase();
  if (analysis?.trend === "bearish" || actionCategory === "avoid" || /high|高风险|风险较高|偏高/.test(text)) return "high";
  if (/low|低风险|风险较低/.test(text)) return "low";
  return "medium";
}

function reasonTags(analysis?: AiAnalysisResult | null, fallback?: string) {
  const text = `${analysis?.summary ?? ""} ${(analysis?.riskFactors ?? []).join(" ")} ${fallback ?? ""}`;
  const rules: Array<[RegExp, string]> = [
    [/RSI|超买|超卖/i, "RSI 信号"],
    [/MACD|金叉|死叉/i, "MACD 变化"],
    [/成交量|放量|缩量|量能/i, "量能变化"],
    [/回调|支撑|压力/i, "等待价位"],
    [/政策|海外|宏观/i, "宏观风险"],
    [/趋势|均线|布林/i, "趋势观察"]
  ];
  const tags = rules.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
  return [...new Set(tags)];
}

function riskRank(risk: RiskBucket) {
  return { high: 0, medium: 1, low: 2 }[risk];
}

function sortableChange(row: WatchlistRowModel) {
  return row.quote?.changePct ?? Number.NEGATIVE_INFINITY;
}
