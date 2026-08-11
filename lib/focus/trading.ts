import {
  calculateTradingFee,
  TRADE_FEE_MIN_BASE,
  TRADE_FEE_RATE,
  TRADE_FEE_RULE,
  TRADE_LOT_SIZE
} from "@/lib/trading/rules";

export const FOCUS_TRADING_FEE_RATE = TRADE_FEE_RATE;
export const FOCUS_TRADING_FEE_MINIMUM_BASE = TRADE_FEE_MIN_BASE;
export const FOCUS_LOT_SIZE = TRADE_LOT_SIZE;
export const TRADING_FEE_RULE = TRADE_FEE_RULE;
export const FOCUS_MIN_FEE_EFFICIENT_AMOUNT = TRADE_FEE_MIN_BASE / 2;
const SMALL_ACCOUNT_MIN_TRADE_AMOUNT = 500;

export function calculateFocusTradeFee(amount: number) {
  return calculateTradingFee(amount);
}

export function sharesFromAmount(amount: number, price: number | null) {
  if (!price || price <= 0) return 0;
  return Math.floor(amount / price / FOCUS_LOT_SIZE) * FOCUS_LOT_SIZE;
}

export function normalizeBuyShares(shares: number, price: number, availableCash: number) {
  if (!price || price <= 0) return 0;
  let nextShares = Math.floor(shares / FOCUS_LOT_SIZE) * FOCUS_LOT_SIZE;
  while (nextShares > 0) {
    const amount = nextShares * price;
    if (amount + calculateFocusTradeFee(amount) <= availableCash) return nextShares;
    nextShares -= FOCUS_LOT_SIZE;
  }
  return 0;
}

export function normalizeSellShares(shares: number, holdingShares: number) {
  if (!Number.isFinite(holdingShares) || holdingShares <= 0) return 0;
  const capped = Math.min(Math.max(0, shares), holdingShares);
  if (capped <= 0 || holdingShares < FOCUS_LOT_SIZE) return 0;
  if (capped < FOCUS_LOT_SIZE) return FOCUS_LOT_SIZE;
  return Math.floor(capped / FOCUS_LOT_SIZE) * FOCUS_LOT_SIZE;
}

export function minimumFeeEfficientAmount(referenceCash?: number | null) {
  if (!Number.isFinite(referenceCash) || !referenceCash || referenceCash >= FOCUS_MIN_FEE_EFFICIENT_AMOUNT) {
    return FOCUS_MIN_FEE_EFFICIENT_AMOUNT;
  }
  return Math.min(FOCUS_MIN_FEE_EFFICIENT_AMOUNT, Math.max(SMALL_ACCOUNT_MIN_TRADE_AMOUNT, referenceCash * 0.2));
}

export function isFeeEfficientTrade(amount: number, referenceCash?: number | null) {
  if (!Number.isFinite(amount) || amount <= 0) return false;
  return amount >= minimumFeeEfficientAmount(referenceCash);
}

export function fallbackSellShares(holdingShares: number, adviceText: string) {
  if (!Number.isFinite(holdingShares) || holdingShares <= 0) return 0;
  if (/止损|离场|回避/.test(adviceText)) return normalizeSellShares(holdingShares, holdingShares);
  return normalizeSellShares(Math.max(FOCUS_LOT_SIZE, holdingShares * 0.5), holdingShares);
}

export function calculateSellPnl(input: {
  sellAmount: number;
  sellFee: number;
  shares: number;
  holdingPrice?: number | null;
  holdingShares?: number | null;
  currentCostBasis?: number | null;
}) {
  const ledgerCost = allocateCurrentCostBasis(input);
  if (ledgerCost !== null) return Number((input.sellAmount - input.sellFee - ledgerCost).toFixed(2));

  const holdingPrice = input.holdingPrice ?? 0;
  if (!holdingPrice || holdingPrice <= 0 || input.shares <= 0) return null;
  const costAmount = holdingPrice * input.shares;
  const buyFeeShare = calculateFocusTradeFee(costAmount);
  return Number((input.sellAmount - input.sellFee - costAmount - buyFeeShare).toFixed(2));
}

function allocateCurrentCostBasis(input: { shares: number; holdingShares?: number | null; currentCostBasis?: number | null }) {
  const costBasis = input.currentCostBasis ?? null;
  const holdingShares = input.holdingShares ?? null;
  if (!costBasis || costBasis <= 0 || !holdingShares || holdingShares <= 0 || input.shares <= 0) return null;
  if (input.shares >= holdingShares) return Number(costBasis.toFixed(2));
  return Number((costBasis * (input.shares / holdingShares)).toFixed(2));
}
