export type PerformanceExecution = {
  id: string;
  symbol: string;
  side: string;
  amount: number;
  fee: number;
  realizedPnl: number | null;
  executedAt: string | Date;
};

export type TradePerformanceSummary = {
  totalTrades: number;
  buyTrades: number;
  sellTrades: number;
  closedTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  currentLossStreak: number;
  maxLossStreak: number;
  winRatePct: number | null;
  grossProfit: number;
  grossLoss: number;
  netRealizedPnl: number;
  realizedReturnPct: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  expectancy: number | null;
  payoffRatio: number | null;
  profitFactor: number | null;
  maxDrawdown: number;
  maxDrawdownPct: number | null;
  turnover: number;
  totalFees: number;
  feeRatePct: number | null;
  bestTrade: PerformanceTradePoint | null;
  worstTrade: PerformanceTradePoint | null;
  equityCurve: PerformanceEquityPoint[];
};

export type PerformanceTradePoint = {
  id: string;
  symbol: string;
  pnl: number;
  executedAt: string;
};

export type PerformanceEquityPoint = PerformanceTradePoint & {
  cumulativePnl: number;
  drawdown: number;
};

export function buildTradePerformance(executions: PerformanceExecution[], capital?: number | null): TradePerformanceSummary {
  const ordered = [...executions].sort((a, b) => toTime(a.executedAt) - toTime(b.executedAt));
  const closed = ordered.filter((execution) => execution.side === "sell" && isFiniteNumber(execution.realizedPnl));
  const winners = closed.filter((execution) => Number(execution.realizedPnl) > 0);
  const losers = closed.filter((execution) => Number(execution.realizedPnl) < 0);
  const breakevenTrades = closed.length - winners.length - losers.length;
  const grossProfit = roundMoney(winners.reduce((sum, execution) => sum + Number(execution.realizedPnl), 0));
  const grossLoss = roundMoney(Math.abs(losers.reduce((sum, execution) => sum + Number(execution.realizedPnl), 0)));
  const netRealizedPnl = roundMoney(closed.reduce((sum, execution) => sum + Number(execution.realizedPnl), 0));
  const averageWin = winners.length ? roundMoney(grossProfit / winners.length) : null;
  const averageLoss = losers.length ? roundMoney(grossLoss / losers.length) : null;
  const normalizedCapital = isFiniteNumber(capital) && Number(capital) > 0 ? Number(capital) : null;
  const lossStreaks = calculateLossStreaks(closed.map((execution) => Number(execution.realizedPnl)));

  let cumulativePnl = 0;
  let peakPnl = 0;
  let maxDrawdown = 0;
  const realizedCurve = closed.map((execution) => {
    cumulativePnl = roundMoney(cumulativePnl + Number(execution.realizedPnl));
    peakPnl = Math.max(peakPnl, cumulativePnl);
    const drawdown = roundMoney(Math.max(0, peakPnl - cumulativePnl));
    maxDrawdown = Math.max(maxDrawdown, drawdown);
    return {
      id: execution.id,
      symbol: execution.symbol,
      pnl: roundMoney(Number(execution.realizedPnl)),
      cumulativePnl,
      drawdown,
      executedAt: toIso(execution.executedAt)
    };
  });
  const equityCurve = ordered.length
    ? [
        {
          id: `baseline:${ordered[0].id}`,
          symbol: ordered[0].symbol,
          pnl: 0,
          cumulativePnl: 0,
          drawdown: 0,
          executedAt: toIso(ordered[0].executedAt)
        },
        ...realizedCurve
      ]
    : [];

  const tradePoints = closed.map((execution) => ({
    id: execution.id,
    symbol: execution.symbol,
    pnl: roundMoney(Number(execution.realizedPnl)),
    executedAt: toIso(execution.executedAt)
  }));
  const turnover = roundMoney(ordered.reduce((sum, execution) => sum + finiteOrZero(execution.amount), 0));
  const totalFees = roundMoney(ordered.reduce((sum, execution) => sum + finiteOrZero(execution.fee), 0));

  return {
    totalTrades: ordered.length,
    buyTrades: ordered.filter((execution) => execution.side === "buy").length,
    sellTrades: ordered.filter((execution) => execution.side === "sell").length,
    closedTrades: closed.length,
    winningTrades: winners.length,
    losingTrades: losers.length,
    breakevenTrades,
    currentLossStreak: lossStreaks.current,
    maxLossStreak: lossStreaks.max,
    winRatePct: closed.length ? roundRatio((winners.length / closed.length) * 100) : null,
    grossProfit,
    grossLoss,
    netRealizedPnl,
    realizedReturnPct: normalizedCapital ? roundRatio((netRealizedPnl / normalizedCapital) * 100) : null,
    averageWin,
    averageLoss,
    expectancy: closed.length ? roundMoney(netRealizedPnl / closed.length) : null,
    payoffRatio: averageWin !== null && averageLoss ? roundRatio(averageWin / averageLoss) : null,
    profitFactor: grossLoss > 0 ? roundRatio(grossProfit / grossLoss) : null,
    maxDrawdown: roundMoney(maxDrawdown),
    maxDrawdownPct: normalizedCapital ? roundRatio((maxDrawdown / normalizedCapital) * 100) : null,
    turnover,
    totalFees,
    feeRatePct: turnover > 0 ? roundRatio((totalFees / turnover) * 100) : null,
    bestTrade: tradePoints.length ? [...tradePoints].sort((a, b) => b.pnl - a.pnl)[0] : null,
    worstTrade: tradePoints.length ? [...tradePoints].sort((a, b) => a.pnl - b.pnl)[0] : null,
    equityCurve
  };
}

function calculateLossStreaks(pnls: number[]) {
  let current = 0;
  let max = 0;
  for (const pnl of pnls) {
    if (pnl < 0) {
      current += 1;
      max = Math.max(max, current);
    } else {
      current = 0;
    }
  }
  return { current, max };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finiteOrZero(value: unknown) {
  return isFiniteNumber(value) ? value : 0;
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function roundRatio(value: number) {
  return Number(value.toFixed(2));
}

function toTime(value: string | Date) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function toIso(value: string | Date) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
}
