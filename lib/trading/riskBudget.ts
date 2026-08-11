import type { QuantStrategyContext } from "@/lib/quant/strategy";
import type { TradePerformanceSummary } from "@/lib/trades/performance";
import { calculateTradeEconomics, type TradeEconomics } from "@/lib/trading/economics";
import { calculateTradingFee, roundMoney, TRADE_LOT_SIZE } from "@/lib/trading/rules";

export type PositionRiskInput = {
  symbol: string;
  shares: number | null;
  currentPrice: number | null;
  holdingPrice?: number | null;
  stopLossPrice?: number | null;
  riskLevel?: string | null;
};

export type PositionRisk = {
  symbol: string;
  marketValue: number;
  riskAmount: number;
  riskPctOfEquity: number;
  stopLossPrice: number | null;
  stopCoverage: "configured" | "missing" | "breached";
};

export type PortfolioRiskBudget = {
  equityBase: number;
  singleTradeRiskLimitPct: number;
  singleTradeRiskLimitAmount: number;
  portfolioRiskLimitPct: number;
  portfolioRiskLimitAmount: number;
  openRiskAmount: number;
  openRiskPct: number;
  availableRiskAmount: number;
  riskUtilizationPct: number;
  performanceMultiplier: number;
  marketMultiplier: number;
  status: "normal" | "tight" | "blocked" | "breached_stop";
  reason: string;
  protectedPositionCount: number;
  positionCount: number;
  stopCoveragePct: number | null;
  missingStopSymbols: string[];
  breachedStopSymbols: string[];
  positions: PositionRisk[];
};

export function buildPortfolioRiskBudget(input: {
  capital: number;
  totalAssets: number;
  positions: PositionRiskInput[];
  marketRegime?: QuantStrategyContext["marketRegime"] | null;
  tradePerformance?: TradePerformanceSummary | null;
}): PortfolioRiskBudget {
  const equityBase = roundMoney(positive(input.totalAssets) ?? positive(input.capital) ?? 0);
  const smallAccount = equityBase > 0 && equityBase <= 5_000;
  const performanceMultiplier = performanceRiskMultiplier(input.tradePerformance);
  const marketMultiplier = input.marketRegime === "risk_off" ? 0.67 : 1;
  const singleTradeRiskLimitPct = roundRatio((smallAccount ? 1.5 : 1) * performanceMultiplier * marketMultiplier);
  const portfolioRiskLimitPct = roundRatio((smallAccount ? 5 : 4) * performanceMultiplier * (input.marketRegime === "risk_off" ? 0.75 : 1));
  const singleTradeRiskLimitAmount = roundMoney(equityBase * singleTradeRiskLimitPct / 100);
  const portfolioRiskLimitAmount = roundMoney(equityBase * portfolioRiskLimitPct / 100);
  const positions = input.positions
    .map((position) => calculatePositionRisk(position, equityBase))
    .filter((position): position is PositionRisk => Boolean(position));
  const openRiskAmount = roundMoney(positions.reduce((sum, position) => sum + position.riskAmount, 0));
  const openRiskPct = equityBase > 0 ? roundRatio(openRiskAmount / equityBase * 100) : 0;
  const availableRiskAmount = roundMoney(Math.max(0, portfolioRiskLimitAmount - openRiskAmount));
  const riskUtilizationPct = portfolioRiskLimitAmount > 0 ? roundRatio(openRiskAmount / portfolioRiskLimitAmount * 100) : 0;
  const missingStopSymbols = positions.filter((position) => position.stopCoverage === "missing").map((position) => position.symbol);
  const breachedStopSymbols = positions.filter((position) => position.stopCoverage === "breached").map((position) => position.symbol);
  const protectedPositionCount = positions.filter((position) => position.stopCoverage === "configured").length;
  const stopCoveragePct = positions.length ? roundRatio(protectedPositionCount / positions.length * 100) : null;
  const status = breachedStopSymbols.length
    ? "breached_stop" as const
    : availableRiskAmount <= 0
      ? "blocked" as const
      : riskUtilizationPct >= 75 || missingStopSymbols.length || performanceMultiplier < 1 || marketMultiplier < 1
        ? "tight" as const
        : "normal" as const;

  return {
    equityBase,
    singleTradeRiskLimitPct,
    singleTradeRiskLimitAmount,
    portfolioRiskLimitPct,
    portfolioRiskLimitAmount,
    openRiskAmount,
    openRiskPct,
    availableRiskAmount,
    riskUtilizationPct,
    performanceMultiplier,
    marketMultiplier,
    status,
    reason: riskBudgetReason({ status, missingStopSymbols, breachedStopSymbols, performanceMultiplier, marketMultiplier }),
    protectedPositionCount,
    positionCount: positions.length,
    stopCoveragePct,
    missingStopSymbols,
    breachedStopSymbols,
    positions
  };
}

export function fitTradeToRiskBudget(input: {
  requestedShares: number;
  entryPrice: number;
  stopLossPrice: number | null;
  takeProfitPrice?: number | null;
  maxRiskAmount: number;
}): { shares: number; economics: TradeEconomics | null; reason: string | null } {
  const entryPrice = positive(input.entryPrice);
  const stopLossPrice = positive(input.stopLossPrice);
  if (!entryPrice) return { shares: 0, economics: null, reason: "交易价格无效，无法按风险预算计算股数。" };
  if (!stopLossPrice || stopLossPrice >= entryPrice) {
    return { shares: 0, economics: null, reason: "没有低于触发价的有效止损，不能计算单笔最大风险。" };
  }
  if (!positive(input.maxRiskAmount)) return { shares: 0, economics: null, reason: "组合剩余风险额度不足，暂不增加新仓位。" };

  let shares = Math.floor(Math.max(0, input.requestedShares) / TRADE_LOT_SIZE) * TRADE_LOT_SIZE;
  while (shares >= TRADE_LOT_SIZE) {
    const economics = calculateTradeEconomics({
      entryPrice,
      shares,
      stopLossPrice,
      takeProfitPrice: input.takeProfitPrice
    });
    if (economics?.netRiskAmount !== null && economics?.netRiskAmount !== undefined && economics.netRiskAmount <= input.maxRiskAmount) {
      return { shares, economics, reason: null };
    }
    shares -= TRADE_LOT_SIZE;
  }
  return {
    shares: 0,
    economics: null,
    reason: `按止损和双边手续费测算，最小 ${TRADE_LOT_SIZE} 股/份仍超过单笔或组合剩余风险额度。`
  };
}

function calculatePositionRisk(input: PositionRiskInput, equityBase: number): PositionRisk | null {
  const shares = positive(input.shares);
  const price = positive(input.currentPrice) ?? positive(input.holdingPrice);
  if (!shares || !price) return null;
  const marketValue = roundMoney(price * shares);
  const exitFee = calculateTradingFee(marketValue);
  const stopLossPrice = positive(input.stopLossPrice);
  const fallbackDistancePct = input.riskLevel === "low" ? 4 : input.riskLevel === "high" ? 6 : 5;
  const stopCoverage = !stopLossPrice ? "missing" as const : stopLossPrice >= price ? "breached" as const : "configured" as const;
  const priceRisk = !stopLossPrice
    ? marketValue * fallbackDistancePct / 100
    : stopLossPrice >= price
      ? marketValue * 0.015
      : (price - stopLossPrice) * shares;
  const riskAmount = roundMoney(priceRisk + exitFee);
  return {
    symbol: input.symbol,
    marketValue,
    riskAmount,
    riskPctOfEquity: equityBase > 0 ? roundRatio(riskAmount / equityBase * 100) : 0,
    stopLossPrice: stopLossPrice ?? null,
    stopCoverage
  };
}

function performanceRiskMultiplier(performance?: TradePerformanceSummary | null) {
  if (!performance || performance.closedTrades < 5) return 1;
  if (
    performance.currentLossStreak >= 3 ||
    (performance.profitFactor !== null && performance.profitFactor < 0.8) ||
    (performance.maxDrawdownPct !== null && performance.maxDrawdownPct >= 8)
  ) return 0.5;
  if (
    performance.currentLossStreak >= 2 ||
    (performance.profitFactor !== null && performance.profitFactor < 1) ||
    (performance.expectancy !== null && performance.expectancy < 0) ||
    (performance.maxDrawdownPct !== null && performance.maxDrawdownPct >= 5)
  ) return 0.67;
  return 1;
}

function riskBudgetReason(input: {
  status: PortfolioRiskBudget["status"];
  missingStopSymbols: string[];
  breachedStopSymbols: string[];
  performanceMultiplier: number;
  marketMultiplier: number;
}) {
  if (input.breachedStopSymbols.length) return `已有持仓 ${input.breachedStopSymbols.join("、")} 触及或跌破止损，新买入前应先处理风险。`;
  if (input.status === "blocked") return "现有持仓风险已占满组合额度，暂不增加新仓位。";
  if (input.missingStopSymbols.length) return `持仓 ${input.missingStopSymbols.join("、")} 未配置有效止损，系统已按保守跌幅估算风险。`;
  if (input.performanceMultiplier < 1 && input.marketMultiplier < 1) return "历史绩效和当前市场环境同时偏弱，风险额度已收缩。";
  if (input.performanceMultiplier < 1) return "历史交易绩效触发风险收缩，单笔与组合额度已降低。";
  if (input.marketMultiplier < 1) return "当前市场处于防守状态，新单风险额度已降低。";
  if (input.status === "tight") return "组合风险额度接近上限，新单只允许更小仓位。";
  return "风险额度充足，仍需满足趋势、净收益和止损条件。";
}

function positive(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function roundRatio(value: number) {
  return Number(value.toFixed(2));
}
