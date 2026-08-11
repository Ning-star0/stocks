import { calculateIndicators, summarizeHistory } from "@/lib/indicators";
import { buildQuantSignal } from "@/lib/quant/strategy";
import { calculateTradeEconomics, tradeEconomicsBlockReason } from "@/lib/trading/economics";
import { calculateTradingFee, roundMoney, TRADE_LOT_SIZE } from "@/lib/trading/rules";
import type { Candle } from "@/lib/types";

export type BacktestPresetId = "current" | "balanced" | "strict";

export type BacktestPreset = {
  id: BacktestPresetId;
  name: string;
  description: string;
  buyScore: number;
  maxRiskScore: number;
  minRiskReward: number;
};

export type BacktestTrade = {
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  shares: number;
  entryFee: number;
  exitFee: number;
  grossPnl: number;
  netPnl: number;
  returnPct: number;
  holdingDays: number;
  exitReason: "stop_loss" | "take_profit" | "signal_reduce" | "signal_sell" | "end_of_test";
};

export type BacktestEquityPoint = {
  date: string;
  equity: number;
  drawdownPct: number;
};

export type StrategyBacktestResult = {
  symbol: string;
  preset: BacktestPreset;
  startDate: string | null;
  endDate: string | null;
  initialCapital: number;
  finalEquity: number;
  netPnl: number;
  netReturnPct: number;
  benchmarkReturnPct: number | null;
  excessReturnPct: number | null;
  maxDrawdownPct: number;
  closedTrades: number;
  winRatePct: number | null;
  profitFactor: number | null;
  payoffRatio: number | null;
  expectancy: number | null;
  totalFees: number;
  feeDragPct: number;
  exposurePct: number;
  averageHoldingDays: number | null;
  blockedEntries: number;
  score: number;
  warnings: string[];
  trades: BacktestTrade[];
  equityCurve: BacktestEquityPoint[];
};

export type RollingGateBacktest = {
  initialCapital: number;
  ungatedFinalEquity: number;
  gatedFinalEquity: number;
  ungatedReturnPct: number;
  gatedReturnPct: number;
  returnImprovementPct: number;
  gatedMaxDrawdownPct: number;
  ungatedTotalFees: number;
  gatedTotalFees: number;
  folds: Array<{
    trainingEndDate: string;
    validationStartDate: string;
    validationEndDate: string;
    selectedPreset: BacktestPresetId;
    appliedPermission: "allow" | "reduce_size" | "pause";
    ungatedReturnPct: number;
    gatedReturnPct: number;
    shadowReturnPct: number;
    healthAfterFold: StrategyBacktestComparison["strategyHealth"];
    permissionAfterFold: StrategyBacktestComparison["entryPermission"];
    gatedClosedTrades: number;
  }>;
};

export type StrategyBacktestComparison = {
  symbol: string;
  generatedAt: string;
  range: string;
  candleCount: number;
  initialCapital: number;
  recommendedPreset: BacktestPresetId;
  recommendationNote: string;
  strategyHealth: "healthy" | "watch" | "pause" | "insufficient";
  entryPermission: "allow" | "reduce_size" | "pause";
  healthReason: string;
  results: StrategyBacktestResult[];
  walkForward: {
    trainingEndDate: string;
    validationStartDate: string;
    selectedPreset: BacktestPresetId;
    trainingResults: StrategyBacktestResult[];
    validationResults: StrategyBacktestResult[];
    selectedValidation: StrategyBacktestResult;
  } | null;
  rollingGate: RollingGateBacktest | null;
};

export type StrategyBacktestPortfolioSummary = {
  symbolCount: number;
  recommendedPreset: BacktestPresetId;
  recommendedPresetName: string;
  trainingAverageReturnPct: number;
  validationAverageReturnPct: number;
  validationAverageMaxDrawdownPct: number;
  validationProfitableSymbols: number;
  validationClosedTrades: number;
  validationTotalFees: number;
  status: "validated" | "weak" | "insufficient";
  entryPermission: "allow" | "reduce_size" | "pause";
  note: string;
  rollingGate: {
    symbolCount: number;
    ungatedAverageReturnPct: number;
    gatedAverageReturnPct: number;
    averageImprovementPct: number;
    improvedSymbols: number;
    status: "improved" | "neutral" | "worse";
  } | null;
  presets: Array<{
    preset: BacktestPreset;
    trainingAverageReturnPct: number;
    trainingAverageMaxDrawdownPct: number;
    trainingClosedTrades: number;
    trainingScore: number;
  }>;
};

export const BACKTEST_PRESETS: BacktestPreset[] = [
  {
    id: "current",
    name: "当前策略",
    description: "完整复现当前量化信号，并执行净风险收益和整手约束。",
    buyScore: 70,
    maxRiskScore: 100,
    minRiskReward: 1.25
  },
  {
    id: "balanced",
    name: "均衡过滤",
    description: "提高买入质量和风险收益要求，减少弱信号成交。",
    buyScore: 73,
    maxRiskScore: 60,
    minRiskReward: 1.45
  },
  {
    id: "strict",
    name: "严格过滤",
    description: "只保留高分、低风险和高赔率信号，成交频率最低。",
    buyScore: 77,
    maxRiskScore: 55,
    minRiskReward: 1.7
  }
];

type Position = {
  shares: number;
  entryPrice: number;
  entryFee: number;
  openedAt: string;
  openedIndex: number;
  stopLoss: number;
  takeProfit: number;
};

export function compareBacktestPresets(input: {
  symbol: string;
  candles: Candle[];
  initialCapital: number;
  range: string;
  includeRollingGate?: boolean;
}): StrategyBacktestComparison {
  const candles = normalizeCandles(input.candles);
  const results = BACKTEST_PRESETS.map((preset) => runStrategyBacktest({ ...input, candles, preset }));
  const splitIndex = resolveWalkForwardSplit(candles.length);
  const walkForward = splitIndex === null ? null : buildWalkForward({ ...input, candles, splitIndex });
  const recommended = walkForward?.selectedValidation ?? [...results].sort((left, right) => right.score - left.score)[0];
  const health = evaluateStrategyHealth(recommended);
  const rollingGate = input.includeRollingGate ? buildRollingGateBacktest({ ...input, candles }) : null;
  return {
    symbol: input.symbol.toUpperCase(),
    generatedAt: new Date().toISOString(),
    range: input.range,
    candleCount: candles.length,
    initialCapital: roundMoney(input.initialCapital),
    recommendedPreset: recommended?.preset.id ?? "current",
    recommendationNote: walkForward && recommended
      ? `${recommended.preset.name}由前段训练区间选出，后段样本外净收益 ${signedPercent(recommended.netReturnPct)}、最大回撤 ${recommended.maxDrawdownPct.toFixed(2)}%。`
      : "历史数据不足以划分训练与样本外验证区间，暂不应据此替换当前策略。",
    ...health,
    results,
    walkForward,
    rollingGate
  };
}

export function summarizeBacktestComparisons(comparisons: StrategyBacktestComparison[]): StrategyBacktestPortfolioSummary | null {
  const usable = comparisons.filter((comparison) => comparison.walkForward);
  if (!usable.length) return null;
  const presets = BACKTEST_PRESETS.map((preset) => {
    const results = usable.flatMap((comparison) => comparison.walkForward?.trainingResults.filter((result) => result.preset.id === preset.id) ?? []);
    return {
      preset,
      trainingAverageReturnPct: average(results.map((result) => result.netReturnPct)),
      trainingAverageMaxDrawdownPct: average(results.map((result) => result.maxDrawdownPct)),
      trainingClosedTrades: results.reduce((sum, result) => sum + result.closedTrades, 0),
      trainingScore: round(average(results.map((result) => result.score)))
    };
  });
  const selected = [...presets].sort((left, right) => right.trainingScore - left.trainingScore)[0] ?? presets[0];
  const validation = usable.flatMap((comparison) => comparison.walkForward?.validationResults.filter((result) => result.preset.id === selected.preset.id) ?? []);
  const validationAverageReturnPct = average(validation.map((result) => result.netReturnPct));
  const validationProfitableSymbols = validation.filter((result) => result.netReturnPct > 0).length;
  const validationClosedTrades = validation.reduce((sum, result) => sum + result.closedTrades, 0);
  const enoughSamples = validationClosedTrades >= Math.max(6, usable.length * 2);
  const status = !enoughSamples ? "insufficient" : validationAverageReturnPct > 0 && validationProfitableSymbols >= Math.ceil(usable.length * 0.6) ? "validated" : "weak";
  const rollingResults = comparisons.flatMap((comparison) => comparison.rollingGate ? [comparison.rollingGate] : []);
  const rollingGate = rollingResults.length ? {
    symbolCount: rollingResults.length,
    ungatedAverageReturnPct: average(rollingResults.map((result) => result.ungatedReturnPct)),
    gatedAverageReturnPct: average(rollingResults.map((result) => result.gatedReturnPct)),
    averageImprovementPct: average(rollingResults.map((result) => result.returnImprovementPct)),
    improvedSymbols: rollingResults.filter((result) => result.returnImprovementPct > 0).length,
    status: "neutral" as "improved" | "neutral" | "worse"
  } : null;
  if (rollingGate) {
    rollingGate.status = rollingGate.averageImprovementPct > 0.15 ? "improved" : rollingGate.averageImprovementPct < -0.15 ? "worse" : "neutral";
  }
  return {
    symbolCount: usable.length,
    recommendedPreset: selected.preset.id,
    recommendedPresetName: selected.preset.name,
    trainingAverageReturnPct: selected.trainingAverageReturnPct,
    validationAverageReturnPct,
    validationAverageMaxDrawdownPct: average(validation.map((result) => result.maxDrawdownPct)),
    validationProfitableSymbols,
    validationClosedTrades,
    validationTotalFees: roundMoney(validation.reduce((sum, result) => sum + result.totalFees, 0)),
    status,
    entryPermission: status === "validated" ? "allow" : status === "weak" ? "pause" : "reduce_size",
    note: status === "validated"
      ? `${selected.preset.name}仅由前段训练数据选出，并在 ${usable.length} 个标的的后段样本外区间保持正的平均净收益。`
      : status === "weak"
        ? `${selected.preset.name}在后段样本外区间未形成足够稳定的正收益，不建议据此自动替换线上策略。`
        : "后段样本外成交数量不足，继续积累数据后再判断策略稳定性。",
    rollingGate,
    presets
  };
}

export function runStrategyBacktest(input: {
  symbol: string;
  candles: Candle[];
  initialCapital: number;
  preset: BacktestPreset;
  evaluationStartIndex?: number;
  evaluationEndIndex?: number;
  positionScale?: number;
}): StrategyBacktestResult {
  const symbol = input.symbol.toUpperCase();
  const candles = normalizeCandles(input.candles);
  const initialCapital = Math.max(1000, roundMoney(input.initialCapital));
  const positionScale = Math.max(0, Math.min(1, input.positionScale ?? 1));
  const hasSufficientData = candles.length > 35;
  const startIndex = hasSufficientData ? Math.max(35, Math.min(candles.length - 1, input.evaluationStartIndex ?? 35)) : candles.length;
  const endIndex = hasSufficientData ? Math.max(startIndex, Math.min(candles.length - 1, input.evaluationEndIndex ?? candles.length - 1)) : candles.length - 1;
  let cash = initialCapital;
  let position: Position | null = null;
  let pendingEntry: { capitalPct: number; stopPct: number; targetPct: number } | null = null;
  let pendingExit: "signal_reduce" | "signal_sell" | null = null;
  let blockedEntries = 0;
  let exposedBars = 0;
  let peakEquity = initialCapital;
  let maxDrawdownPct = 0;
  const trades: BacktestTrade[] = [];
  const equityCurve: BacktestEquityPoint[] = [];

  for (let index = startIndex; index <= endIndex; index += 1) {
    const candle = candles[index];

    if (position && pendingExit) {
      const ratio = pendingExit === "signal_sell" ? 1 : 0.5;
      closePosition({ ratio, price: candle.open, index, reason: pendingExit });
      pendingExit = null;
    }

    if (!position && pendingEntry) {
      const budget = Math.min(cash, initialCapital * pendingEntry.capitalPct / 100);
      const shares = Math.floor(budget / candle.open / TRADE_LOT_SIZE) * TRADE_LOT_SIZE;
      const stopLoss = candle.open * (1 - pendingEntry.stopPct / 100);
      const takeProfit = candle.open * (1 + pendingEntry.targetPct / 100);
      const economics = calculateTradeEconomics({ entryPrice: candle.open, shares, stopLossPrice: stopLoss, takeProfitPrice: takeProfit });
      const economicsReason = tradeEconomicsBlockReason(economics);
      const presetBlocked = economics?.netRiskRewardRatio !== null && economics?.netRiskRewardRatio !== undefined
        ? economics.netRiskRewardRatio < input.preset.minRiskReward
        : true;
      if (shares >= TRADE_LOT_SIZE && economics && !economicsReason && !presetBlocked && economics.totalEntryCost <= cash) {
        cash = roundMoney(cash - economics.totalEntryCost);
        position = {
          shares,
          entryPrice: candle.open,
          entryFee: economics.entryFee,
          openedAt: candle.timestamp,
          openedIndex: index,
          stopLoss,
          takeProfit
        };
      } else {
        blockedEntries += 1;
      }
      pendingEntry = null;
    }

    if (position) {
      exposedBars += 1;
      const stopPrice = candle.open <= position.stopLoss ? candle.open : candle.low <= position.stopLoss ? position.stopLoss : null;
      const targetPrice = candle.open >= position.takeProfit ? candle.open : candle.high >= position.takeProfit ? position.takeProfit : null;
      if (stopPrice !== null) closePosition({ ratio: 1, price: stopPrice, index, reason: "stop_loss" });
      else if (targetPrice !== null) closePosition({ ratio: 1, price: targetPrice, index, reason: "take_profit" });
    }

    const history = candles.slice(0, index + 1);
    const indicators = calculateIndicators(symbol, history);
    const summary = summarizeHistory(history.slice(-60));
    const signal = buildQuantSignal({
      symbol,
      price: candle.close,
      changePct: index > 0 ? (candle.close / candles[index - 1].close - 1) * 100 : null,
      indicators,
      historySummary: summary,
      isHolding: Boolean(position),
      holdingPrice: position?.entryPrice ?? null,
      holdingShares: position?.shares ?? null,
      positionOpenedAt: position?.openedAt ?? null,
      stopLoss: position?.stopLoss ?? null,
      targetPrice: position?.takeProfit ?? null
    });

    if (!position && positionScale > 0 && index < endIndex && signal.action === "buy" && signal.buyScore >= input.preset.buyScore && signal.riskScore <= input.preset.maxRiskScore) {
      pendingEntry = {
        capitalPct: backtestEntryCapitalPct(signal.suggestedBuyCapitalPct, initialCapital) * positionScale,
        stopPct: positiveDistance(signal.stopDistancePct, 4),
        targetPct: positiveDistance(signal.takeProfitDistancePct, 6)
      };
    } else if (position && index < endIndex && (signal.action === "sell" || signal.action === "reduce")) {
      pendingExit = signal.action === "sell" ? "signal_sell" : "signal_reduce";
    }

    const equity = roundMoney(cash + (position ? position.shares * candle.close : 0));
    peakEquity = Math.max(peakEquity, equity);
    const drawdownPct = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
    maxDrawdownPct = Math.max(maxDrawdownPct, drawdownPct);
    equityCurve.push({ date: candle.timestamp, equity, drawdownPct: round(drawdownPct) });
  }

  if (position && candles.length) closePosition({ ratio: 1, price: candles[endIndex].close, index: endIndex, reason: "end_of_test" });

  const finalEquity = roundMoney(cash);
  if (equityCurve.length) {
    const last = equityCurve[equityCurve.length - 1];
    peakEquity = Math.max(peakEquity, finalEquity);
    last.equity = finalEquity;
    last.drawdownPct = round(peakEquity > 0 ? (peakEquity - finalEquity) / peakEquity * 100 : 0);
    maxDrawdownPct = Math.max(maxDrawdownPct, last.drawdownPct);
  }
  const netPnl = roundMoney(finalEquity - initialCapital);
  const netReturnPct = round(netPnl / initialCapital * 100);
  const wins = trades.filter((trade) => trade.netPnl > 0);
  const losses = trades.filter((trade) => trade.netPnl < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.netPnl, 0));
  const totalFees = roundMoney(trades.reduce((sum, trade) => sum + trade.entryFee + trade.exitFee, 0));
  const benchmarkEntryIndex = Math.min(endIndex, startIndex + 1);
  const benchmarkReturnPct = endIndex > startIndex ? round((candles[endIndex].close / candles[benchmarkEntryIndex].open - 1) * 100) : null;
  const segmentCandleCount = Math.max(0, endIndex - startIndex + 1);
  const warnings = buildWarnings({ candleCount: segmentCandleCount, trades, blockedEntries });
  const score = round(netReturnPct - maxDrawdownPct * 0.65 + Math.min(3, trades.length) * 0.4);

  return {
    symbol,
    preset: input.preset,
    startDate: candles[startIndex]?.timestamp ?? null,
    endDate: candles[endIndex]?.timestamp ?? null,
    initialCapital,
    finalEquity,
    netPnl,
    netReturnPct,
    benchmarkReturnPct,
    excessReturnPct: benchmarkReturnPct === null ? null : round(netReturnPct - benchmarkReturnPct),
    maxDrawdownPct: round(maxDrawdownPct),
    closedTrades: trades.length,
    winRatePct: trades.length ? round(wins.length / trades.length * 100) : null,
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : grossProfit > 0 ? null : 0,
    payoffRatio: wins.length && losses.length ? round((grossProfit / wins.length) / (grossLoss / losses.length)) : null,
    expectancy: trades.length ? roundMoney(netPnl / trades.length) : null,
    totalFees,
    feeDragPct: initialCapital > 0 ? round(totalFees / initialCapital * 100) : 0,
    exposurePct: segmentCandleCount > 0 ? round(exposedBars / segmentCandleCount * 100) : 0,
    averageHoldingDays: trades.length ? round(trades.reduce((sum, trade) => sum + trade.holdingDays, 0) / trades.length) : null,
    blockedEntries,
    score,
    warnings,
    trades,
    equityCurve
  };

  function closePosition(inputClose: { ratio: number; price: number; index: number; reason: BacktestTrade["exitReason"] }) {
    if (!position) return;
    let shares = Math.floor(position.shares * inputClose.ratio / TRADE_LOT_SIZE) * TRADE_LOT_SIZE;
    if (inputClose.ratio >= 1 || position.shares - shares < TRADE_LOT_SIZE) shares = position.shares;
    if (shares < TRADE_LOT_SIZE) return;
    const entryFee = roundMoney(position.entryFee * shares / position.shares);
    const exitAmount = roundMoney(inputClose.price * shares);
    const exitFee = calculateTradingFee(exitAmount);
    const grossPnl = roundMoney((inputClose.price - position.entryPrice) * shares);
    const netPnl = roundMoney(grossPnl - entryFee - exitFee);
    cash = roundMoney(cash + exitAmount - exitFee);
    trades.push({
      entryDate: position.openedAt,
      exitDate: candles[inputClose.index].timestamp,
      entryPrice: round(position.entryPrice, 4),
      exitPrice: round(inputClose.price, 4),
      shares,
      entryFee,
      exitFee,
      grossPnl,
      netPnl,
      returnPct: round(netPnl / (position.entryPrice * shares + entryFee) * 100),
      holdingDays: Math.max(1, inputClose.index - position.openedIndex),
      exitReason: inputClose.reason
    });
    if (shares === position.shares) position = null;
    else position = { ...position, shares: position.shares - shares, entryFee: roundMoney(position.entryFee - entryFee) };
  }
}

function normalizeCandles(candles: Candle[]) {
  return candles
    .filter((candle) => [candle.open, candle.high, candle.low, candle.close].every((value) => Number.isFinite(value) && value > 0))
    .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
}

function positiveDistance(value: number | null, fallback: number) {
  return value !== null && Number.isFinite(value) && value > 0 ? Math.min(20, value) : fallback;
}

function backtestEntryCapitalPct(suggestedPct: number, capital: number) {
  if (capital > 5000) return suggestedPct;
  const feeEfficientAmount = Math.min(5000, Math.max(500, capital * 0.2));
  const feeEfficientPct = capital > 0 ? feeEfficientAmount / capital * 100 : 0;
  return Math.min(40, Math.max(suggestedPct, 28, feeEfficientPct));
}

function buildWarnings(input: { candleCount: number; trades: BacktestTrade[]; blockedEntries: number }) {
  const warnings = ["信号在收盘后生成，并按下一交易日开盘价执行；未使用未来 K 线。", "结果已计入双边手续费、最低 5 元和 100 股整手限制。"];
  if (input.candleCount < 120) warnings.push("评估区间少于 120 根 K 线，结果稳定性较低。");
  if (input.trades.length < 3) warnings.push("平仓样本少于 3 笔，不能据此判断策略有效性。");
  if (input.blockedEntries > 0) warnings.push(`${input.blockedEntries} 次信号因资金、整手、手续费或净风险收益约束未成交。`);
  return warnings;
}

function buildWalkForward(input: {
  symbol: string;
  candles: Candle[];
  initialCapital: number;
  range: string;
  splitIndex: number;
}) {
  const trainingResults = BACKTEST_PRESETS.map((preset) => runStrategyBacktest({
    ...input,
    preset,
    evaluationStartIndex: 35,
    evaluationEndIndex: input.splitIndex - 1
  }));
  const eligible = trainingResults.filter((result) => result.closedTrades >= 3);
  const selected = [...(eligible.length ? eligible : trainingResults)].sort((left, right) => right.score - left.score)[0] ?? trainingResults[0];
  const validationResults = BACKTEST_PRESETS.map((preset) => runStrategyBacktest({
    ...input,
    preset,
    evaluationStartIndex: input.splitIndex,
    evaluationEndIndex: input.candles.length - 1
  }));
  const selectedValidation = validationResults.find((result) => result.preset.id === selected.preset.id) ?? validationResults[0];
  return {
    trainingEndDate: input.candles[input.splitIndex - 1].timestamp,
    validationStartDate: input.candles[input.splitIndex].timestamp,
    selectedPreset: selected.preset.id,
    trainingResults,
    validationResults,
    selectedValidation
  };
}

function buildRollingGateBacktest(input: {
  symbol: string;
  candles: Candle[];
  initialCapital: number;
  range: string;
}) : RollingGateBacktest | null {
  const firstValidationIndex = 220;
  const foldBars = 60;
  if (input.candles.length < firstValidationIndex + 40) return null;

  const initialCapital = Math.max(1000, roundMoney(input.initialCapital));
  let ungatedEquity = initialCapital;
  let gatedEquity = initialCapital;
  let gatedPeak = initialCapital;
  let gatedMaxDrawdownPct = 0;
  let ungatedTotalFees = 0;
  let gatedTotalFees = 0;
  let appliedPermission: StrategyBacktestComparison["entryPermission"] = "allow";
  const folds: RollingGateBacktest["folds"] = [];

  for (let validationStart = firstValidationIndex; validationStart < input.candles.length; validationStart += foldBars) {
    const validationEnd = Math.min(input.candles.length - 1, validationStart + foldBars - 1);
    const trainingResults = BACKTEST_PRESETS.map((preset) => runStrategyBacktest({
      ...input,
      initialCapital: gatedEquity,
      preset,
      evaluationStartIndex: 35,
      evaluationEndIndex: validationStart - 1
    }));
    const eligible = trainingResults.filter((result) => result.closedTrades >= 3);
    const selected = [...(eligible.length ? eligible : trainingResults)].sort((left, right) => right.score - left.score)[0] ?? trainingResults[0];
    const ungated = runStrategyBacktest({
      ...input,
      initialCapital: ungatedEquity,
      preset: selected.preset,
      evaluationStartIndex: validationStart,
      evaluationEndIndex: validationEnd,
      positionScale: 1
    });
    const shadow = runStrategyBacktest({
      ...input,
      initialCapital: gatedEquity,
      preset: selected.preset,
      evaluationStartIndex: validationStart,
      evaluationEndIndex: validationEnd,
      positionScale: 1
    });
    const scale = appliedPermission === "allow" ? 1 : appliedPermission === "reduce_size" ? 0.5 : 0;
    const gated = scale === 1 ? shadow : runStrategyBacktest({
      ...input,
      initialCapital: gatedEquity,
      preset: selected.preset,
      evaluationStartIndex: validationStart,
      evaluationEndIndex: validationEnd,
      positionScale: scale
    });
    const nextHealth = evaluateStrategyHealth(shadow);

    ungatedEquity = ungated.finalEquity;
    gatedEquity = gated.finalEquity;
    ungatedTotalFees = roundMoney(ungatedTotalFees + ungated.totalFees);
    gatedTotalFees = roundMoney(gatedTotalFees + gated.totalFees);
    gatedPeak = Math.max(gatedPeak, gatedEquity);
    const endDrawdown = gatedPeak > 0 ? (gatedPeak - gatedEquity) / gatedPeak * 100 : 0;
    gatedMaxDrawdownPct = Math.max(gatedMaxDrawdownPct, gated.maxDrawdownPct, endDrawdown);
    folds.push({
      trainingEndDate: input.candles[validationStart - 1].timestamp,
      validationStartDate: input.candles[validationStart].timestamp,
      validationEndDate: input.candles[validationEnd].timestamp,
      selectedPreset: selected.preset.id,
      appliedPermission,
      ungatedReturnPct: ungated.netReturnPct,
      gatedReturnPct: gated.netReturnPct,
      shadowReturnPct: shadow.netReturnPct,
      healthAfterFold: nextHealth.strategyHealth,
      permissionAfterFold: nextHealth.entryPermission,
      gatedClosedTrades: gated.closedTrades
    });
    appliedPermission = nextHealth.entryPermission;
  }

  const ungatedReturnPct = round((ungatedEquity / initialCapital - 1) * 100);
  const gatedReturnPct = round((gatedEquity / initialCapital - 1) * 100);
  return {
    initialCapital,
    ungatedFinalEquity: roundMoney(ungatedEquity),
    gatedFinalEquity: roundMoney(gatedEquity),
    ungatedReturnPct,
    gatedReturnPct,
    returnImprovementPct: round(gatedReturnPct - ungatedReturnPct),
    gatedMaxDrawdownPct: round(gatedMaxDrawdownPct),
    ungatedTotalFees,
    gatedTotalFees,
    folds
  };
}

function resolveWalkForwardSplit(candleCount: number) {
  if (candleCount < 180) return null;
  const splitIndex = Math.floor(candleCount * 0.65);
  return splitIndex >= 90 && candleCount - splitIndex >= 60 ? splitIndex : null;
}

function average(values: number[]) {
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function signedPercent(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function evaluateStrategyHealth(result: StrategyBacktestResult | undefined): Pick<StrategyBacktestComparison, "strategyHealth" | "entryPermission" | "healthReason"> {
  const closedTrades = result?.closedTrades ?? 0;
  if (!result || closedTrades < 6) {
    return {
      strategyHealth: "insufficient",
      entryPermission: "reduce_size",
      healthReason: `样本外仅 ${closedTrades} 笔平仓，证据不足以暂停策略；新开仓缩至建议仓位的一半并继续积累样本。`
    };
  }

  // A per-symbol hard pause needs materially stronger evidence than a small
  // losing sample. This prevents 3-13 trades from silently disabling almost
  // the whole candidate universe while preserving a fail-safe for severe,
  // repeatedly observed strategy failure.
  const severeFailure =
    closedTrades >= 12 &&
    result.netReturnPct <= -5 &&
    result.maxDrawdownPct >= 10 &&
    (result.profitFactor ?? 0) < 0.65;
  if (severeFailure) {
    return {
      strategyHealth: "pause",
      entryPermission: "pause",
      healthReason: `样本外 ${closedTrades} 笔平仓同时满足净收益≤-5%、回撤≥10%且利润因子<0.65，暂时停止新开仓；门控会随最新复权数据定期重算。`
    };
  }

  if (result.netReturnPct <= 0 || result.maxDrawdownPct > 8 || (result.profitFactor ?? 0) < 1) {
    return {
      strategyHealth: "watch",
      entryPermission: "reduce_size",
      healthReason: `样本外 ${closedTrades} 笔平仓的稳定性仍不足，不做永久硬暂停；新开仓按建议仓位的一半执行并继续观察。`
    };
  }
  return { strategyHealth: "healthy", entryPermission: "allow", healthReason: `样本外 ${closedTrades} 笔平仓的净收益、回撤和利润因子未触发降级条件，可按现有风控执行。` };
}

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}
