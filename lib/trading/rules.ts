export const TRADE_LOT_SIZE = 100;
export const TRADE_FEE_RATE = 0.0005;
export const TRADE_FEE_MIN_BASE = 10000;
export const TRADE_FEE_MINIMUM = TRADE_FEE_MIN_BASE * TRADE_FEE_RATE;

export const TRADE_FEE_RULE = {
  rate: TRADE_FEE_RATE,
  minimumFeeBase: TRADE_FEE_MIN_BASE,
  minimumFee: TRADE_FEE_MINIMUM,
  lotSize: TRADE_LOT_SIZE,
  description: "买入和卖出手续费均按成交金额的万分之五估算；若成交金额不足 10000 元，按 10000 元计费，即最低手续费 5 元。A 股/ETF 买入和卖出都按 100 股/份整数手执行，低于 100 股/份的买卖计划一律无效。"
};

export function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

export function calculateTradingFee(amount: number) {
  return roundMoney(Math.max(amount, TRADE_FEE_MIN_BASE) * TRADE_FEE_RATE);
}

export function parsePositiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function isValidTradeLotShares(value: unknown) {
  const shares = Number(value);
  return Number.isFinite(shares) && shares >= TRADE_LOT_SIZE && shares % TRADE_LOT_SIZE === 0;
}
