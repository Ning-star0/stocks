export const FOCUS_TRADING_FEE_RATE = 0.0005;
export const FOCUS_TRADING_FEE_MINIMUM_BASE = 10000;
export const FOCUS_LOT_SIZE = 100;

export const TRADING_FEE_RULE = {
  rate: FOCUS_TRADING_FEE_RATE,
  minimumFeeBase: FOCUS_TRADING_FEE_MINIMUM_BASE,
  minimumFee: 5,
  lotSize: FOCUS_LOT_SIZE,
  description: "买入和卖出手续费均按成交金额的万分之五估算；若成交金额不足 10000 元，按 10000 元计费，即最低手续费 5 元。A 股/ETF 买入和卖出都按 100 股/份整数手执行，低于 100 股/份的买卖计划一律无效。"
};

export function calculateFocusTradeFee(amount: number) {
  return Number((Math.max(amount, FOCUS_TRADING_FEE_MINIMUM_BASE) * FOCUS_TRADING_FEE_RATE).toFixed(2));
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
