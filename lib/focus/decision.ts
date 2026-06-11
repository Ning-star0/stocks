import { createHash } from "node:crypto";
import type { FocusDecision as StoredFocusDecision, Prisma } from "@prisma/client";

import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

import { estimateAiCost, getAiConfig, selectAiModel } from "@/lib/ai/config";
import { createDecisionHistoryFromFocusDecision, refreshAnalysisRun } from "@/lib/analysis/runRecords";
import { createChatCompletion } from "@/lib/ai/deepseek";
import { getCache, setCache } from "@/lib/cache";
import { AppError } from "@/lib/errors";
import {
  candidateHasFreshQuote,
  candidateSupportsBuy,
  candidateSupportsSell,
  quantAllowsBuy,
  quantAllowsSell,
  quantReason,
  quantView,
  stringifyAdvice
} from "@/lib/focus/decisionCandidate";
import { buildDecisionPrompt, FOCUS_DECISION_SYSTEM_PROMPT } from "@/lib/focus/decisionPrompt";
import { decisionSchema, type DecisionSchemaValue } from "@/lib/focus/decisionSchema";
import type { Candidate, DecisionInput, GenerateFocusDecisionOptions } from "@/lib/focus/decisionTypes";
import {
  buildPortfolioSnapshot,
  calculateRealizedPnl,
  type PortfolioSnapshot
} from "@/lib/focus/portfolio";
import {
  latestFocusAnalysesForSymbols as latestAnalysesForSymbols,
  focusSymbolVariants as symbolVariants,
  sameFocusSymbol as sameSymbol
} from "@/lib/focus/symbols";
import {
  calculateFocusTradeFee,
  calculateSellPnl,
  fallbackSellShares,
  normalizeBuyShares as normalizeShares,
  normalizeSellShares,
  sharesFromAmount,
  TRADING_FEE_RULE
} from "@/lib/focus/trading";
import { notifyFocusDecision } from "@/lib/notifications/send";
import { prisma } from "@/lib/prisma";
import { buildQuantSignal, type QuantInput, type QuantSectorBias, type QuantStrategyContext } from "@/lib/quant/strategy";
import { getQuotesBatch } from "@/lib/services/quoteService";
import { reconcileAndRebuildUserPositions } from "@/lib/trades/ledger";
import { toNumber } from "@/lib/utils";

export async function getLatestStoredFocusDecision(userId: string) {
  await prisma.$transaction((tx) => reconcileAndRebuildUserPositions(tx, userId));
  const seed = await loadDecisionSeed(userId);
  const inputHash = createDecisionSignature(seed);
  const portfolioSnapshot = await loadPortfolioSnapshot(userId, seed.capital);
  const exact = await prisma.focusDecision.findFirst({
    where: { userId, inputHash },
    orderBy: { createdAt: "desc" },
    include: { feedback: true }
  });
  if (exact) return attachStoredMetadata(exact, { fromCache: true, stale: false }, portfolioSnapshot);

  const latest = await prisma.focusDecision.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { feedback: true }
  });
  return latest ? attachStoredMetadata(latest, { fromCache: true, stale: true }, portfolioSnapshot) : null;
}

export async function generateAndStoreFocusDecision(options: GenerateFocusDecisionOptions) {
  const source = options.source ?? "manual";
  await prisma.$transaction((tx) => reconcileAndRebuildUserPositions(tx, options.userId));
  const seed = await loadDecisionSeed(options.userId);
  const inputHash = createDecisionSignature(seed);
  const cacheKey = `focus_decision:${options.userId}:${inputHash}`;

  if (!options.forceRefresh) {
    const stored = await prisma.focusDecision.findFirst({
      where: { userId: options.userId, inputHash },
      orderBy: { createdAt: "desc" },
      include: { feedback: true }
    });
    if (stored) {
      const portfolioSnapshot = await loadPortfolioSnapshot(options.userId, seed.capital);
      return attachStoredMetadata(stored, { fromCache: true, stale: false }, portfolioSnapshot);
    }

    const cached = await getCache<Awaited<ReturnType<typeof generateFocusDecision>>>(cacheKey);
    if (cached) return { ...cached, fromCache: true, stale: false };
  }

  const input = await loadDecisionInput(seed);
  const decision = await generateFocusDecision(input);
  await logFocusDecisionAiUsage({
    userId: options.userId,
    source,
    inputHash,
    input,
    decision,
    cacheHit: false
  }).catch(() => null);
  await setCache(cacheKey, decision, numberEnv("FOCUS_DECISION_CACHE_TTL_SECONDS", 900));
  let row = await upsertStoredDecision({
    userId: options.userId,
    inputHash,
    source,
    scheduledFor: normalizeScheduledFor(options.scheduledFor),
    decision
  });
  await createDecisionHistoryFromFocusDecision({
    userId: options.userId,
    runId: options.runId ?? null,
    source,
    decision,
    candidates: input.candidates.map((candidate) => ({
      symbol: candidate.symbol,
      name: candidate.name,
      riskLevel: candidate.riskLevel,
      latestAnalysis: candidate.latestAnalysis
        ? {
            confidence: candidate.latestAnalysis.confidence,
            trend: candidate.latestAnalysis.trend
          }
        : null
    })),
    createRunItems: Boolean(options.createRunItems)
  }).catch(() => []);
  await refreshAnalysisRun(options.runId).catch(() => null);
  const notification = await notifyFocusDecision({
    userId: options.userId,
    decisionId: row.id,
    source,
    scheduledFor: row.scheduledFor,
    summary: decision.summary,
    fallbackReason: decision.fallbackReason,
    generatedAt: new Date(),
    orders: decision.orders,
    cashReserve: decision.cashReserve,
    totalBudgetToUse: decision.totalBudgetToUse,
    totalEstimatedFee: decision.totalEstimatedFee,
    sellOrders: decision.sellOrders,
    totalSellAmount: decision.totalSellAmount,
    totalSellNetProceeds: decision.totalSellNetProceeds
  }).catch((error) => ({
    skipped: true,
    reason: "send_failed",
    error: error instanceof Error ? error.message : "推送失败"
  }));
  row = await updateStoredDecisionJson(row.id, { ...decision, notification }).catch(() => row);
  const portfolioSnapshot = await loadPortfolioSnapshot(options.userId, seed.capital);
  return attachStoredMetadata(row, { fromCache: false, stale: false }, portfolioSnapshot);
}

async function logFocusDecisionAiUsage(input: {
  userId: string;
  source: string;
  inputHash: string;
  input: DecisionInput;
  decision: Awaited<ReturnType<typeof generateFocusDecision>>;
  cacheHit: boolean;
}) {
  const config = await getAiConfig();
  const promptTokens = Math.ceil(buildDecisionPrompt(input.input).length / 4);
  const completionTokens = Math.ceil(JSON.stringify(input.decision).length / 4);
  await prisma.aiUsageLog.create({
    data: {
      userId: input.userId,
      symbol: null,
      jobType: "focus_decision",
      provider: config.baseUrl.includes("deepseek.com") ? "deepseek" : "openai-compatible",
      model: selectAiModel(config, "flagship"),
      inputHash: input.inputHash,
      promptTokens,
      completionTokens,
      estimatedCost: input.cacheHit ? "0" : estimateAiCost({ config, tier: "flagship", promptTokens, completionTokens }),
      cacheHit: input.cacheHit,
      reason: input.source
    }
  });
}

async function upsertStoredDecision(input: {
  userId: string;
  inputHash: string;
  source: "manual" | "scheduled";
  scheduledFor: Date | null;
  decision: Awaited<ReturnType<typeof generateFocusDecision>>;
}) {
  const decisionJson = JSON.parse(JSON.stringify(input.decision)) as Prisma.InputJsonValue;
  return prisma.focusDecision.upsert({
    where: {
      userId_inputHash_source: {
        userId: input.userId,
        inputHash: input.inputHash,
        source: input.source
      }
    },
    update: {
      scheduledFor: input.scheduledFor,
      decisionJson
    },
    create: {
      userId: input.userId,
      inputHash: input.inputHash,
      source: input.source,
      scheduledFor: input.scheduledFor,
      decisionJson
    }
  });
}

async function updateStoredDecisionJson(id: string, decision: Awaited<ReturnType<typeof generateFocusDecision>> & { notification?: unknown }) {
  return prisma.focusDecision.update({
    where: { id },
    data: {
      decisionJson: JSON.parse(JSON.stringify(decision)) as Prisma.InputJsonValue
    }
  });
}

type StoredFocusDecisionWithFeedback = StoredFocusDecision & {
  feedback?: {
    feedbackAction: string;
    note: string | null;
    executedPrice: unknown;
    executedShares: unknown;
    tradeSymbol: string | null;
    tradeSide: string | null;
    positionSyncedAt: Date | null;
    updatedAt: Date;
  } | null;
};

function attachStoredMetadata(row: StoredFocusDecisionWithFeedback, metadata: { fromCache: boolean; stale: boolean }, portfolioSnapshot?: PortfolioSnapshot) {
  const decision = isRecord(row.decisionJson) ? row.decisionJson : {};
  return {
    ...decision,
    ...(portfolioSnapshot
      ? {
          investedCost: portfolioSnapshot.investedCost,
          availableCash: portfolioSnapshot.availableCash,
          currentMarketValue: portfolioSnapshot.currentMarketValue,
          unrealizedPnl: portfolioSnapshot.unrealizedPnl,
          realizedPnl: portfolioSnapshot.realizedPnl,
          totalAssets: portfolioSnapshot.totalAssets,
          portfolioValuationStatus: portfolioSnapshot.portfolioValuationStatus,
          portfolioSnapshotAt: portfolioSnapshot.portfolioSnapshotAt
        }
      : {}),
    decisionId: row.id,
    persistedAt: row.updatedAt.toISOString(),
    scheduledFor: row.scheduledFor?.toISOString() ?? null,
    source: row.source,
    fromCache: metadata.fromCache,
    stale: metadata.stale,
    feedback: row.feedback
      ? {
          feedbackAction: row.feedback.feedbackAction,
          note: row.feedback.note,
          executedPrice: toNumber(row.feedback.executedPrice),
          executedShares: toNumber(row.feedback.executedShares),
          tradeSymbol: row.feedback.tradeSymbol,
          tradeSide: row.feedback.tradeSide,
          positionSyncedAt: row.feedback.positionSyncedAt?.toISOString() ?? null,
          updatedAt: row.feedback.updatedAt.toISOString()
        }
      : null
  };
}

async function loadPortfolioSnapshot(userId: string, capital: number): Promise<PortfolioSnapshot> {
  const [portfolioItems, tradeExecutions] = await Promise.all([
    prisma.watchlistItem.findMany({
      where: { watchlist: { userId }, isHolding: true },
      select: {
        symbol: true,
        holdingPrice: true,
        holdingShares: true
      }
    }),
    prisma.tradeExecution.findMany({
      where: { userId },
      select: { symbol: true, netCashChange: true, realizedPnl: true }
    })
  ]);
  const portfolioSymbols = [...new Set(portfolioItems.map((item) => item.symbol.toUpperCase()))];
  const quotes = portfolioSymbols.length ? await getQuotesBatch(portfolioSymbols, { allowStale: true }) : {};
  return buildPortfolioSnapshot({
    capital,
    portfolioItems,
    tradeExecutions,
    quotes
  });
}

async function loadDecisionSeed(userId: string) {
  const focus = await prisma.focusGroup.findUnique({ where: { userId } });
  if (!focus?.symbols.length) throw new AppError("BAD_REQUEST", "请先在今日关注中选择股票。");

  const capital = toNumber(focus.capital);
  if (!capital || capital <= 0) throw new AppError("BAD_REQUEST", "请先填写总本金，AI 才能计算策略观察金额。");

  const symbols = [...new Set(focus.symbols.map((symbol) => symbol.toUpperCase()))];
  const allSymbolVariants = uniqueSymbolVariants(symbols);
  const [analyses, watchlistItems, portfolioItems, tradeExecutions] = await Promise.all([
    prisma.aiAnalysis.findMany({
      where: { userId, symbol: { in: allSymbolVariants } },
      orderBy: { createdAt: "desc" },
      take: Math.max(20, symbols.length * 5)
    }),
    prisma.watchlistItem.findMany({
      where: { watchlist: { userId }, symbol: { in: allSymbolVariants } },
      select: {
        symbol: true,
        isHolding: true,
        holdingPrice: true,
        holdingShares: true,
        targetPrice: true,
        stopLoss: true,
        positionOpenedAt: true
      }
    }),
    prisma.watchlistItem.findMany({
      where: { watchlist: { userId }, isHolding: true },
      select: {
        symbol: true,
        holdingPrice: true,
        holdingShares: true,
        positionOpenedAt: true
      }
    }),
    prisma.tradeExecution.findMany({
      where: { userId },
      select: {
        symbol: true,
        side: true,
        shares: true,
        netCashChange: true,
        realizedPnl: true,
        updatedAt: true
      }
    })
  ]);
  const latestAnalysisBySymbol = latestAnalysesForSymbols(symbols, analyses);
  const positionSignature = symbols.map((symbol) => {
    const item = findBySymbol(watchlistItems, symbol, (row) => row.symbol);
    return {
      symbol,
      isHolding: item?.isHolding ?? false,
      holdingPrice: toNumber(item?.holdingPrice),
      holdingShares: toNumber(item?.holdingShares),
      targetPrice: toNumber(item?.targetPrice),
      stopLoss: toNumber(item?.stopLoss),
      positionOpenedAt: item?.positionOpenedAt?.toISOString() ?? null
    };
  });
  const portfolioSignature = portfolioItems
    .map((item) => ({
      symbol: item.symbol.toUpperCase(),
      holdingPrice: toNumber(item.holdingPrice),
      holdingShares: toNumber(item.holdingShares),
      positionOpenedAt: item.positionOpenedAt?.toISOString() ?? null
    }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  const ledgerSignature = buildLedgerSignature(tradeExecutions);

  return {
    userId,
    capital,
    symbols,
    allSymbolVariants,
    focusUpdatedAt: focus.updatedAt.toISOString(),
    focusLastAnalysis: focus.lastAnalysis?.toISOString() ?? null,
    analyses,
    latestAnalysisBySymbol,
    positionSignature,
    portfolioSignature,
    ledgerSignature
  };
}

async function loadDecisionInput(seed: Awaited<ReturnType<typeof loadDecisionSeed>>) {
  const [watchlistItems, portfolioItems, tradeExecutions] = await Promise.all([
    prisma.watchlistItem.findMany({
      where: { watchlist: { userId: seed.userId }, symbol: { in: seed.allSymbolVariants } }
    }),
    prisma.watchlistItem.findMany({
      where: { watchlist: { userId: seed.userId }, isHolding: true },
      select: {
        symbol: true,
        holdingPrice: true,
        holdingShares: true
      }
    }),
    prisma.tradeExecution.findMany({
      where: { userId: seed.userId },
      select: { symbol: true, netCashChange: true, realizedPnl: true }
    })
  ]);
  const portfolioSymbols = [...new Set(portfolioItems.map((item) => item.symbol.toUpperCase()))];
  const quoteSymbols = [...new Set([...seed.symbols, ...portfolioSymbols])];
  const quotes = await getQuotesBatch(quoteSymbols, { allowStale: true });
  const portfolioSnapshot = buildPortfolioSnapshot({
    capital: seed.capital,
    portfolioItems,
    tradeExecutions,
    quotes
  });
  const { investedCost, realizedPnl, availableCash, currentMarketValue, unrealizedPnl, totalAssets } = portfolioSnapshot;

  const candidateDrafts = seed.symbols.map((symbol) => {
    const quote = quotes[symbol] ?? quotes[symbolVariants(symbol).find((item) => quotes[item]) ?? symbol] ?? null;
    const item = findBySymbol(watchlistItems, symbol, (row) => row.symbol);
    const analysis = seed.latestAnalysisBySymbol.get(symbol) ?? null;
    const output = analysis?.outputJson as Candidate["latestAnalysis"] | undefined;
    const analysisInput = asRecord(analysis?.inputJson);
    const analysisDataScope = asRecord(analysisInput.dataScope);
    const analysisIndicators = asRecord(analysisInput.indicators);
    const analysisHistorySummary = asRecord(analysisInput.historySummary);
    const analysisKeyLevels = asRecord(asRecord(output).keyLevels);
    const holdingPrice = toNumber(item?.holdingPrice);
    const keyLevels = {
      support: numberArray(analysisKeyLevels.support),
      resistance: numberArray(analysisKeyLevels.resistance)
    };
    const sectorKey = inferSectorKey({ symbol, name: quote?.name ?? null, note: item?.note ?? null, latestAnalysis: output });
    const quantInput: QuantInput = {
      price: quote?.price ?? null,
      symbol: quote?.symbol ?? symbol,
      name: quote?.name ?? null,
      sectorKey,
      changePct: quote?.changePct ?? null,
      indicators: {
        rsi14: toNumber(analysisIndicators.rsi14),
        macd: toNumber(analysisIndicators.macd),
        macdSignal: toNumber(analysisIndicators.macdSignal),
        sma20: toNumber(analysisIndicators.sma20),
        sma50: toNumber(analysisIndicators.sma50),
        sma200: toNumber(analysisIndicators.sma200),
        ema20: toNumber(analysisIndicators.ema20),
        bollingerUpper: toNumber(analysisIndicators.bollingerUpper),
        bollingerMiddle: toNumber(analysisIndicators.bollingerMiddle),
        bollingerLower: toNumber(analysisIndicators.bollingerLower)
      },
      historySummary: {
        averageVolume: toNumber(analysisHistorySummary.averageVolume),
        recentVolume: toNumber(analysisHistorySummary.recentVolume),
        high: toNumber(analysisHistorySummary.high),
        low: toNumber(analysisHistorySummary.low),
        changePercent: toNumber(analysisHistorySummary.changePercent)
      },
      keyLevels,
      isHolding: item?.isHolding ?? false,
      holdingPrice,
      holdingShares: toNumber(item?.holdingShares),
      positionOpenedAt: item?.positionOpenedAt ?? null,
      targetPrice: toNumber(item?.targetPrice),
      stopLoss: toNumber(item?.stopLoss)
    };
    return {
      symbol: quote?.symbol ?? symbol,
      name: quote?.name ?? null,
      sectorKey,
      price: quote?.price ?? null,
      changePct: quote?.changePct ?? null,
      quoteTime: quote?.updatedAt ?? null,
      analysisGeneratedAt: analysis?.createdAt.toISOString() ?? null,
      analysisDataScope: {
        quoteTime: toNullableString(analysisDataScope.quoteTime),
        historyTo: toNullableString(analysisDataScope.historyTo),
        historyRange: toNullableString(analysisDataScope.historyRange),
        historyInterval: toNullableString(analysisDataScope.historyInterval),
        historyCandles: toNumber(analysisDataScope.historyCandles)
      },
      status: quote?.status ?? "unavailable",
      note: item?.note ?? null,
      riskLevel: item?.riskLevel,
      isHolding: item?.isHolding ?? false,
      holdingPrice,
      holdingShares: toNumber(item?.holdingShares),
      positionOpenedAt: item?.positionOpenedAt ?? null,
      targetPrice: toNumber(item?.targetPrice),
      stopLoss: toNumber(item?.stopLoss),
      latestAnalysis: output
        ? {
            trend: output.trend,
            confidence: output.confidence,
            summary: output.summary,
            newsSummary: typeof asRecord(output).newsSummary === "string" ? String(asRecord(output).newsSummary) : undefined,
            newsSentiment: typeof asRecord(output).newsSentiment === "string" ? String(asRecord(output).newsSentiment) : undefined,
            newsReferences: asRecord(output).newsReferences,
            sectorRisks: asRecord(output).sectorRisks,
            holdAdvice: output.holdAdvice,
            entryAdvice: output.entryAdvice,
            riskFactors: output.riskFactors
          }
        : null,
      quantSignal: null,
      quantInput
    } satisfies Candidate & { quantInput: QuantInput };
  });
  const marketContext = buildDecisionMarketContext(candidateDrafts);
  const candidates = candidateDrafts.map(({ quantInput, ...candidate }) => ({
    ...candidate,
    quantSignal: buildQuantSignal({
      ...quantInput,
      strategyContext: marketContext
    })
  }));

  return {
    capital: seed.capital,
    investedCost,
    availableCash,
    currentMarketValue,
    unrealizedPnl,
    realizedPnl,
    totalAssets,
    marketContext,
    candidates,
    dataScope: buildDecisionDataScope(candidates),
    focusUpdatedAt: seed.focusUpdatedAt,
    focusLastAnalysis: seed.focusLastAnalysis,
    latestAnalysisIds: [...seed.latestAnalysisBySymbol.values()].map((analysis) => analysis.id)
  };
}

function buildDecisionDataScope(candidates: Candidate[]): DecisionInput["dataScope"] {
  const quoteTimes = candidates.map((candidate) => ({
    symbol: candidate.symbol,
    quoteTime: candidate.quoteTime ?? candidate.analysisDataScope?.quoteTime ?? null,
    status: candidate.status
  }));
  const historyTimes = candidates.map((candidate) => ({
    symbol: candidate.symbol,
    historyTo: candidate.analysisDataScope?.historyTo ?? null,
    historyRange: candidate.analysisDataScope?.historyRange ?? null,
    historyInterval: candidate.analysisDataScope?.historyInterval ?? null,
    historyCandles: candidate.analysisDataScope?.historyCandles ?? null
  }));
  return {
    latestQuoteTime: latestIso(quoteTimes.map((item) => item.quoteTime)),
    latestHistoryTo: latestIso(historyTimes.map((item) => item.historyTo)),
    latestAnalysisGeneratedAt: latestIso(candidates.map((candidate) => candidate.analysisGeneratedAt ?? null)),
    quoteTimes,
    historyTimes
  };
}

function buildDecisionMarketContext(candidates: Array<Candidate & { quantInput?: QuantInput }>): QuantStrategyContext {
  const usable = candidates.filter((candidate) => candidate.price && candidate.price > 0);
  const avgChange = average(usable.map((candidate) => candidate.changePct).filter(isFiniteNumber));
  const bullishCount = candidates.filter((candidate) => candidate.latestAnalysis?.trend === "bullish").length;
  const bearishCount = candidates.filter((candidate) => candidate.latestAnalysis?.trend === "bearish").length;
  const positiveNewsCount = candidates.filter((candidate) => isPositiveSentiment(candidate.latestAnalysis?.newsSentiment)).length;
  const negativeNewsCount = candidates.filter((candidate) => isNegativeSentiment(candidate.latestAnalysis?.newsSentiment)).length;
  const overheatedCount = candidates.filter((candidate) => {
    const text = stringifyAdvice(candidate.latestAnalysis?.summary) + stringifyAdvice(candidate.latestAnalysis?.riskFactors);
    return /超买|追高|过热|短期涨幅|获利回吐|泡沫|兑现/.test(text);
  }).length;

  const marketRegime =
    negativeNewsCount >= positiveNewsCount + 2 || (avgChange !== null && avgChange <= -2) || bearishCount > bullishCount + 1
      ? "risk_off"
      : bullishCount >= bearishCount + 2 && positiveNewsCount >= negativeNewsCount && (avgChange === null || avgChange >= -0.8)
        ? "risk_on"
        : "neutral";

  const sectorBiases: Record<string, QuantSectorBias> = {};
  const bySector = groupBy(candidates, (candidate) => candidate.sectorKey ?? "unknown");
  for (const [sector, rows] of Object.entries(bySector)) {
    const sectorChange = average(rows.map((candidate) => candidate.changePct).filter(isFiniteNumber));
    const sectorBullish = rows.filter((candidate) => candidate.latestAnalysis?.trend === "bullish").length;
    const sectorBearish = rows.filter((candidate) => candidate.latestAnalysis?.trend === "bearish").length;
    const sectorPositive = rows.filter((candidate) => isPositiveSentiment(candidate.latestAnalysis?.newsSentiment)).length;
    const sectorNegative = rows.filter((candidate) => isNegativeSentiment(candidate.latestAnalysis?.newsSentiment)).length;
    const sectorOverheated = rows.some((candidate) => {
      const text = [
        candidate.latestAnalysis?.summary,
        candidate.latestAnalysis?.newsSummary,
        stringifyAdvice(candidate.latestAnalysis?.riskFactors)
      ].filter(Boolean).join(" ");
      return /超买|过热|追高|大涨|短期涨幅|获利回吐|兑现/.test(text);
    });
    sectorBiases[sector] =
      sectorNegative > sectorPositive || sectorBearish > sectorBullish
        ? "bearish"
        : sectorOverheated && sectorBullish >= sectorBearish
          ? "overheated"
          : sectorBullish > sectorBearish || sectorPositive > sectorNegative || (sectorChange !== null && sectorChange >= 1.2)
            ? "bullish"
            : "neutral";
  }

  const notes = [
    `市场环境：${marketRegimeLabel(marketRegime)}，候选平均涨跌幅 ${avgChange === null ? "--" : `${avgChange.toFixed(2)}%`}。`,
    `趋势分布：偏多 ${bullishCount}，偏空 ${bearishCount}；新闻情绪：正面 ${positiveNewsCount}，负面 ${negativeNewsCount}。`,
    overheatedCount ? `有 ${overheatedCount} 只标的出现追高/过热/兑现风险，买入需等待回调或突破确认。` : "未检测到明显集中过热风险。"
  ];

  if (marketRegime === "risk_off") {
    return {
      marketRegime,
      buyThresholdDelta: 8,
      sellThresholdDelta: -6,
      maxPositionPct: 20,
      allowAdd: false,
      avoidChasing: true,
      notes,
      sectorBiases
    };
  }
  if (marketRegime === "risk_on") {
    return {
      marketRegime,
      buyThresholdDelta: -3,
      sellThresholdDelta: 3,
      maxPositionPct: 35,
      allowAdd: true,
      avoidChasing: true,
      notes,
      sectorBiases
    };
  }
  return {
    marketRegime,
    buyThresholdDelta: 0,
    sellThresholdDelta: 0,
    maxPositionPct: 30,
    allowAdd: true,
    avoidChasing: true,
    notes,
    sectorBiases
  };
}

function inferSectorKey(input: { symbol: string; name?: string | null; note?: string | null; latestAnalysis?: unknown }) {
  const text = `${input.symbol} ${input.name ?? ""} ${input.note ?? ""} ${JSON.stringify(input.latestAnalysis ?? {})}`;
  if (/半导体|芯片|集成电路|晶圆|存储|AI芯片|中韩/.test(text)) return "semiconductor";
  if (/纳指|NASDAQ|纳斯达克|美股|QDII/i.test(text)) return "nasdaq";
  if (/通信|5G|光模块|光通信|算力网络|数据中心/.test(text)) return "telecom_ai";
  if (/电网|电力设备|特高压|输变电|配电网|国家电网|南方电网/.test(text)) return "power_grid";
  if (/黄金|金价|贵金属|避险/.test(text)) return "gold";
  if (/卫星|航天|军工|商业航天|低空/.test(text)) return "satellite";
  if (/新能源|电池|宁德|汽车|电动车/.test(text)) return "new_energy";
  return "unknown";
}

function marketRegimeLabel(value: QuantStrategyContext["marketRegime"]) {
  if (value === "risk_on") return "偏进攻";
  if (value === "risk_off") return "偏防守";
  return "中性";
}

function isPositiveSentiment(value?: string | null) {
  return /positive|bullish|利好|正面|偏正/.test(String(value ?? ""));
}

function isNegativeSentiment(value?: string | null) {
  return /negative|bearish|利空|负面|偏负/.test(String(value ?? ""));
}

function average(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function groupBy<T>(items: T[], keyFn: (item: T) => string) {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const key = keyFn(item);
    acc[key] = acc[key] ?? [];
    acc[key].push(item);
    return acc;
  }, {});
}

function createDecisionSignature(input: Awaited<ReturnType<typeof loadDecisionSeed>>) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        capital: input.capital,
        symbols: input.symbols,
        focusUpdatedAt: input.focusUpdatedAt,
        focusLastAnalysis: input.focusLastAnalysis,
        positionSignature: input.positionSignature,
        portfolioSignature: input.portfolioSignature,
        ledgerSignature: input.ledgerSignature,
        latestAnalysisIds: [...input.latestAnalysisBySymbol.values()].map((analysis) => analysis.id)
      })
    )
    .digest("hex")
    .slice(0, 16);
}

async function generateFocusDecision(input: DecisionInput) {
  const config = await getAiConfig();
  if (!config.apiKey) return buildFallbackDecision(input, "AI API key 未配置，已使用本地规则生成临时决策。");

  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl || undefined });
  const request: ChatCompletionCreateParamsNonStreaming = {
    model: selectAiModel(config, "flagship"),
    temperature: 0.2,
    max_tokens: numberEnv("AI_FOCUS_DECISION_MAX_TOKENS", 1400),
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: FOCUS_DECISION_SYSTEM_PROMPT
      },
      { role: "user", content: buildDecisionPrompt(input) }
    ]
  };

  try {
    const completion = await createChatCompletion(client, request);
    const text = completion.choices[0]?.message?.content;
    if (!text) throw new Error("AI 返回了空内容。");
    const parsed = decisionSchema.parse(parseJsonObject(text));
    return normalizeDecision(parsed, input, null);
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return buildFallbackDecision(input, `AI 决策生成失败，已使用本地规则生成临时决策。原因：${message}`);
  }
}

function normalizeDecision(value: DecisionSchemaValue, input: DecisionInput, fallbackReason: string | null) {
  const candidatesBySymbol = new Map(input.candidates.map((candidate) => [candidate.symbol, candidate]));
  let spent = 0;
  const orders = value.orders
    .filter((order) => order.action === "buy" || order.action === "add")
    .filter((order) => {
      const candidate = candidatesBySymbol.get(order.symbol) ?? input.candidates.find((item) => sameSymbol(item.symbol, order.symbol));
      return quantAllowsBuy(candidate);
    })
    .slice(0, 2)
    .map((order) => {
      const candidate = candidatesBySymbol.get(order.symbol) ?? input.candidates.find((item) => sameSymbol(item.symbol, order.symbol));
      const price = candidate?.price ?? 0;
      const remainingCash = Math.max(0, input.availableCash - spent);
      const shares = normalizeShares(order.shares || sharesFromAmount(order.amount, price), price, remainingCash);
      const amount = price > 0 ? Number((shares * price).toFixed(2)) : Number(order.amount.toFixed(2));
      const fee = calculateFocusTradeFee(amount);
      if (amount + fee > remainingCash) return null;
      const planMeta = buildBuyPlanMeta({ order, candidate, price, shares });
      spent += amount + fee;
      return {
        ...order,
        action: candidate?.isHolding ? ("add" as const) : ("buy" as const),
        symbol: candidate?.symbol ?? order.symbol,
        name: candidate?.name ?? null,
        estimatedPrice: price || null,
        shares,
        amount,
        ...planMeta,
        estimatedFee: fee,
        totalCost: Number((amount + fee).toFixed(2)),
        feeRule: TRADING_FEE_RULE.description
      };
    })
    .filter((order): order is NonNullable<typeof order> => Boolean(order && order.shares > 0 && order.amount > 0));
  const sellOrderCandidates = withRequiredQuantSellOrders(value.sellOrders, input, value.ranking);
  const sellOrders = sellOrderCandidates
    .filter((order) => order.action === "sell" || order.action === "reduce")
    .filter((order) => {
      const candidate = candidatesBySymbol.get(order.symbol) ?? input.candidates.find((item) => sameSymbol(item.symbol, order.symbol));
      return quantAllowsSell(candidate) || aiRankingClaimsSell(value.ranking, candidate);
    })
    .slice(0, 3)
    .map((order) => {
      const candidate = candidatesBySymbol.get(order.symbol) ?? input.candidates.find((item) => sameSymbol(item.symbol, order.symbol));
      const price = candidate?.price ?? 0;
      const holdingShares = candidate?.isHolding ? candidate.holdingShares ?? 0 : 0;
      const shares = normalizeSellShares(order.shares || sharesFromAmount(order.amount, price) || candidate?.quantSignal?.suggestedSellShares || 0, holdingShares);
      const amount = price > 0 ? Number((shares * price).toFixed(2)) : Number(order.amount.toFixed(2));
      const fee = calculateFocusTradeFee(amount);
      const netProceeds = Number((amount - fee).toFixed(2));
      const estimatedPnl = calculateSellPnl({
        sellAmount: amount,
        sellFee: fee,
        shares,
        holdingPrice: candidate?.holdingPrice ?? null
      });
      const planMeta = buildSellPlanMeta({ order, candidate, price, shares, holdingShares });
      return {
        ...order,
        action: shares >= holdingShares ? ("sell" as const) : order.action,
        symbol: candidate?.symbol ?? order.symbol,
        name: candidate?.name ?? null,
        estimatedPrice: price || null,
        shares,
        amount,
        ...planMeta,
        estimatedFee: fee,
        netProceeds,
        estimatedPnl,
        feeRule: TRADING_FEE_RULE.description
      };
    })
    .filter((order) => order.shares > 0 && order.amount > 0);
  const normalizedAction = sellOrders.length && orders.length ? "mixed" : sellOrders.length ? "sell" : orders.length ? "buy" : "wait";
  const summary = alignSummaryWithStructuredPlan(value.summary, value, input, orders, sellOrders, normalizedAction);
  const buyFee = Number(orders.reduce((sum, order) => sum + order.estimatedFee, 0).toFixed(2));
  const sellFee = Number(sellOrders.reduce((sum, order) => sum + order.estimatedFee, 0).toFixed(2));
  const totalSellNetProceeds = Number(sellOrders.reduce((sum, order) => sum + order.netProceeds, 0).toFixed(2));
  const ranking = normalizeRankingItems(value.ranking, input, orders, sellOrders);

  return {
    ...value,
    recommendedAction: normalizedAction,
    summary,
    orders,
    sellOrders,
    ranking,
    totalBudgetToUse: Number(orders.reduce((sum, order) => sum + order.amount, 0).toFixed(2)),
    totalSellAmount: Number(sellOrders.reduce((sum, order) => sum + order.amount, 0).toFixed(2)),
    totalEstimatedFee: Number((buyFee + sellFee).toFixed(2)),
    totalBuyEstimatedFee: buyFee,
    totalSellEstimatedFee: sellFee,
    totalEstimatedCost: Number(orders.reduce((sum, order) => sum + order.totalCost, 0).toFixed(2)),
    totalSellNetProceeds,
    cashReserve: Number((input.availableCash - orders.reduce((sum, order) => sum + order.totalCost, 0) + totalSellNetProceeds).toFixed(2)),
    capital: input.capital,
    investedCost: input.investedCost,
    availableCash: input.availableCash,
    currentMarketValue: input.currentMarketValue,
    unrealizedPnl: input.unrealizedPnl,
    realizedPnl: input.realizedPnl,
    totalAssets: input.totalAssets,
    dataScope: input.dataScope,
    marketContext: input.marketContext,
    feeRule: TRADING_FEE_RULE,
    fallbackReason,
    generatedAt: new Date().toISOString()
  };
}

function buildBuyPlanMeta(input: {
  order: DecisionSchemaValue["orders"][number];
  candidate?: Candidate | null;
  price: number;
  shares: number;
}) {
  const triggerPrice = normalizedPrice(input.order.triggerPrice) ?? normalizedPrice(input.price);
  const stopLossPrice = normalizedPrice(input.order.stopLossPrice) ?? normalizedPrice(input.candidate?.stopLoss) ?? normalizedPriceFromText(input.candidate?.quantSignal?.stopLoss);
  const takeProfitPrice = normalizedPrice(input.order.takeProfitPrice) ?? normalizedPrice(input.candidate?.targetPrice) ?? normalizedPriceFromText(input.candidate?.quantSignal?.takeProfit);
  return {
    planType: input.order.planType ?? inferBuyPlanType(input.candidate),
    triggerPrice,
    stopLossPrice,
    takeProfitPrice,
    maxLossAmount: normalizedMoney(input.order.maxLossAmount) ?? estimateMaxLossAmount({ shares: input.shares, triggerPrice, stopLossPrice }),
    riskRewardRatio: normalizedRatio(input.order.riskRewardRatio) ?? input.candidate?.quantSignal?.riskRewardRatio ?? estimateRiskRewardRatio({ triggerPrice, stopLossPrice, takeProfitPrice }),
    priority: input.order.priority ?? priorityFromBuyCandidate(input.candidate)
  };
}

function buildSellPlanMeta(input: {
  order: DecisionSchemaValue["sellOrders"][number];
  candidate?: Candidate | null;
  price: number;
  shares: number;
  holdingShares: number;
}) {
  const triggerPrice = normalizedPrice(input.order.triggerPrice) ?? normalizedPrice(input.price);
  const stopLossPrice = normalizedPrice(input.order.stopLossPrice) ?? normalizedPrice(input.candidate?.stopLoss) ?? normalizedPriceFromText(input.candidate?.quantSignal?.stopLoss);
  const takeProfitPrice = normalizedPrice(input.order.takeProfitPrice) ?? normalizedPrice(input.candidate?.targetPrice) ?? normalizedPriceFromText(input.candidate?.quantSignal?.takeProfit);
  return {
    triggerPrice,
    stopLossPrice,
    takeProfitPrice,
    sellRatioPct: normalizedRatio(input.order.sellRatioPct) ?? percent(input.shares, input.holdingShares),
    priority: input.order.priority ?? priorityFromSellCandidate(input.candidate)
  };
}

function inferBuyPlanType(candidate?: Candidate | null): DecisionSchemaValue["orders"][number]["planType"] {
  const signal = candidate?.quantSignal;
  if (candidate?.isHolding) return "add_on_strength";
  if (signal?.marketRegime === "risk_off") return "support";
  if (signal?.sectorBias === "overheated") return "pullback";
  if ((signal?.supportDistancePct ?? 99) <= 3.5) return "support";
  if ((signal?.buyScore ?? 0) >= (signal?.adjustedBuyThreshold ?? 70) + 6) return "breakout";
  return "trend_follow";
}

function priorityFromBuyCandidate(candidate?: Candidate | null) {
  const signal = candidate?.quantSignal;
  if (!signal) return 4;
  if (signal.marketRegime === "risk_off") return 4;
  if (signal.buyScore >= signal.adjustedBuyThreshold + 8 && (signal.riskRewardRatio ?? 0) >= 1.8) return 1;
  if (signal.buyScore >= signal.adjustedBuyThreshold + 4) return 2;
  return 3;
}

function priorityFromSellCandidate(candidate?: Candidate | null) {
  const signal = candidate?.quantSignal;
  if (!signal) return 3;
  if (signal.action === "sell" || signal.sellScore >= signal.adjustedSellThreshold) return 1;
  if (signal.action === "reduce" || signal.sellScore >= signal.adjustedReduceThreshold) return 2;
  return 3;
}

function normalizeRankingItems(
  ranking: DecisionSchemaValue["ranking"],
  input: DecisionInput,
  orders: Array<{ symbol: string }>,
  sellOrders: Array<{ symbol: string }>
) {
  const candidatesBySymbol = new Map(input.candidates.flatMap((candidate) => symbolVariants(candidate.symbol).map((symbol) => [symbol, candidate] as const)));
  const buySymbols = symbolVariantSet(orders.map((order) => order.symbol));
  const sellSymbols = symbolVariantSet(sellOrders.map((order) => order.symbol));
  const covered = symbolVariantSet(ranking.map((item) => item.symbol));
  const normalized = ranking.map((item) => {
    const candidate = candidatesBySymbol.get(item.symbol.toUpperCase());
    if (!candidate) return item;
    const hasBuy = hasSymbolVariant(buySymbols, candidate.symbol);
    const hasSell = hasSymbolVariant(sellSymbols, candidate.symbol);
    if (hasBuy || hasSell) return { ...item, symbol: candidate.symbol };

    const claimedBuy = /买入|增持|加仓|优先/.test(`${item.view} ${item.reason}`);
    const claimedSell = /卖出|减仓|止盈|止损|离场/.test(`${item.view} ${item.reason}`);
    if (claimedBuy || claimedSell || !candidateHasFreshQuote(candidate)) {
      return {
        ...item,
        symbol: candidate.symbol,
        view: candidate.isHolding ? "持有观察" : "观察",
        reason: normalizeBlockedRankingReason(candidate, claimedBuy, claimedSell)
      };
    }
    return { ...item, symbol: candidate.symbol };
  });

  for (const candidate of input.candidates) {
    if (hasSymbolVariant(covered, candidate.symbol)) continue;
    normalized.push({
      symbol: candidate.symbol,
      rank: normalized.length + 1,
      view: candidateHasFreshQuote(candidate) ? quantView(candidate) : "观察",
      reason: candidateHasFreshQuote(candidate) ? quantReason(candidate) : normalizeBlockedRankingReason(candidate, true, false)
    });
  }

  return normalized
    .sort((a, b) => a.rank - b.rank)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function normalizeBlockedRankingReason(candidate: Candidate, claimedBuy: boolean, claimedSell: boolean) {
  if (!candidateHasFreshQuote(candidate)) {
    return `行情不新鲜或报价不可用（status=${candidate.status}，quoteTime=${candidate.quoteTime ?? "无"}），已禁止生成买入/增持计划。${quantReason(candidate)}`;
  }
  if (claimedSell && !quantAllowsSell(candidate)) {
    return `卖出/减仓未通过本地量化阈值，已降级为观察。${quantReason(candidate)}`;
  }
  if (claimedBuy && !quantAllowsBuy(candidate)) {
    return `买入/增持未通过本地量化、现金、行情新鲜度或交易单位校验，已降级为观察。${quantReason(candidate)}`;
  }
  return quantReason(candidate);
}

function withRequiredQuantSellOrders(
  orders: DecisionSchemaValue["sellOrders"],
  input: DecisionInput,
  ranking: DecisionSchemaValue["ranking"]
): DecisionSchemaValue["sellOrders"] {
  const output = orders.filter((order) => (order.shares ?? 0) > 0 || (order.amount ?? 0) > 0);
  const existing = symbolVariantSet(output.map((order) => order.symbol));
  for (const candidate of input.candidates) {
    const rankingClaimsSell = aiRankingClaimsSell(ranking, candidate);
    if (!candidateSupportsSell(candidate) && !rankingClaimsSell) continue;
    if (hasSymbolVariant(existing, candidate.symbol)) continue;
    const shares = candidate.quantSignal?.suggestedSellShares || fallbackSellShares(candidate.holdingShares ?? 0, stringifyAdvice(candidate.latestAnalysis?.holdAdvice));
    if (!shares || shares <= 0) continue;
    output.push({
      symbol: candidate.symbol,
      action: candidate.quantSignal?.action === "sell" ? "sell" : "reduce",
      amount: candidate.price && candidate.price > 0 ? Number((shares * candidate.price).toFixed(2)) : 0,
      shares,
      reason: buildRequiredSellReason(candidate, rankingClaimsSell),
      riskControl: candidate.quantSignal?.exitPlan || "若风险信号消失、价格重新站回关键支撑并且量化卖出分回落，可取消减仓观察。",
      invalidIf: "最新行情或单股分析显示卖出分低于阈值，且价格重新回到安全趋势区间。"
    });
    for (const symbol of symbolVariants(candidate.symbol)) existing.add(symbol);
  }
  return output;
}

function aiRankingClaimsSell(ranking: DecisionSchemaValue["ranking"], candidate?: Candidate | null) {
  if (!candidate?.isHolding || !candidate.holdingShares || candidate.holdingShares < TRADING_FEE_RULE.lotSize) return false;
  const signal = candidate.quantSignal;
  if (
    signal?.action === "sell" ||
    signal?.action === "reduce" ||
    (signal?.suggestedSellShares ?? 0) >= TRADING_FEE_RULE.lotSize ||
    (signal?.suggestedSellRatioPct ?? 0) > 0
  ) {
    return true;
  }
  return ranking.some((item) => {
    if (!sameSymbol(item.symbol, candidate.symbol)) return false;
    const text = `${item.view} ${item.reason}`;
    if (/未触发|建议股数\s*0|建议卖出比例\s*0|卖出比例\s*0|继续观察|持有观察/.test(text)) return false;
    return /止损|离场|清仓|全部卖出|强制风控|跌破止损|破位退出/.test(text);
  });
}

function buildRequiredSellReason(candidate: Candidate, rankingClaimsSell = false) {
  const signal = candidate.quantSignal;
  const parts = [
    rankingClaimsSell
      ? "AI 排名理由已触发减仓/止盈语义，但未返回结构化 sellOrders，系统自动补齐减仓/卖出计划。"
      : "本地量化规则触发持仓风控，AI 未返回结构化 sellOrders，系统自动补齐减仓/卖出计划。",
    signal ? `卖出分 ${signal.sellScore}，建议卖出比例 ${signal.suggestedSellRatioPct}%，建议股数 ${signal.suggestedSellShares} 股/份。` : "",
    signal?.holdingReturnPct !== null && signal?.holdingReturnPct !== undefined ? `当前持仓收益约 ${signal.holdingReturnPct}%。` : "",
    signal?.risks?.length ? `主要风险：${signal.risks.slice(0, 2).join("；")}` : ""
  ];
  return parts.filter(Boolean).join(" ");
}

function alignSummaryWithStructuredPlan(
  summary: string,
  value: DecisionSchemaValue,
  input: DecisionInput,
  orders: Array<{ symbol: string; name?: string | null }>,
  sellOrders: Array<{ symbol: string; name?: string | null }>,
  normalizedAction: "buy" | "sell" | "mixed" | "wait"
) {
  const unsupportedSellClaims = detectUnsupportedSellClaims(value, input, sellOrders);
  const planText = describeStructuredPlan(orders, sellOrders, normalizedAction);
  const ignoredSellText = unsupportedSellClaims.length
    ? `；已忽略未通过本地量化/持仓校验的卖出表述：${unsupportedSellClaims.join("、")}`
    : "";
  const prefix = normalizedAction === "wait" && value.recommendedAction !== "wait"
    ? "当前没有形成可执行的交易情景，已改为等待。"
    : "";
  if (planText || ignoredSellText || prefix) {
    return `${prefix}${planText}${ignoredSellText}。AI 原始理由：${summary}`;
  }
  return summary;
}

function describeStructuredPlan(
  orders: Array<{ symbol: string; name?: string | null }>,
  sellOrders: Array<{ symbol: string; name?: string | null }>,
  normalizedAction: "buy" | "sell" | "mixed" | "wait"
) {
  if (normalizedAction === "wait") return "";
  const buyText = orders.length ? `实际可执行买入/增持计划：${orders.map(orderLabel).join("、")}` : "";
  const sellText = sellOrders.length ? `实际可执行卖出/减仓计划：${sellOrders.map(orderLabel).join("、")}` : "";
  return [buyText, sellText].filter(Boolean).join("；");
}

function detectUnsupportedSellClaims(
  value: DecisionSchemaValue,
  input: DecisionInput,
  sellOrders: Array<{ symbol: string; name?: string | null }>
) {
  const supportedSellSymbols = symbolVariantSet(sellOrders.map((order) => order.symbol));
  return input.candidates
    .filter((candidate) => candidate.isHolding)
    .filter((candidate) => !hasSymbolVariant(supportedSellSymbols, candidate.symbol))
    .filter((candidate) => {
      const rankingText = findBySymbol(value.ranking, candidate.symbol, (item) => item.symbol);
      const text = `${value.summary} ${rankingText ? `${rankingText.view} ${rankingText.reason}` : ""}`;
      return textMentionsCandidate(text, candidate) && /减仓|卖出|止盈|止损|离场|兑现|降低仓位/.test(text);
    })
    .map(orderLabel)
    .slice(0, 3);
}

function textMentionsCandidate(text: string, candidate: Candidate) {
  const aliases = [candidate.symbol, ...symbolVariants(candidate.symbol), candidate.name ?? ""]
    .filter(Boolean)
    .map((item) => item.toUpperCase());
  const upper = text.toUpperCase();
  return aliases.some((alias) => alias && upper.includes(alias));
}

function uniqueSymbolVariants(symbols: string[]) {
  return [...new Set(symbols.flatMap(symbolVariants))];
}

function symbolVariantSet(symbols: string[]) {
  return new Set(uniqueSymbolVariants(symbols));
}

function hasSymbolVariant(symbols: Set<string>, symbol: string) {
  return symbolVariants(symbol).some((variant) => symbols.has(variant));
}

function findBySymbol<T>(items: T[], symbol: string, getSymbol: (item: T) => string | null | undefined) {
  return items.find((item) => sameSymbol(getSymbol(item), symbol)) ?? null;
}

function normalizedPrice(value: unknown) {
  const number = toNumber(value);
  return number !== null && number > 0 ? Number(number.toFixed(4)) : null;
}

function normalizedPriceFromText(value?: string | null) {
  if (!value || value === "--") return null;
  const match = value.match(/-?\d+(?:\.\d+)?/);
  return match ? normalizedPrice(match[0]) : null;
}

function normalizedMoney(value: unknown) {
  const number = toNumber(value);
  return number !== null && number >= 0 ? Number(number.toFixed(2)) : null;
}

function normalizedRatio(value: unknown) {
  const number = toNumber(value);
  return number !== null && number >= 0 ? Number(number.toFixed(2)) : null;
}

function estimateMaxLossAmount(input: { shares: number; triggerPrice: number | null; stopLossPrice: number | null }) {
  if (!input.shares || !input.triggerPrice || !input.stopLossPrice || input.triggerPrice <= input.stopLossPrice) return null;
  return Number(((input.triggerPrice - input.stopLossPrice) * input.shares).toFixed(2));
}

function estimateRiskRewardRatio(input: { triggerPrice: number | null; stopLossPrice: number | null; takeProfitPrice: number | null }) {
  if (!input.triggerPrice || !input.stopLossPrice || !input.takeProfitPrice) return null;
  const risk = input.triggerPrice - input.stopLossPrice;
  const reward = input.takeProfitPrice - input.triggerPrice;
  if (risk <= 0 || reward <= 0) return null;
  return Number((reward / risk).toFixed(2));
}

function percent(part: number, total: number) {
  if (!total || total <= 0) return null;
  return Number(Math.min(100, Math.max(0, (part / total) * 100)).toFixed(2));
}

function orderLabel(input: { symbol: string; name?: string | null }) {
  return input.name ? `${input.name}（${input.symbol}）` : input.symbol;
}

function buildFallbackDecision(input: DecisionInput, reason: string) {
  const sellCandidates = input.candidates.filter(candidateSupportsSell);
  const ranked = input.candidates
    .filter(candidateSupportsBuy)
    .sort((a, b) => (b.quantSignal?.buyScore ?? 0) - (a.quantSignal?.buyScore ?? 0) || (b.latestAnalysis?.confidence ?? 0) - (a.latestAnalysis?.confidence ?? 0));
  const best = ranked[0];
  const sellTarget = sellCandidates[0];
  if ((!best?.price || (best.latestAnalysis?.confidence ?? 0) < 0.55) && !sellTarget?.price) {
    return normalizeDecision(
      {
        summary: "当前没有足够清晰的买入候选，建议等待更高置信度的信号。",
        recommendedAction: "wait",
        totalBudgetToUse: 0,
        cashReserve: input.availableCash,
        orders: [],
        sellOrders: [],
        ranking: input.candidates.map((candidate, index) => ({
          symbol: candidate.symbol,
          rank: index + 1,
          view: quantView(candidate),
          reason: quantReason(candidate)
        })),
        disclaimer: "本内容由本地规则生成，仅供研究参考，不构成投资建议。"
      },
      input,
      reason
    );
  }

  if (sellTarget?.price) {
    const sellShares = fallbackSellShares(sellTarget.holdingShares ?? 0, stringifyAdvice(sellTarget.latestAnalysis?.holdAdvice));
    return normalizeDecision(
      {
        summary: `本地规则检测到 ${sellTarget.symbol} 持仓风险信号，优先生成减仓观察计划，仍需等待真实 AI 服务恢复后复核。`,
        recommendedAction: "sell",
        totalBudgetToUse: 0,
        cashReserve: input.availableCash,
        orders: [],
        sellOrders: [
          {
            symbol: sellTarget.symbol,
            action: /止损|离场|回避/.test(stringifyAdvice(sellTarget.latestAnalysis?.holdAdvice)) ? "sell" : "reduce",
            amount: sellShares * sellTarget.price,
            shares: sellShares,
            triggerPrice: sellTarget.price,
            stopLossPrice: normalizedPrice(sellTarget.stopLoss) ?? normalizedPriceFromText(sellTarget.quantSignal?.stopLoss),
            takeProfitPrice: normalizedPrice(sellTarget.targetPrice) ?? normalizedPriceFromText(sellTarget.quantSignal?.takeProfit),
            sellRatioPct: sellTarget.holdingShares ? percent(sellShares, sellTarget.holdingShares) : null,
            priority: sellTarget.quantSignal?.action === "sell" ? 1 : 2,
            reason: `已持仓，最近分析出现减仓/止损/风险规避信号。${sellTarget.latestAnalysis?.summary ?? ""}`,
            riskControl: "若价格重新站回关键支撑且单股分析转为持有，可取消减仓计划；否则按止损/减仓条件执行观察。",
            invalidIf: "AI 服务恢复后结论相反，或价格重新回到持仓计划的安全区间。"
          }
        ],
        ranking: input.candidates.map((candidate, index) => ({
          symbol: candidate.symbol,
          rank: index + 1,
          view: sameSymbol(candidate.symbol, sellTarget.symbol) ? "减仓/卖出" : quantView(candidate),
          reason: quantReason(candidate)
        })),
        disclaimer: "本内容由本地规则生成，仅供研究参考，不构成投资建议。"
      },
      input,
      reason
    );
  }

  const targetAmount = Math.min(input.availableCash, input.capital * 0.3, Math.max(0, input.availableCash - TRADING_FEE_RULE.minimumFee));
  return normalizeDecision(
    {
      summary: `本地规则优先选择 ${best.symbol}，但仍需等待真实 AI 服务恢复后复核。`,
      recommendedAction: "buy",
      totalBudgetToUse: targetAmount,
      cashReserve: input.availableCash - targetAmount,
      orders: [
        {
          symbol: best.symbol,
          action: best.isHolding ? "add" : "buy",
          amount: targetAmount,
          shares: sharesFromAmount(targetAmount, best.price),
          planType: inferBuyPlanType(best),
          triggerPrice: best.price,
          stopLossPrice: normalizedPrice(best.stopLoss) ?? normalizedPriceFromText(best.quantSignal?.stopLoss),
          takeProfitPrice: normalizedPrice(best.targetPrice) ?? normalizedPriceFromText(best.quantSignal?.takeProfit),
          maxLossAmount: estimateMaxLossAmount({
            shares: sharesFromAmount(targetAmount, best.price),
            triggerPrice: best.price,
            stopLossPrice: normalizedPrice(best.stopLoss) ?? normalizedPriceFromText(best.quantSignal?.stopLoss)
          }),
          riskRewardRatio: best.quantSignal?.riskRewardRatio ?? null,
          priority: priorityFromBuyCandidate(best),
          reason: `${best.isHolding ? "已持仓，按本地规则仅视为增持候选。" : "未持仓，按本地规则视为新买入候选。"}${best.latestAnalysis?.summary ? ` ${best.latestAnalysis.summary}` : "趋势和置信度在候选中相对更高。"}`,
          riskControl: "若跌破最近分析给出的止损或关键支撑，停止加仓并复核。",
          invalidIf: "AI 服务恢复后结论相反，或价格快速偏离计划买入区间。"
        }
      ],
      sellOrders: [],
      ranking: ranked.map((candidate, index) => ({
        symbol: candidate.symbol,
        rank: index + 1,
        view: index === 0 ? "优先" : quantView(candidate),
        reason: quantReason(candidate)
      })),
      disclaimer: "本内容由本地规则生成，仅供研究参考，不构成投资建议。"
    },
    input,
    reason
  );
}

function parseJsonObject(text: string) {
  const cleaned = repairJsonText(text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim());
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(repairJsonText(cleaned.slice(start, end + 1)));
    throw new Error("AI 返回内容不是可解析的 JSON 对象。");
  }
}

function repairJsonText(text: string) {
  return text
    .replace(/[\u201C\u201D]/g, "\"")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, "$1");
}

function normalizeScheduledFor(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function numberArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => toNumber(item)).filter((item): item is number => item !== null);
}

function toNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function latestIso(values: Array<string | null | undefined>) {
  let latest: string | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const time = new Date(value).getTime();
    if (Number.isFinite(time) && time > latestTime) {
      latest = value;
      latestTime = time;
    }
  }
  return latest;
}

function buildLedgerSignature(
  tradeExecutions: Array<{
    symbol: string;
    side: string;
    shares: unknown;
    netCashChange: unknown;
    realizedPnl: unknown;
    updatedAt: Date;
  }>
) {
  const grouped = new Map<string, { symbol: string; side: string; shares: number }>();
  for (const execution of tradeExecutions) {
    const symbol = execution.symbol.toUpperCase();
    const side = execution.side.toLowerCase();
    const key = `${symbol}:${side}`;
    const current = grouped.get(key) ?? { symbol, side, shares: 0 };
    current.shares = Number((current.shares + (toNumber(execution.shares) ?? 0)).toFixed(4));
    grouped.set(key, current);
  }

  return {
    count: tradeExecutions.length,
    latestUpdatedAt: latestIso(tradeExecutions.map((execution) => execution.updatedAt.toISOString())),
    netCashChange: Number(tradeExecutions.reduce((sum, execution) => sum + (toNumber(execution.netCashChange) ?? 0), 0).toFixed(2)),
    realizedPnl: calculateRealizedPnl(tradeExecutions),
    positions: [...grouped.values()].sort((a, b) => `${a.symbol}:${a.side}`.localeCompare(`${b.symbol}:${b.side}`))
  };
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
