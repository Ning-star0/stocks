import type { Candidate } from "@/lib/focus/decisionTypes";
import type { QuantSignal } from "@/lib/quant/strategy";

export function candidateSupportsBuy(candidate: Candidate) {
  if (!candidate.price || candidate.price <= 0) return false;
  if (!quantAllowsBuy(candidate)) return false;
  if (tradeFeedbackBlocksBuy(candidate)) return false;
  if (candidate.strategyHealth?.entryPermission === "pause") return false;
  if (candidate.latestAnalysis?.trend === "bearish") return false;
  if ((candidate.latestAnalysis?.confidence ?? 0) < 0.55) return false;

  const advice = candidate.isHolding ? candidate.latestAnalysis?.holdAdvice : candidate.latestAnalysis?.entryAdvice;
  const text = stringifyAdvice(advice);
  if (/减仓|止损|离场|回避|不建议/.test(text)) return false;
  if (candidate.isHolding) return /加仓|增持|逢低|提高仓位/.test(text);
  return /买入|建仓|入场|轻仓|试探|逢低|条件触发|分批观察/.test(text) && !/仅观察|继续观察|观望/.test(text);
}

export function candidateSupportsSell(candidate: Candidate) {
  if (!candidate.isHolding || !candidate.price || candidate.price <= 0 || !candidate.holdingShares || candidate.holdingShares <= 0) return false;
  if (!candidateHasFreshQuote(candidate)) return false;
  if (quantAllowsSell(candidate)) return true;
  const text = stringifyAdvice(candidate.latestAnalysis?.holdAdvice);
  const hardExit = /止损|离场|清仓|全部卖出|跌破止损|破位|重大利空/.test(text);
  if (candidate.quantSignal?.newPositionProtection && !hardExit) return false;
  return /减仓|止损|离场|回避|风险规避|止盈|分批兑现|降低仓位/.test(text);
}

export function quantView(candidate: Candidate) {
  const action = candidate.quantSignal?.action;
  if (action === "buy" || action === "add") return "优先";
  if (action === "sell" || action === "reduce") return "减仓/卖出";
  if (action === "avoid") return "回避";
  if (action === "hold") return "持有观察";
  return "观察";
}

export function quantReason(candidate: Candidate) {
  const signal = candidate.quantSignal;
  if (!signal) return candidate.latestAnalysis?.summary ?? "暂无量化信号。";
  const scores = `量化信号：${actionLabel(signal.action)}，买入分 ${signal.buyScore}/${signal.adjustedBuyThreshold}，卖出分 ${signal.sellScore}/${signal.adjustedReduceThreshold}，趋势分 ${signal.trendScore}，动量分 ${signal.momentumScore}，风险分 ${signal.riskScore}。`;
  const sizing = `仓位建议：买入资金 ${signal.suggestedBuyCapitalPct}%；卖出比例 ${signal.suggestedSellRatioPct}%${signal.suggestedSellShares ? `，约 ${signal.suggestedSellShares} 股/份` : ""}。`;
  const metrics = `风险收益比 ${signal.riskRewardRatio ?? "--"}，止损距离 ${formatPct(signal.stopDistancePct)}，止盈距离 ${formatPct(signal.takeProfitDistancePct)}。`;
  const context = `环境：${signal.marketRegime} / ${signal.sectorBias}${signal.newPositionProtection ? "，新仓保护中" : ""}。`;
  const entryPlan = signal.entryPlan ? `入场计划：${signal.entryPlan}` : "";
  const constraints = signal.tradeConstraints?.length ? `交易约束：${signal.tradeConstraints.slice(0, 2).join("；")}` : "";
  const feedback = candidate.tradeFeedback?.notes?.length ? `交易反馈：${candidate.tradeFeedback.notes.slice(0, 2).join("；")}。` : "";
  const strategyHealth = candidate.strategyHealth ? `样本外策略健康：${candidate.strategyHealth.strategyHealth}，新开仓权限 ${candidate.strategyHealth.entryPermission}；${candidate.strategyHealth.reason}` : "";
  const reason = signal.reasons.slice(0, 2).join("；");
  const risk = signal.risks[0] ? `主要风险：${signal.risks[0]}` : "";
  return [scores, sizing, metrics, context, entryPlan, constraints, feedback, strategyHealth, reason, risk, signal.exitPlan].filter(Boolean).join(" ");
}

export function quantAllowsBuy(candidate?: Candidate | null) {
  if (!candidateHasFreshQuote(candidate)) return false;
  if (!candidate?.quantSignal) return false;
  const signal = candidate.quantSignal;
  return (
    (signal.action === "buy" || signal.action === "add") &&
    signal.buyScore >= signal.adjustedBuyThreshold &&
    signal.sellScore < signal.adjustedReduceThreshold &&
    signal.riskScore < 68 &&
    (signal.riskRewardRatio === null || signal.riskRewardRatio >= 1.25) &&
    (signal.volumeRatio === null || signal.volumeRatio >= 0.75)
  );
}

export function quantAllowsSell(candidate?: Candidate | null) {
  if (!candidateHasFreshQuote(candidate)) return false;
  if (!candidate?.quantSignal) return false;
  const signal = candidate.quantSignal;
  if (signal.newPositionProtection && signal.action !== "sell" && signal.sellScore < signal.adjustedSellThreshold) return false;
  return (
    signal.action === "sell" ||
    signal.action === "reduce" ||
    signal.sellScore >= signal.adjustedReduceThreshold ||
    (signal.suggestedSellRatioPct ?? 0) > 0 ||
    (signal.suggestedSellShares ?? 0) >= 100
  );
}

export function candidateHasFreshQuote(candidate?: Candidate | null) {
  if (!candidate?.price || candidate.price <= 0) return false;
  if (["stale", "unavailable", "error", "failed"].includes(candidate.status)) return false;
  if (!candidate.quoteTime) return false;
  return true;
}

export function stringifyAdvice(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (isRecord(value)) return Object.values(value).filter((item) => typeof item === "string").join(" ");
  return "";
}

function tradeFeedbackBlocksBuy(candidate: Candidate) {
  const feedback = candidate.tradeFeedback;
  const signal = candidate.quantSignal;
  if (!feedback || !signal) return false;
  const strongOverride =
    signal.buyScore >= signal.adjustedBuyThreshold + 10 &&
    signal.riskScore < 55 &&
    (signal.riskRewardRatio === null || signal.riskRewardRatio >= 1.8);
  if (strongOverride) return false;
  if (isFuture(feedback.buyBlockedUntil)) return true;
  if (candidate.isHolding && isFuture(feedback.addBlockedUntil)) return true;
  return false;
}

function isFuture(value?: string | null) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time > Date.now();
}

function formatPct(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "--";
}

function actionLabel(action: QuantSignal["action"]) {
  const map: Record<QuantSignal["action"], string> = {
    buy: "买入观察",
    add: "增持观察",
    hold: "持有观察",
    watch: "继续观察",
    reduce: "减仓观察",
    sell: "卖出观察",
    avoid: "回避"
  };
  return map[action];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
