import { calculateTradingFee, roundMoney } from "@/lib/trading/rules";

export const MIN_NET_RISK_REWARD_RATIO = 1.25;
export const MAX_ROUND_TRIP_FEE_DRAG_PCT = 2;

export type TradeEconomics = {
  entryAmount: number;
  entryFee: number;
  totalEntryCost: number;
  targetExitAmount: number | null;
  targetExitFee: number | null;
  roundTripFees: number | null;
  feeDragPct: number | null;
  grossExpectedProfit: number | null;
  netExpectedProfit: number | null;
  priceRiskAmount: number | null;
  netRiskAmount: number | null;
  grossRiskRewardRatio: number | null;
  netRiskRewardRatio: number | null;
  breakEvenPrice: number;
  breakEvenMovePct: number;
};

export function calculateTradeEconomics(input: {
  entryPrice: number;
  shares: number;
  stopLossPrice?: number | null;
  takeProfitPrice?: number | null;
}): TradeEconomics | null {
  if (!positive(input.entryPrice) || !positive(input.shares)) return null;
  const entryAmount = roundMoney(input.entryPrice * input.shares);
  const entryFee = calculateTradingFee(entryAmount);
  const totalEntryCost = roundMoney(entryAmount + entryFee);
  const breakEvenPrice = calculateBreakEvenPrice(totalEntryCost, input.shares, input.entryPrice);
  const breakEvenMovePct = roundRatio(((breakEvenPrice - input.entryPrice) / input.entryPrice) * 100);

  const target = positive(input.takeProfitPrice) && input.takeProfitPrice > input.entryPrice ? input.takeProfitPrice : null;
  const stop = positive(input.stopLossPrice) && input.stopLossPrice < input.entryPrice ? input.stopLossPrice : null;
  const targetExitAmount = target ? roundMoney(target * input.shares) : null;
  const targetExitFee = targetExitAmount !== null ? calculateTradingFee(targetExitAmount) : null;
  const roundTripFees = targetExitFee !== null ? roundMoney(entryFee + targetExitFee) : null;
  const feeDragPct = roundTripFees !== null ? roundRatio((roundTripFees / entryAmount) * 100) : null;
  const grossExpectedProfit = target ? roundMoney((target - input.entryPrice) * input.shares) : null;
  const netExpectedProfit = targetExitAmount !== null && targetExitFee !== null ? roundMoney(targetExitAmount - targetExitFee - totalEntryCost) : null;
  const priceRiskAmount = stop ? roundMoney((input.entryPrice - stop) * input.shares) : null;
  const stopExitAmount = stop ? roundMoney(stop * input.shares) : null;
  const stopExitFee = stopExitAmount !== null ? calculateTradingFee(stopExitAmount) : null;
  const netRiskAmount = stopExitAmount !== null && stopExitFee !== null ? roundMoney(totalEntryCost - (stopExitAmount - stopExitFee)) : null;
  const grossRiskRewardRatio = grossExpectedProfit !== null && priceRiskAmount && priceRiskAmount > 0 ? roundRatio(grossExpectedProfit / priceRiskAmount) : null;
  const netRiskRewardRatio = netExpectedProfit !== null && netExpectedProfit > 0 && netRiskAmount && netRiskAmount > 0 ? roundRatio(netExpectedProfit / netRiskAmount) : null;

  return {
    entryAmount,
    entryFee,
    totalEntryCost,
    targetExitAmount,
    targetExitFee,
    roundTripFees,
    feeDragPct,
    grossExpectedProfit,
    netExpectedProfit,
    priceRiskAmount,
    netRiskAmount,
    grossRiskRewardRatio,
    netRiskRewardRatio,
    breakEvenPrice,
    breakEvenMovePct
  };
}

export function tradeEconomicsBlockReason(economics: TradeEconomics | null) {
  if (!economics) return "交易价格或数量无效，无法完成净收益测算。";
  if (economics.feeDragPct !== null && economics.feeDragPct > MAX_ROUND_TRIP_FEE_DRAG_PCT) {
    return `预计双边手续费占成交额 ${economics.feeDragPct.toFixed(2)}%，超过 ${MAX_ROUND_TRIP_FEE_DRAG_PCT.toFixed(2)}% 上限。`;
  }
  if (economics.netExpectedProfit !== null && economics.netExpectedProfit <= 0) {
    return "目标价扣除买卖双边手续费后没有正的预期收益。";
  }
  if (economics.netRiskRewardRatio !== null && economics.netRiskRewardRatio < MIN_NET_RISK_REWARD_RATIO) {
    return `扣除双边手续费后的净风险收益比 ${economics.netRiskRewardRatio.toFixed(2)} : 1，低于 ${MIN_NET_RISK_REWARD_RATIO.toFixed(2)} : 1。`;
  }
  if (economics.netExpectedProfit !== null && economics.netRiskAmount !== null && economics.netRiskRewardRatio === null) {
    return "扣除双边手续费后无法形成正向净风险收益比。";
  }
  return null;
}

function calculateBreakEvenPrice(totalEntryCost: number, shares: number, entryPrice: number) {
  let price = entryPrice;
  for (let index = 0; index < 4; index += 1) {
    price = (totalEntryCost + calculateTradingFee(price * shares)) / shares;
  }
  return Number(price.toFixed(4));
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function roundRatio(value: number) {
  return Number(value.toFixed(2));
}
