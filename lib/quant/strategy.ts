import type { IndicatorSnapshot } from "@/lib/types";

export type QuantAction = "buy" | "add" | "hold" | "watch" | "reduce" | "sell" | "avoid";

export type QuantMarketRegime = "risk_on" | "neutral" | "risk_off";
export type QuantSectorBias = "bullish" | "neutral" | "bearish" | "overheated" | "uncertain";

export type QuantStrategyContext = {
  marketRegime: QuantMarketRegime;
  buyThresholdDelta: number;
  sellThresholdDelta: number;
  maxPositionPct: number;
  allowAdd: boolean;
  avoidChasing: boolean;
  notes: string[];
  sectorBiases?: Record<string, QuantSectorBias>;
};

export type QuantSignal = {
  action: QuantAction;
  trendScore: number;
  momentumScore: number;
  riskScore: number;
  buyScore: number;
  sellScore: number;
  confidence: number;
  volumeRatio: number | null;
  supportDistancePct: number | null;
  resistanceDistancePct: number | null;
  stopDistancePct: number | null;
  takeProfitDistancePct: number | null;
  riskRewardRatio: number | null;
  holdingReturnPct: number | null;
  suggestedBuyCapitalPct: number;
  suggestedSellRatioPct: number;
  suggestedSellShares: number;
  adjustedBuyThreshold: number;
  adjustedAddThreshold: number;
  adjustedReduceThreshold: number;
  adjustedSellThreshold: number;
  holdingDays: number | null;
  newPositionProtection: boolean;
  marketRegime: QuantMarketRegime;
  sectorBias: QuantSectorBias;
  entryZone: string;
  stopLoss: string;
  takeProfit: string;
  exitPlan: string;
  reasons: string[];
  risks: string[];
};

export type QuantInput = {
  price: number | null;
  symbol?: string | null;
  name?: string | null;
  sectorKey?: string | null;
  changePct?: number | null;
  indicators?: Partial<IndicatorSnapshot> | null;
  historySummary?: {
    averageVolume?: number | null;
    recentVolume?: number | null;
    high?: number | null;
    low?: number | null;
    changePercent?: number | null;
  } | null;
  keyLevels?: {
    support?: number[];
    resistance?: number[];
  } | null;
  isHolding?: boolean | null;
  holdingPrice?: number | null;
  holdingShares?: number | null;
  positionOpenedAt?: Date | string | null;
  targetPrice?: number | null;
  stopLoss?: number | null;
  strategyContext?: QuantStrategyContext | null;
};

const BASE_THRESHOLDS = {
  buy: 70,
  add: 72,
  avoid: 68,
  reduce: 62,
  sell: 76
};

const NEW_POSITION_PROTECTION_DAYS = 3;

export function buildQuantSignal(input: QuantInput): QuantSignal {
  const price = validNumber(input.price);
  if (!price || price <= 0) {
    return emptySignal("行情价格不可用，量化规则不生成交易计划。");
  }

  const indicators = input.indicators ?? {};
  const support = nearestBelow(price, [
    ...(input.keyLevels?.support ?? []),
    indicators.bollingerLower,
    indicators.sma20,
    indicators.sma50
  ]);
  const resistance = nearestAbove(price, [
    ...(input.keyLevels?.resistance ?? []),
    indicators.bollingerUpper,
    input.targetPrice
  ]);
  const trendScore = clamp(
    50 +
      scoreIf(price > valueOrInfinity(indicators.sma20), 12) +
      scoreIf(price > valueOrInfinity(indicators.sma50), 12) +
      scoreIf(price > valueOrInfinity(indicators.sma200), 10) +
      scoreIf(compareNumbers(indicators.sma20, indicators.sma50) > 0, 10) +
      scoreIf(compareNumbers(indicators.sma50, indicators.sma200) > 0, 8) -
      scoreIf(price < valueOrZero(indicators.sma20), 12) -
      scoreIf(price < valueOrZero(indicators.sma50), 12),
    0,
    100
  );
  const rsi = validNumber(indicators.rsi14);
  const macd = validNumber(indicators.macd);
  const macdSignal = validNumber(indicators.macdSignal);
  const volumeRatio = volumeStrength(input.historySummary);
  const momentumScore = clamp(
    50 +
      scoreIf(macd !== null && macdSignal !== null && macd > macdSignal, 18) -
      scoreIf(macd !== null && macdSignal !== null && macd < macdSignal, 18) +
      rsiScore(rsi) +
      scoreIf(volumeRatio !== null && volumeRatio >= 1.15, 8) -
      scoreIf(volumeRatio !== null && volumeRatio <= 0.72, 8),
    0,
    100
  );
  const overbought = rsi !== null && rsi >= 74;
  const oversold = rsi !== null && rsi <= 32;
  const macdBearish = macd !== null && macdSignal !== null && macd < macdSignal;
  const marketContext = normalizeStrategyContext(input.strategyContext);
  const sectorBias = resolveSectorBias(marketContext, input.sectorKey);
  const nearSupport = support !== null ? Math.abs((price - support) / price) <= 0.035 : false;
  const nearResistance = resistance !== null ? Math.abs((resistance - price) / price) <= 0.035 : false;
  const stopLoss = validNumber(input.stopLoss);
  const targetPrice = validNumber(input.targetPrice);
  const effectiveStopLoss = stopLoss ?? support ?? price * 0.96;
  const effectiveTakeProfit = targetPrice ?? resistance ?? price * 1.06;
  const stopTriggered = Boolean(effectiveStopLoss && price <= effectiveStopLoss);
  const targetReached = Boolean(effectiveTakeProfit && price >= effectiveTakeProfit);
  const holdingReturn = input.isHolding && input.holdingPrice ? ((price - input.holdingPrice) / input.holdingPrice) * 100 : null;
  const supportDistancePct = support ? ((price - support) / price) * 100 : null;
  const resistanceDistancePct = resistance ? ((resistance - price) / price) * 100 : null;
  const stopDistancePct = effectiveStopLoss ? ((price - effectiveStopLoss) / price) * 100 : null;
  const takeProfitDistancePct = effectiveTakeProfit ? ((effectiveTakeProfit - price) / price) * 100 : null;
  const riskRewardRatio = stopDistancePct !== null && takeProfitDistancePct !== null && stopDistancePct > 0 ? takeProfitDistancePct / stopDistancePct : null;
  const holdingDays = holdingAgeDays(input.positionOpenedAt);
  const newPositionProtection = Boolean(
    input.isHolding &&
      holdingDays !== null &&
      holdingDays <= NEW_POSITION_PROTECTION_DAYS &&
      !stopTriggered &&
      sellScoreWouldBeSoft({ holdingReturn, effectiveStopLoss, price })
  );

  const riskScore = clamp(
    50 +
      scoreIf(stopTriggered, 35) +
      scoreIf(overbought && macdBearish, 22) +
      scoreIf(nearResistance && overbought, 16) +
      scoreIf(trendScore < 42, 16) +
      scoreIf(riskRewardRatio !== null && riskRewardRatio < 1.2, 10) +
      scoreIf(holdingReturn !== null && holdingReturn <= -6, 12) -
      scoreIf(sectorBias === "bullish" && marketContext.marketRegime !== "risk_off", 4) +
      scoreIf(sectorBias === "bearish", 8) +
      scoreIf(sectorBias === "overheated", 6) +
      scoreIf(marketContext.marketRegime === "risk_off", 8) -
      scoreIf(marketContext.marketRegime === "risk_on", 4) -
      scoreIf(nearSupport && trendScore >= 55, 8) -
      scoreIf(oversold && trendScore >= 50, 6),
    0,
    100
  );
  const buyScore = clamp(
    trendScore * 0.45 +
      momentumScore * 0.35 +
      (100 - riskScore) * 0.2 +
      scoreIf(nearSupport, 8) -
      scoreIf(overbought, 14) -
      scoreIf(nearResistance, 8) +
      scoreIf(riskRewardRatio !== null && riskRewardRatio >= 1.8, 6) -
      scoreIf(riskRewardRatio !== null && riskRewardRatio < 1, 8) +
      scoreIf(sectorBias === "bullish" && marketContext.marketRegime !== "risk_off", 4) -
      scoreIf(sectorBias === "bearish", 8) -
      scoreIf(sectorBias === "overheated" && overbought, 8) -
      scoreIf(marketContext.marketRegime === "risk_off", 6),
    0,
    100
  );
  const sellScore = clamp(
    riskScore * 0.48 +
      (100 - trendScore) * 0.24 +
      (100 - momentumScore) * 0.18 +
      scoreIf(stopTriggered, 24) +
      scoreIf(targetReached, 12) +
      scoreIf(Boolean(input.isHolding) && holdingReturn !== null && holdingReturn >= 8 && nearResistance, 12) +
      scoreIf(Boolean(input.isHolding) && holdingReturn !== null && holdingReturn >= 8 && overbought, 10) +
      scoreIf(Boolean(input.isHolding) && holdingReturn !== null && holdingReturn >= 8 && riskRewardRatio !== null && riskRewardRatio < 1.2, 12) +
      scoreIf(sectorBias === "bearish", 8) +
      scoreIf(sectorBias === "overheated" && overbought, 8) +
      scoreIf(marketContext.marketRegime === "risk_off", 6) -
      scoreIf(sectorBias === "bullish" && marketContext.marketRegime !== "risk_off", 4),
    0,
    100
  );

  const thresholds = adjustedThresholds(marketContext, sectorBias);
  const reasons = buildReasons({
    trendScore,
    momentumScore,
    riskScore,
    rsi,
    macdBearish,
    nearSupport,
    nearResistance,
    volumeRatio,
    marketContext,
    sectorBias
  });
  const risks = buildRisks({
    overbought,
    macdBearish,
    nearResistance,
    stopTriggered,
    targetReached,
    trendScore,
    volumeRatio,
    riskRewardRatio,
    newPositionProtection,
    marketContext,
    sectorBias
  });
  const action = chooseAction({
    isHolding: Boolean(input.isHolding),
    buyScore,
    sellScore,
    stopTriggered,
    targetReached,
    overbought,
    macdBearish,
    holdingReturn,
    nearResistance,
    riskRewardRatio,
    thresholds,
    marketContext,
    newPositionProtection
  });
  const confidence = clamp(Math.max(buyScore, sellScore, 100 - Math.abs(buyScore - sellScore)) / 100, 0.35, 0.9);
  const suggestedBuyCapitalPct = estimateBuyCapitalPct({ isHolding: Boolean(input.isHolding), action, buyScore, riskScore, riskRewardRatio, marketContext });
  const suggestedSellRatioPct = estimateSellRatioPct({
    isHolding: Boolean(input.isHolding),
    action,
    sellScore,
    stopTriggered,
    targetReached,
    overbought,
    macdBearish,
    holdingReturn,
    nearResistance,
    riskRewardRatio,
    newPositionProtection
  });
  const suggestedSellShares = estimateSellShares(input.holdingShares, suggestedSellRatioPct);

  return {
    action,
    trendScore: round(trendScore),
    momentumScore: round(momentumScore),
    riskScore: round(riskScore),
    buyScore: round(buyScore),
    sellScore: round(sellScore),
    confidence: round(confidence, 2),
    volumeRatio: nullableRound(volumeRatio, 2),
    supportDistancePct: nullableRound(supportDistancePct),
    resistanceDistancePct: nullableRound(resistanceDistancePct),
    stopDistancePct: nullableRound(stopDistancePct),
    takeProfitDistancePct: nullableRound(takeProfitDistancePct),
    riskRewardRatio: nullableRound(riskRewardRatio, 2),
    holdingReturnPct: nullableRound(holdingReturn),
    suggestedBuyCapitalPct,
    suggestedSellRatioPct,
    suggestedSellShares,
    adjustedBuyThreshold: thresholds.buy,
    adjustedAddThreshold: thresholds.add,
    adjustedReduceThreshold: thresholds.reduce,
    adjustedSellThreshold: thresholds.sell,
    holdingDays,
    newPositionProtection,
    marketRegime: marketContext.marketRegime,
    sectorBias,
    entryZone: formatZone(support, indicators.sma20, price),
    stopLoss: formatLevel(effectiveStopLoss),
    takeProfit: formatLevel(effectiveTakeProfit),
    exitPlan: buildExitPlan({ action, suggestedSellRatioPct, suggestedSellShares, effectiveStopLoss, effectiveTakeProfit, sellScore }),
    reasons,
    risks
  };
}

function chooseAction(input: {
  isHolding: boolean;
  buyScore: number;
  sellScore: number;
  stopTriggered: boolean;
  targetReached: boolean;
  overbought: boolean;
  macdBearish: boolean;
  holdingReturn: number | null;
  nearResistance: boolean;
  riskRewardRatio: number | null;
  thresholds: ReturnType<typeof adjustedThresholds>;
  marketContext: QuantStrategyContext;
  newPositionProtection: boolean;
}): QuantAction {
  if (input.isHolding) {
    if (input.stopTriggered || input.sellScore >= input.thresholds.sell) return "sell";
    if (input.newPositionProtection) return "hold";
    const profitProtect =
      input.holdingReturn !== null &&
      input.holdingReturn >= 8 &&
      (input.nearResistance || input.overbought || (input.riskRewardRatio !== null && input.riskRewardRatio < 1.2));
    if (input.targetReached || input.sellScore >= input.thresholds.reduce || (input.overbought && input.macdBearish) || profitProtect) return "reduce";
    if (input.marketContext.allowAdd && input.buyScore >= input.thresholds.add && input.sellScore < 48) return "add";
    return "hold";
  }
  if (input.buyScore >= input.thresholds.buy && input.sellScore < 52) return "buy";
  if (input.sellScore >= input.thresholds.avoid) return "avoid";
  return "watch";
}

function emptySignal(reason: string): QuantSignal {
  return {
    action: "watch",
    trendScore: 0,
    momentumScore: 0,
    riskScore: 100,
    buyScore: 0,
    sellScore: 0,
    confidence: 0.35,
    volumeRatio: null,
    supportDistancePct: null,
    resistanceDistancePct: null,
    stopDistancePct: null,
    takeProfitDistancePct: null,
    riskRewardRatio: null,
    holdingReturnPct: null,
    suggestedBuyCapitalPct: 0,
    suggestedSellRatioPct: 0,
    suggestedSellShares: 0,
    adjustedBuyThreshold: BASE_THRESHOLDS.buy,
    adjustedAddThreshold: BASE_THRESHOLDS.add,
    adjustedReduceThreshold: BASE_THRESHOLDS.reduce,
    adjustedSellThreshold: BASE_THRESHOLDS.sell,
    holdingDays: null,
    newPositionProtection: false,
    marketRegime: "neutral",
    sectorBias: "uncertain",
    entryZone: "--",
    stopLoss: "--",
    takeProfit: "--",
    exitPlan: "行情不可用，不生成卖出或减仓计划。",
    reasons: [reason],
    risks: [reason]
  };
}

function buildReasons(input: {
  trendScore: number;
  momentumScore: number;
  riskScore: number;
  rsi: number | null;
  macdBearish: boolean;
  nearSupport: boolean;
  nearResistance: boolean;
  volumeRatio: number | null;
  marketContext: QuantStrategyContext;
  sectorBias: QuantSectorBias;
}) {
  const reasons = [];
  if (input.trendScore >= 65) reasons.push("价格位于主要均线之上，趋势过滤偏多。");
  else if (input.trendScore <= 42) reasons.push("价格或均线结构转弱，趋势过滤偏谨慎。");
  else reasons.push("趋势结构中性，需等待动量确认。");
  if (input.momentumScore >= 62) reasons.push("MACD/RSI/量能组合支持继续观察多头动能。");
  if (input.macdBearish) reasons.push("MACD 弱于信号线，短线动量转弱。");
  if (input.rsi !== null && input.rsi >= 74) reasons.push("RSI 进入偏热区间，追高性价比下降。");
  if (input.nearSupport) reasons.push("价格靠近支撑或中短期均线，具备条件观察价值。");
  if (input.nearResistance) reasons.push("价格接近压力位，需要控制追高和止盈风险。");
  if (input.volumeRatio !== null && input.volumeRatio < 0.75) reasons.push("近期成交量低于均量，信号确认度下降。");
  if (input.marketContext.marketRegime === "risk_on") reasons.push("市场/行业上下文偏进攻，允许更积极的小仓观察。");
  if (input.marketContext.marketRegime === "risk_off") reasons.push("市场/行业上下文偏防守，买入阈值上调、卖出阈值下调。");
  if (input.sectorBias === "bullish") reasons.push("行业新闻和候选共振偏正，趋势信号权重上调。");
  if (input.sectorBias === "overheated") reasons.push("行业热度较高但存在兑现风险，追高阈值收紧。");
  if (input.riskScore >= 68) reasons.push("风险分数偏高，优先考虑风控动作。");
  return [...new Set(reasons)].slice(0, 5);
}

function buildRisks(input: {
  overbought: boolean;
  macdBearish: boolean;
  nearResistance: boolean;
  stopTriggered: boolean;
  targetReached: boolean;
  trendScore: number;
  volumeRatio: number | null;
  riskRewardRatio: number | null;
  newPositionProtection: boolean;
  marketContext: QuantStrategyContext;
  sectorBias: QuantSectorBias;
}) {
  const risks = [];
  if (input.stopTriggered) risks.push("价格已触及或跌破止损边界。");
  if (input.targetReached) risks.push("价格已达到目标价附近，需考虑止盈或降低仓位。");
  if (input.overbought) risks.push("RSI 偏热，短线回撤风险上升。");
  if (input.macdBearish) risks.push("MACD 转弱，动量确认不足。");
  if (input.nearResistance) risks.push("价格靠近压力位，风险收益比下降。");
  if (input.trendScore < 45) risks.push("趋势过滤不支持主动进攻。");
  if (input.volumeRatio !== null && input.volumeRatio < 0.75) risks.push("量能不足，突破或反弹有效性需要复核。");
  if (input.riskRewardRatio !== null && input.riskRewardRatio < 1.2) risks.push("止盈空间相对止损空间不足，风险收益比偏低。");
  if (input.newPositionProtection) risks.push(`新建仓 ${NEW_POSITION_PROTECTION_DAYS} 天保护期内，未触发硬止损时不直接卖出。`);
  if (input.marketContext.marketRegime === "risk_off") risks.push("整体环境偏防守，降低主动加仓权重。");
  if (input.sectorBias === "bearish") risks.push("行业新闻或候选共振偏负，需要提高风控优先级。");
  return [...new Set(risks)].slice(0, 5);
}

function estimateBuyCapitalPct(input: {
  isHolding: boolean;
  action: QuantAction;
  buyScore: number;
  riskScore: number;
  riskRewardRatio: number | null;
  marketContext: QuantStrategyContext;
}) {
  if (input.action !== "buy" && input.action !== "add") return 0;
  let pct = input.isHolding ? 10 : 15;
  if (input.buyScore >= 78) pct += 10;
  else if (input.buyScore >= 70) pct += 5;
  if (input.riskScore >= 62) pct -= 5;
  if (input.riskRewardRatio !== null && input.riskRewardRatio >= 2) pct += 5;
  if (input.riskRewardRatio !== null && input.riskRewardRatio < 1.3) pct -= 5;
  if (input.marketContext.marketRegime === "risk_off") pct -= 5;
  if (input.marketContext.marketRegime === "risk_on") pct += 3;
  return clamp(Math.round(pct), 0, Math.min(input.marketContext.maxPositionPct, input.isHolding ? 20 : 30));
}

function estimateSellRatioPct(input: {
  isHolding: boolean;
  action: QuantAction;
  sellScore: number;
  stopTriggered: boolean;
  targetReached: boolean;
  overbought: boolean;
  macdBearish: boolean;
  holdingReturn: number | null;
  nearResistance: boolean;
  riskRewardRatio: number | null;
  newPositionProtection: boolean;
}) {
  if (!input.isHolding) return 0;
  if (input.newPositionProtection && !input.stopTriggered && input.sellScore < 82) return 0;
  if (input.stopTriggered || input.action === "sell" || input.sellScore >= 82) return 100;
  if (input.targetReached && input.sellScore >= 70) return 50;
  if (input.sellScore >= 72) return 50;
  if (input.action === "reduce" || input.sellScore >= 62 || (input.overbought && input.macdBearish)) return 25;
  if (input.holdingReturn !== null && input.holdingReturn >= 10 && input.nearResistance) return 25;
  if (input.holdingReturn !== null && input.holdingReturn >= 8 && input.overbought) return 25;
  if (input.holdingReturn !== null && input.holdingReturn >= 8 && input.riskRewardRatio !== null && input.riskRewardRatio < 1.2) return 25;
  return 0;
}

function adjustedThresholds(context: QuantStrategyContext, sectorBias: QuantSectorBias) {
  const sectorBuyDelta =
    sectorBias === "bullish" ? -3 :
    sectorBias === "bearish" ? 7 :
    sectorBias === "overheated" ? 4 :
    sectorBias === "uncertain" ? 2 :
    0;
  const sectorSellDelta =
    sectorBias === "bullish" ? 4 :
    sectorBias === "bearish" ? -6 :
    sectorBias === "overheated" ? -4 :
    0;
  const buy = clamp(Math.round(BASE_THRESHOLDS.buy + context.buyThresholdDelta + sectorBuyDelta), 60, 82);
  const add = clamp(Math.round(BASE_THRESHOLDS.add + context.buyThresholdDelta + sectorBuyDelta), 62, 84);
  const reduce = clamp(Math.round(BASE_THRESHOLDS.reduce + context.sellThresholdDelta + sectorSellDelta), 54, 72);
  const sell = clamp(Math.round(BASE_THRESHOLDS.sell + context.sellThresholdDelta + sectorSellDelta), 66, 86);
  return {
    buy,
    add,
    reduce,
    sell,
    avoid: clamp(Math.round(BASE_THRESHOLDS.avoid + context.sellThresholdDelta + sectorSellDelta), 58, 78)
  };
}

function normalizeStrategyContext(value: QuantStrategyContext | null | undefined): QuantStrategyContext {
  if (!value) {
    return {
      marketRegime: "neutral",
      buyThresholdDelta: 0,
      sellThresholdDelta: 0,
      maxPositionPct: 30,
      allowAdd: true,
      avoidChasing: true,
      notes: [],
      sectorBiases: {}
    };
  }
  return {
    marketRegime: value.marketRegime ?? "neutral",
    buyThresholdDelta: validNumber(value.buyThresholdDelta) ?? 0,
    sellThresholdDelta: validNumber(value.sellThresholdDelta) ?? 0,
    maxPositionPct: validNumber(value.maxPositionPct) ?? 30,
    allowAdd: value.allowAdd !== false,
    avoidChasing: value.avoidChasing !== false,
    notes: Array.isArray(value.notes) ? value.notes.filter((item): item is string => typeof item === "string").slice(0, 6) : [],
    sectorBiases: value.sectorBiases ?? {}
  };
}

function resolveSectorBias(context: QuantStrategyContext, sectorKey?: string | null): QuantSectorBias {
  if (!sectorKey) return "uncertain";
  return context.sectorBiases?.[sectorKey] ?? "uncertain";
}

function holdingAgeDays(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

function sellScoreWouldBeSoft(input: { holdingReturn: number | null; effectiveStopLoss: number | null; price: number }) {
  if (input.effectiveStopLoss && input.price <= input.effectiveStopLoss) return false;
  if (input.holdingReturn !== null && input.holdingReturn <= -6) return false;
  return true;
}

function estimateSellShares(holdingShares: number | null | undefined, ratioPct: number) {
  const shares = validNumber(holdingShares);
  if (!shares || shares < 100 || ratioPct <= 0) return 0;
  if (ratioPct >= 100) return Math.floor(shares);
  const target = Math.floor((shares * ratioPct) / 100);
  if (target <= 0) return 0;
  const lotShares = Math.floor(target / 100) * 100;
  if (lotShares > 0) return Math.min(lotShares, Math.floor(shares));
  return 100;
}

function buildExitPlan(input: {
  action: QuantAction;
  suggestedSellRatioPct: number;
  suggestedSellShares: number;
  effectiveStopLoss: number | null;
  effectiveTakeProfit: number | null;
  sellScore: number;
}) {
  if (input.suggestedSellRatioPct <= 0) {
    return `当前卖出分 ${round(input.sellScore)}，未触发减仓/卖出阈值。`;
  }
  const actionLabel = input.action === "sell" ? "卖出" : "减仓";
  const sharesText = input.suggestedSellShares > 0 ? `，约 ${input.suggestedSellShares} 股/份` : "";
  return `${actionLabel}观察：建议比例 ${input.suggestedSellRatioPct}%${sharesText}；止损边界 ${formatLevel(input.effectiveStopLoss)}，止盈/压力边界 ${formatLevel(input.effectiveTakeProfit)}。`;
}

function rsiScore(value: number | null) {
  if (value === null) return 0;
  if (value >= 45 && value <= 64) return 12;
  if (value > 64 && value < 74) return 4;
  if (value >= 74) return -18;
  if (value <= 30) return -6;
  if (value < 40) return -4;
  return 4;
}

function volumeStrength(summary: QuantInput["historySummary"]) {
  const averageVolume = validNumber(summary?.averageVolume);
  const recentVolume = validNumber(summary?.recentVolume);
  if (!averageVolume || !recentVolume || averageVolume <= 0) return null;
  return recentVolume / averageVolume;
}

function nearestBelow(price: number, levels: Array<number | null | undefined>) {
  const values = levels.map(validNumber).filter((value): value is number => value !== null && value > 0 && value <= price);
  if (!values.length) return null;
  return Math.max(...values);
}

function nearestAbove(price: number, levels: Array<number | null | undefined>) {
  const values = levels.map(validNumber).filter((value): value is number => value !== null && value > 0 && value >= price);
  if (!values.length) return null;
  return Math.min(...values);
}

function formatZone(...values: Array<number | null | undefined>) {
  const valid = values.map(validNumber).filter((value): value is number => value !== null && value > 0).sort((a, b) => a - b);
  if (!valid.length) return "--";
  const low = valid[0];
  const high = valid[Math.min(valid.length - 1, 1)] ?? low;
  return `${formatLevel(low)}-${formatLevel(high)}`;
}

function formatLevel(value: number | null | undefined) {
  const number = validNumber(value);
  if (number === null) return "--";
  return number >= 100 ? number.toFixed(2) : number.toFixed(3);
}

function scoreIf(condition: boolean, score: number) {
  return condition ? score : 0;
}

function compareNumbers(a: number | null | undefined, b: number | null | undefined) {
  const left = validNumber(a);
  const right = validNumber(b);
  if (left === null || right === null) return 0;
  return left - right;
}

function valueOrInfinity(value: number | null | undefined) {
  return validNumber(value) ?? Number.POSITIVE_INFINITY;
}

function valueOrZero(value: number | null | undefined) {
  return validNumber(value) ?? 0;
}

function validNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 1) {
  return Number(value.toFixed(digits));
}

function nullableRound(value: number | null, digits = 1) {
  return value === null || !Number.isFinite(value) ? null : round(value, digits);
}
