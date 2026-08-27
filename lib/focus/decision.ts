import { createHash } from "node:crypto";
import type { FocusDecision as StoredFocusDecision, Prisma } from "@prisma/client";

import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

import { estimateAiCost, getAiConfig, selectAiModel } from "@/lib/ai/config";
import { createDecisionHistoryFromFocusDecision, refreshAnalysisRun } from "@/lib/analysis/runRecords";
import { createChatCompletion } from "@/lib/ai/deepseek";
import { readAiProviderTokenUsage, type AiProviderTokenUsage } from "@/lib/ai/analyzeStock";
import { getCache, setCache } from "@/lib/cache";
import { AppError } from "@/lib/errors";
import {
  candidateHasFreshQuote,
  candidateSupportsBuy,
  candidateSupportsSell,
  assessCandidateBuy,
  quantAllowsSell,
  quantReason,
  quantView
} from "@/lib/focus/decisionCandidate";
import { buildDecisionPrompt, FOCUS_DECISION_SYSTEM_PROMPT } from "@/lib/focus/decisionPrompt";
import { decisionSchema, type DecisionSchemaValue } from "@/lib/focus/decisionSchema";
import type { Candidate, CandidateTradeFeedback, DecisionInput, DecisionNearMiss, DecisionShadowPlan, DecisionWaitReason, GenerateFocusDecisionOptions } from "@/lib/focus/decisionTypes";
import {
  buildPortfolioSnapshot,
  calculatePositionCostBasisBySymbol,
  calculateRealizedPnl,
  type PortfolioSnapshot
} from "@/lib/focus/portfolio";
import {
  focusSymbolBase,
  latestFocusAnalysesForSymbols as latestAnalysesForSymbols,
  focusSymbolVariants as symbolVariants,
  sameFocusSymbol as sameSymbol
} from "@/lib/focus/symbols";
import {
  calculateFocusTradeFee,
  calculateSellPnl,
  isFeeEfficientTrade,
  minimumFeeEfficientAmount,
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
import { buildTradePerformance } from "@/lib/trades/performance";
import { calculateTradeEconomics, tradeEconomicsBlockReason } from "@/lib/trading/economics";
import { buildPortfolioRiskBudget, fitTradeToRiskBudget } from "@/lib/trading/riskBudget";
import { ensureStrategyHealthGatesForFocus, loadStrategyHealthGates } from "@/lib/strategy/gate";
import { toNumber } from "@/lib/utils";

const TRADE_FEEDBACK_LOOKBACK_DAYS = 45;
type GeneratedFocusDecision = ReturnType<typeof normalizeDecision>;

export async function getLatestStoredFocusDecision(userId: string) {
  await prisma.$transaction((tx) => reconcileAndRebuildUserPositions(tx, userId));
  const seed = await loadDecisionSeed(userId);
  const inputHash = createDecisionSignature(seed);
  const portfolioSnapshot = await loadPortfolioSnapshot(userId, seed.capital);
  const exact = await prisma.focusDecision.findFirst({
    where: { userId, inputHash },
    orderBy: { createdAt: "desc" },
    include: { feedback: { include: { tradeExecution: true } } }
  });
  if (exact) return attachStoredMetadata(exact, { fromCache: true, stale: false }, portfolioSnapshot);

  const latest = await prisma.focusDecision.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { feedback: { include: { tradeExecution: true } } }
  });
  return latest ? attachStoredMetadata(latest, { fromCache: true, stale: true }, portfolioSnapshot) : null;
}

export async function generateAndStoreFocusDecision(options: GenerateFocusDecisionOptions) {
  const source = options.source ?? "manual";
  await prisma.$transaction((tx) => reconcileAndRebuildUserPositions(tx, options.userId));
  await ensureStrategyHealthGatesForFocus(options.userId).catch((error) => {
    console.warn("[focus-decision] strategy health refresh failed", error instanceof Error ? error.message : String(error));
  });
  const seed = await loadDecisionSeed(options.userId);
  const inputHash = createDecisionSignature(seed);
  const cacheKey = `focus_decision:${options.userId}:${inputHash}`;

  if (!options.forceRefresh) {
    const stored = await prisma.focusDecision.findFirst({
      where: { userId: options.userId, inputHash },
      orderBy: { createdAt: "desc" },
      include: { feedback: { include: { tradeExecution: true } } }
    });
    if (stored) {
      const portfolioSnapshot = await loadPortfolioSnapshot(options.userId, seed.capital);
      return attachStoredMetadata(stored, { fromCache: true, stale: false }, portfolioSnapshot);
    }

    const cached = await getCache<GeneratedFocusDecision>(cacheKey);
    if (cached) return { ...cached, fromCache: true, stale: false };
  }

  const input = await loadDecisionInput(seed);
  const execution = await generateFocusDecision(input);
  const decision = execution.decision;
  await logFocusDecisionAiUsage({
    userId: options.userId,
    source,
    inputHash,
    input,
    decision,
    model: execution.model,
    usage: execution.usage,
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
    sellOrders: decision.sellOrders,
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
  decision: GeneratedFocusDecision;
  model: string;
  usage: AiProviderTokenUsage | null;
  cacheHit: boolean;
}) {
  const config = await getAiConfig();
  const promptTokens = input.usage?.promptTokens ?? Math.ceil(buildDecisionPrompt(input.input).length / 4);
  const completionTokens = input.usage?.completionTokens ?? Math.ceil(JSON.stringify(input.decision).length / 4);
  await prisma.aiUsageLog.create({
    data: {
      userId: input.userId,
      symbol: null,
      jobType: "focus_decision",
      provider: config.baseUrl.includes("deepseek.com") ? "deepseek" : "openai-compatible",
      model: input.model,
      inputHash: input.inputHash,
      promptTokens,
      completionTokens,
      promptCacheHitTokens: input.usage?.cacheHitTokens ?? null,
      promptCacheMissTokens: input.usage?.cacheMissTokens ?? null,
      modelTier: "standard",
      routingReason: "cost-aware-routing-v1:focus-explanation-standard",
      estimatedCost: input.cacheHit ? "0" : estimateAiCost({ config, tier: "standard", promptTokens, completionTokens }),
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
  decision: GeneratedFocusDecision;
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

async function updateStoredDecisionJson(id: string, decision: GeneratedFocusDecision & { notification?: unknown }) {
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
    tradeExecution?: { executedAt: Date } | null;
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
          executedAt: row.feedback.tradeExecution?.executedAt.toISOString() ?? null,
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
      select: { symbol: true, side: true, price: true, shares: true, amount: true, fee: true, netCashChange: true, realizedPnl: true, executedAt: true, updatedAt: true },
      orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }]
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
  const [analyses, watchlistItems, portfolioItems, tradeExecutions, feedbackRows] = await Promise.all([
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
        riskLevel: true,
        positionOpenedAt: true
      }
    }),
    prisma.watchlistItem.findMany({
      where: { watchlist: { userId }, isHolding: true },
      select: {
        symbol: true,
        holdingPrice: true,
        holdingShares: true,
        stopLoss: true,
        riskLevel: true,
        positionOpenedAt: true
      }
    }),
    prisma.tradeExecution.findMany({
      where: { userId },
      select: {
        symbol: true,
        side: true,
        price: true,
        shares: true,
        amount: true,
        fee: true,
        netCashChange: true,
        realizedPnl: true,
        executedAt: true,
        updatedAt: true
      },
      orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }]
    }),
    prisma.decisionFeedback.findMany({
      where: {
        userId,
        updatedAt: { gte: new Date(Date.now() - TRADE_FEEDBACK_LOOKBACK_DAYS * 86400000) }
      },
      orderBy: { updatedAt: "desc" },
      take: 120,
      include: {
        decision: {
          select: {
            decisionJson: true,
            updatedAt: true
          }
        },
        tradeExecution: {
          select: {
            symbol: true,
            side: true,
            realizedPnl: true,
            executedAt: true
          }
        }
      }
    })
  ]);
  const feedbackProfiles = buildTradeFeedbackProfiles(symbols, feedbackRows);
  const strategyHealthGates = await loadStrategyHealthGates({ userId, capital, symbols });
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
      riskLevel: item?.riskLevel ?? null,
      positionOpenedAt: item?.positionOpenedAt?.toISOString() ?? null
    };
  });
  const portfolioSignature = portfolioItems
    .map((item) => ({
      symbol: item.symbol.toUpperCase(),
      holdingPrice: toNumber(item.holdingPrice),
      holdingShares: toNumber(item.holdingShares),
      stopLoss: toNumber(item.stopLoss),
      riskLevel: item.riskLevel,
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
    ledgerSignature,
    feedbackProfiles,
    strategyHealthGates,
    strategyHealthSignature: [...strategyHealthGates.values()].map((gate) => ({
      symbol: focusSymbolBase(gate.symbol),
      permission: gate.entryPermission,
      preset: gate.recommendedPreset,
      generatedAt: gate.generatedAt
    })).sort((left, right) => left.symbol.localeCompare(right.symbol)),
    feedbackSignature: buildFeedbackSignature(feedbackProfiles)
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
        holdingShares: true,
        stopLoss: true,
        riskLevel: true
      }
    }),
    prisma.tradeExecution.findMany({
      where: { userId: seed.userId },
      select: { symbol: true, side: true, price: true, shares: true, amount: true, fee: true, netCashChange: true, realizedPnl: true, executedAt: true, updatedAt: true },
      orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }]
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
  const costBasisBySymbol = calculatePositionCostBasisBySymbol(portfolioItems, tradeExecutions);
  const tradePerformance = buildTradePerformance(
    tradeExecutions.map((execution) => ({
      id: `${execution.symbol}:${execution.executedAt.toISOString()}:${execution.side}`,
      symbol: execution.symbol,
      side: String(execution.side),
      amount: toNumber(execution.amount) ?? 0,
      fee: toNumber(execution.fee) ?? 0,
      realizedPnl: toNumber(execution.realizedPnl),
      executedAt: execution.executedAt
    })),
    seed.capital
  );

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
      currentCostBasis: item ? costBasisBySymbol.get(focusSymbolBase(item.symbol)) ?? null : null,
      positionOpenedAt: item?.positionOpenedAt ?? null,
      targetPrice: toNumber(item?.targetPrice),
      stopLoss: toNumber(item?.stopLoss),
      latestAnalysis: output
        ? {
            trend: output.trend,
            confidence: output.confidence,
            summary: output.summary,
            newsSummary: output.newsSummary,
            newsSentiment: output.newsSentiment,
            newsReferences: output.newsReferences,
            sectorRisks: output.sectorRisks,
            holdAdvice: output.holdAdvice,
            entryAdvice: output.entryAdvice,
            riskFactors: output.riskFactors,
            decisionStatus: output.decisionStatus,
            dataQuality: output.dataQuality,
            tradePlan: output.tradePlan,
            isFallback: output.isFallback,
            dataScope: output.dataScope
          }
        : null,
      quantSignal: null,
      tradeFeedback: seed.feedbackProfiles.get(focusSymbolBase(symbol)) ?? null,
      strategyHealth: seed.strategyHealthGates.get(focusSymbolBase(symbol)) ?? null,
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
  const riskBudget = buildPortfolioRiskBudget({
    capital: seed.capital,
    totalAssets,
    marketRegime: marketContext.marketRegime,
    tradePerformance,
    positions: portfolioItems.map((item) => {
      const quote = quotes[item.symbol] ?? quotes[symbolVariants(item.symbol).find((symbol) => quotes[symbol]) ?? item.symbol];
      return {
        symbol: item.symbol,
        shares: toNumber(item.holdingShares),
        currentPrice: quote?.price ?? null,
        holdingPrice: toNumber(item.holdingPrice),
        stopLossPrice: toNumber(item.stopLoss),
        riskLevel: item.riskLevel
      };
    })
  });

  return {
    capital: seed.capital,
    investedCost,
    availableCash,
    currentMarketValue,
    unrealizedPnl,
    realizedPnl,
    totalAssets,
    tradePerformance,
    riskBudget,
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
  const auditedRegimes = candidates
    .map((candidate) => candidate.latestAnalysis?.dataScope?.marketRegime)
    .filter((value): value is "risk_on" | "neutral" | "risk_off" => value === "risk_on" || value === "neutral" || value === "risk_off");
  const regimeCounts = {
    risk_on: auditedRegimes.filter((value) => value === "risk_on").length,
    neutral: auditedRegimes.filter((value) => value === "neutral").length,
    risk_off: auditedRegimes.filter((value) => value === "risk_off").length
  };
  const marketRegime = selectAuditedMarketRegime(regimeCounts);
  const overheatedCount = candidates.filter(isDeterministicallyOverheated).length;

  const sectorBiases: Record<string, QuantSectorBias> = {};
  const bySector = groupBy(candidates, (candidate) => candidate.sectorKey ?? "unknown");
  for (const [sector, rows] of Object.entries(bySector)) {
    const sectorChange = average(rows.map((candidate) => candidate.changePct).filter(isFiniteNumber));
    const sectorOverheated = rows.some(isDeterministicallyOverheated);
    sectorBiases[sector] =
      sectorChange !== null && sectorChange <= -1.2
        ? "bearish"
        : sectorOverheated
          ? "overheated"
          : sectorChange !== null && sectorChange >= 1.2
            ? "bullish"
            : "neutral";
  }

  const notes = [
    auditedRegimes.length
      ? `市场环境来自 ${auditedRegimes.length} 份单股证据包内的确定性基准快照：${marketRegimeLabel(marketRegime)}。`
      : "缺少可复用的确定性基准市场状态，组合层按中性处理，不使用 AI 趋势或新闻文本补造。",
    `候选平均涨跌幅 ${avgChange === null ? "--" : `${avgChange.toFixed(2)}%`}，只用于候选横截面说明，不替代市场基准。`,
    overheatedCount ? `有 ${overheatedCount} 只标的被 RSI/布林带等确定性指标标记为过热。` : "确定性指标未检测到集中过热。"
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

function selectAuditedMarketRegime(counts: Record<"risk_on" | "neutral" | "risk_off", number>): QuantStrategyContext["marketRegime"] {
  const max = Math.max(counts.risk_on, counts.neutral, counts.risk_off);
  if (max <= 0) return "neutral";
  if (counts.risk_off === max) return "risk_off";
  if (counts.neutral === max) return "neutral";
  return "risk_on";
}

function isDeterministicallyOverheated(candidate: Candidate & { quantInput?: QuantInput }) {
  const rsi = candidate.quantInput?.indicators?.rsi14;
  const upper = candidate.quantInput?.indicators?.bollingerUpper;
  return Boolean((rsi !== null && rsi !== undefined && rsi >= 72) || (candidate.price && upper && candidate.price >= upper));
}

function inferSectorKey(input: { symbol: string; name?: string | null; note?: string | null; latestAnalysis?: unknown }) {
  const text = `${input.symbol} ${input.name ?? ""} ${input.note ?? ""}`;
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

type FeedbackRow = {
  feedbackAction: string;
  note: string | null;
  tradeSymbol: string | null;
  tradeSide: string | null;
  updatedAt: Date;
  decision?: { decisionJson: unknown; updatedAt: Date } | null;
  tradeExecution?: { symbol: string; side: string; realizedPnl: unknown; executedAt: Date } | null;
};

function buildTradeFeedbackProfiles(symbols: string[], rows: FeedbackRow[]) {
  const trackedBases = new Set(symbols.map(focusSymbolBase).filter(Boolean));
  const profiles = new Map<string, CandidateTradeFeedback>();

  for (const row of rows) {
    const entries = feedbackEntries(row).filter((entry) => trackedBases.has(focusSymbolBase(entry.symbol)));
    if (!entries.length) continue;
    for (const entry of entries) {
      const base = focusSymbolBase(entry.symbol);
      const profile = profiles.get(base) ?? emptyTradeFeedback();
      profile.lastFeedbackAt = latestDateIso(profile.lastFeedbackAt, row.updatedAt);

      if (row.feedbackAction === "bought" || entry.side === "buy") {
        profile.lastBuyAt = latestDateIso(profile.lastBuyAt, row.tradeExecution?.executedAt ?? row.updatedAt);
        profile.addBlockedUntil = latestDateIso(profile.addBlockedUntil, addDays(row.updatedAt, 2));
        addFeedbackNote(profile, "最近已买入/增持，短期重复加仓需更强确认。");
      }

      if (row.feedbackAction === "sold" || entry.side === "sell") {
        profile.lastSellAt = latestDateIso(profile.lastSellAt, row.tradeExecution?.executedAt ?? row.updatedAt);
        const realizedPnl = toNumber(row.tradeExecution?.realizedPnl);
        if (realizedPnl !== null && realizedPnl < 0) {
          profile.recentLossSellAt = latestDateIso(profile.recentLossSellAt, row.tradeExecution?.executedAt ?? row.updatedAt);
          profile.recentLossPnl = realizedPnl;
          profile.buyBlockedUntil = latestDateIso(profile.buyBlockedUntil, addDays(row.updatedAt, 10));
          addFeedbackNote(profile, `最近亏损卖出，短期重新买入需等待更强信号；已实现盈亏 ${realizedPnl.toFixed(2)} 元。`);
        }
      }

      if (row.feedbackAction === "skipped" && entry.side !== "sell") {
        profile.lastSkippedBuyAt = latestDateIso(profile.lastSkippedBuyAt, row.updatedAt);
        profile.buyBlockedUntil = latestDateIso(profile.buyBlockedUntil, addDays(row.updatedAt, 3));
        addFeedbackNote(profile, "最近买入计划被标记为未采纳，短期同类买入降级观察。");
      }

      profiles.set(base, profile);
    }
  }

  for (const [base, profile] of profiles) {
    profiles.set(base, {
      ...profile,
      notes: profile.notes.slice(0, 3)
    });
  }
  return profiles;
}

function feedbackEntries(row: FeedbackRow) {
  const directSymbol = row.tradeExecution?.symbol ?? row.tradeSymbol;
  const directSide = normalizeFeedbackSide(row.tradeExecution?.side ?? row.tradeSide);
  if (directSymbol) return [{ symbol: directSymbol, side: directSide }];

  const decision = isRecord(row.decision?.decisionJson) ? row.decision.decisionJson : {};
  if (row.feedbackAction === "sold") return orderEntriesFromDecision(decision, "sellOrders", "sell");
  if (row.feedbackAction === "bought") return orderEntriesFromDecision(decision, "orders", "buy");
  if (row.feedbackAction === "skipped") return orderEntriesFromDecision(decision, "orders", "buy");
  return [];
}

function orderEntriesFromDecision(decision: Record<string, unknown>, key: "orders" | "sellOrders", side: "buy" | "sell") {
  const orders = Array.isArray(decision[key]) ? decision[key] : [];
  return orders
    .filter(isRecord)
    .map((order) => (typeof order.symbol === "string" && order.symbol.trim() ? { symbol: order.symbol, side } : null))
    .filter((entry): entry is { symbol: string; side: "buy" | "sell" } => Boolean(entry));
}

function normalizeFeedbackSide(value: unknown) {
  const side = String(value ?? "").toLowerCase();
  return side === "buy" || side === "sell" ? side : null;
}

function emptyTradeFeedback(): CandidateTradeFeedback {
  return {
    lastFeedbackAt: null,
    lastBuyAt: null,
    lastSellAt: null,
    lastSkippedBuyAt: null,
    recentLossSellAt: null,
    recentLossPnl: null,
    buyBlockedUntil: null,
    addBlockedUntil: null,
    notes: []
  };
}

function addFeedbackNote(profile: CandidateTradeFeedback, note: string) {
  if (!profile.notes.includes(note)) profile.notes.push(note);
}

function latestDateIso(current: string | null, value: Date | string | null | undefined) {
  if (!value) return current;
  const next = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(next.getTime())) return current;
  if (!current) return next.toISOString();
  return next.getTime() > new Date(current).getTime() ? next.toISOString() : current;
}

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * 86400000);
}

function buildFeedbackSignature(profiles: Map<string, CandidateTradeFeedback>) {
  return [...profiles.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([symbol, profile]) => ({
      symbol,
      lastFeedbackAt: profile.lastFeedbackAt,
      lastBuyAt: profile.lastBuyAt,
      lastSellAt: profile.lastSellAt,
      lastSkippedBuyAt: profile.lastSkippedBuyAt,
      recentLossSellAt: profile.recentLossSellAt,
      recentLossPnl: profile.recentLossPnl,
      buyBlockedUntil: profile.buyBlockedUntil,
      addBlockedUntil: profile.addBlockedUntil,
      buyCooling: isFutureDate(profile.buyBlockedUntil),
      addCooling: isFutureDate(profile.addBlockedUntil)
    }));
}

function isFutureDate(value?: string | null) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time > Date.now();
}

function isWithinDays(value: string | null | undefined, days: number) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= Date.now() - days * 86400000;
}

function createDecisionSignature(input: Awaited<ReturnType<typeof loadDecisionSeed>>) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        capital: input.capital,
        symbols: input.symbols,
        focusUpdatedAt: input.focusUpdatedAt,
        positionSignature: input.positionSignature,
        portfolioSignature: input.portfolioSignature,
        ledgerSignature: input.ledgerSignature,
        feedbackSignature: input.feedbackSignature,
        strategyHealthSignature: input.strategyHealthSignature,
        latestAnalysisIds: [...input.latestAnalysisBySymbol.values()].map((analysis) => analysis.id)
      })
    )
    .digest("hex")
    .slice(0, 16);
}

async function generateFocusDecision(input: DecisionInput) {
  const config = await getAiConfig();
  const model = selectAiModel(config, "standard");
  if (!config.apiKey) return {
    decision: buildFallbackDecision(input, "AI API key 未配置，已使用本地规则生成临时决策。"),
    model,
    usage: null
  };

  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl || undefined });
  const request: ChatCompletionCreateParamsNonStreaming = {
    model,
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
    return {
      decision: normalizeDecision(parsed, input, null),
      model,
      usage: readAiProviderTokenUsage(completion)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return {
      decision: buildFallbackDecision(input, `AI 决策生成失败，已使用本地规则生成临时决策。原因：${message}`),
      model,
      usage: null
    };
  }
}

function normalizeDecision(value: DecisionSchemaValue, input: DecisionInput, fallbackReason: string | null) {
  const candidatesBySymbol = new Map(input.candidates.map((candidate) => [candidate.symbol, candidate]));
  const spendableCash = calculateSpendableCash(input);
  const buyExecutionBlocks = new Map<string, string>();
  let spent = 0;
  let plannedRisk = 0;
  let acceptedBuyOrders = 0;
  const buyOrderCandidates = withRequiredStructuredBuyOrders(value.orders, input);
  const orders = buyOrderCandidates
    .filter((order) => order.action === "buy" || order.action === "add")
    .filter((order) => {
      const candidate = candidatesBySymbol.get(order.symbol) ?? input.candidates.find((item) => sameSymbol(item.symbol, order.symbol));
      return candidate ? candidateSupportsBuy(candidate) : false;
    })
    .sort((a, b) => buyOrderQuality(b, input) - buyOrderQuality(a, input))
    .map((order) => {
      if (acceptedBuyOrders >= 2) return null;
      const candidate = candidatesBySymbol.get(order.symbol) ?? input.candidates.find((item) => sameSymbol(item.symbol, order.symbol));
      const price = candidate?.price ?? 0;
      const structuredEntry = candidate?.latestAnalysis?.tradePlan?.entry;
      const executionPrice = normalizedPrice(structuredEntry?.triggerPrice) ?? normalizedPrice(order.triggerPrice) ?? normalizedPrice(price) ?? 0;
      const remainingCash = Math.max(0, spendableCash - spent);
      const requestedShares = structuredEntry?.shares ?? (order.shares || sharesFromAmount(order.amount, executionPrice));
      const maxShares = sharesFromAmount(maxBuyAmountForCandidate(candidate, input, remainingCash), executionPrice);
      const cashLimitedShares = normalizeShares(Math.min(requestedShares, maxShares), executionPrice, remainingCash);
      const draftPlanMeta = buildBuyPlanMeta({ order, candidate, price, shares: cashLimitedShares });
      const riskCapacity = Math.min(
        input.riskBudget.singleTradeRiskLimitAmount,
        Math.max(0, input.riskBudget.availableRiskAmount - plannedRisk)
      );
      const riskBlock = input.riskBudget.status === "breached_stop" ? input.riskBudget.reason : null;
      const riskFit = riskBlock
        ? { shares: 0, economics: null, reason: riskBlock }
        : fitTradeToRiskBudget({
            requestedShares: cashLimitedShares,
            entryPrice: draftPlanMeta.triggerPrice ?? executionPrice,
            stopLossPrice: draftPlanMeta.stopLossPrice,
            takeProfitPrice: draftPlanMeta.takeProfitPrice,
            maxRiskAmount: riskCapacity
          });
      if (!riskFit.shares || riskFit.reason) {
        if (candidate) buyExecutionBlocks.set(candidate.symbol, riskFit.reason ?? "风险预算不足，暂不增加新仓位。");
        return null;
      }
      const shares = riskFit.shares;
      const planMeta = buildBuyPlanMeta({ order, candidate, price, shares });
      const economics = riskFit.economics ?? calculateTradeEconomics({
        entryPrice: planMeta.triggerPrice ?? executionPrice,
        shares,
        stopLossPrice: planMeta.stopLossPrice,
        takeProfitPrice: planMeta.takeProfitPrice
      });
      const amount = economics?.entryAmount ?? (executionPrice > 0 ? Number((shares * executionPrice).toFixed(2)) : Number(order.amount.toFixed(2)));
      const fee = economics?.entryFee ?? calculateFocusTradeFee(amount);
      if (amount + fee > remainingCash) return null;
      if (!isFeeEfficientTrade(amount, input.availableCash)) return null;
      const economicsBlock = tradeEconomicsBlockReason(economics);
      if (economicsBlock) {
        if (candidate) buyExecutionBlocks.set(candidate.symbol, economicsBlock);
        return null;
      }
      spent += amount + fee;
      plannedRisk = Number((plannedRisk + (economics?.netRiskAmount ?? 0)).toFixed(2));
      acceptedBuyOrders += 1;
      return {
        ...order,
        action: candidate?.isHolding ? ("add" as const) : ("buy" as const),
        symbol: candidate?.symbol ?? order.symbol,
        name: candidate?.name ?? null,
        estimatedPrice: price || null,
        shares,
        amount,
        ...planMeta,
        riskControl: order.riskControl || buildBuyRiskControl(candidate),
        invalidIf: order.invalidIf || buildBuyInvalidIf(candidate),
        estimatedFee: fee,
        totalCost: economics?.totalEntryCost ?? Number((amount + fee).toFixed(2)),
        estimatedExitFee: economics?.targetExitFee ?? null,
        roundTripFees: economics?.roundTripFees ?? null,
        feeDragPct: economics?.feeDragPct ?? null,
        breakEvenPrice: economics?.breakEvenPrice ?? null,
        breakEvenMovePct: economics?.breakEvenMovePct ?? null,
        grossExpectedProfit: economics?.grossExpectedProfit ?? null,
        netExpectedProfit: economics?.netExpectedProfit ?? null,
        netMaxLossAmount: economics?.netRiskAmount ?? null,
        netRiskRewardRatio: economics?.netRiskRewardRatio ?? null,
        riskBudgetAmount: Number(riskCapacity.toFixed(2)),
        riskUsagePct: economics?.netRiskAmount && input.riskBudget.singleTradeRiskLimitAmount > 0
          ? Number((economics.netRiskAmount / input.riskBudget.singleTradeRiskLimitAmount * 100).toFixed(2))
          : null,
        portfolioRiskAfterOrder: Number((input.riskBudget.openRiskAmount + plannedRisk).toFixed(2)),
        feeRule: TRADING_FEE_RULE.description
      };
    })
    .filter((order): order is NonNullable<typeof order> => Boolean(order && order.shares > 0 && order.amount > 0));
  const sellOrderCandidates = withRequiredStructuredSellOrders(value.sellOrders, input);
  const sellOrders = sellOrderCandidates
    .filter((order) => order.action === "sell" || order.action === "reduce")
    .filter((order) => {
      const candidate = candidatesBySymbol.get(order.symbol) ?? input.candidates.find((item) => sameSymbol(item.symbol, order.symbol));
      return candidateSupportsSell(candidate);
    })
    .sort((a, b) => sellOrderRisk(b, input) - sellOrderRisk(a, input))
    .map((order) => {
      const candidate = candidatesBySymbol.get(order.symbol) ?? input.candidates.find((item) => sameSymbol(item.symbol, order.symbol));
      const price = candidate?.price ?? 0;
      const holdingShares = candidate?.isHolding ? candidate.holdingShares ?? 0 : 0;
      const structuredExitShares = candidate?.latestAnalysis?.tradePlan?.exit.status === "conditional"
        ? candidate.latestAnalysis.tradePlan.exit.shares ?? 0
        : 0;
      const quantShares = candidate?.quantSignal?.suggestedSellShares || 0;
      const shares = normalizeSellShares(structuredExitShares || quantShares, holdingShares);
      const amount = price > 0 ? Number((shares * price).toFixed(2)) : Number(order.amount.toFixed(2));
      const fee = calculateFocusTradeFee(amount);
      const netProceeds = Number((amount - fee).toFixed(2));
      const estimatedPnl = calculateSellPnl({
        sellAmount: amount,
        sellFee: fee,
        shares,
        holdingPrice: candidate?.holdingPrice ?? null,
        holdingShares: candidate?.holdingShares ?? null,
        currentCostBasis: candidate?.currentCostBasis ?? null
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
        riskControl: order.riskControl || buildSellRiskControl(candidate),
        invalidIf: order.invalidIf || buildSellInvalidIf(candidate),
        estimatedFee: fee,
        netProceeds,
        estimatedPnl,
        feeRule: TRADING_FEE_RULE.description
      };
    })
    .filter((order) => order.shares > 0 && order.amount > 0)
    .slice(0, 3);
  const normalizedAction = sellOrders.length && orders.length ? "mixed" : sellOrders.length ? "sell" : orders.length ? "buy" : "wait";
  const summary = alignSummaryWithStructuredPlan(value.summary, value, input, orders, sellOrders, normalizedAction);
  const buyFee = Number(orders.reduce((sum, order) => sum + order.estimatedFee, 0).toFixed(2));
  const roundTripFee = Number(orders.reduce((sum, order) => sum + (order.roundTripFees ?? order.estimatedFee), 0).toFixed(2));
  const totalExpectedNetProfit = Number(orders.reduce((sum, order) => sum + (order.netExpectedProfit ?? 0), 0).toFixed(2));
  const sellFee = Number(sellOrders.reduce((sum, order) => sum + order.estimatedFee, 0).toFixed(2));
  const totalSellNetProceeds = Number(sellOrders.reduce((sum, order) => sum + order.netProceeds, 0).toFixed(2));
  const plannedRiskAmount = Number(orders.reduce((sum, order) => sum + (order.netMaxLossAmount ?? 0), 0).toFixed(2));
  const riskAfterPlanAmount = Number((input.riskBudget.openRiskAmount + plannedRiskAmount).toFixed(2));
  const riskAfterPlanPct = input.riskBudget.equityBase > 0
    ? Number((riskAfterPlanAmount / input.riskBudget.equityBase * 100).toFixed(2))
    : 0;
  const availableRiskAfterPlan = Number(Math.max(0, input.riskBudget.portfolioRiskLimitAmount - riskAfterPlanAmount).toFixed(2));
  const ranking = normalizeRankingItems(value.ranking, input, orders, sellOrders, buyExecutionBlocks);
  const nearMisses = buildDecisionNearMisses(input, orders, buyExecutionBlocks);
  const shadowPlans = buildDecisionShadowPlans(input, orders);
  const waitReasons = normalizedAction === "wait" ? buildDecisionWaitReasons(input) : [];
  const strategyHealthGates = input.candidates.flatMap((candidate) => candidate.strategyHealth ? [{
    ...candidate.strategyHealth,
    symbol: candidate.symbol,
    name: candidate.name ?? null
  }] : []);
  const strategyHealthSummary = {
    total: strategyHealthGates.length,
    allowed: strategyHealthGates.filter((gate) => gate.entryPermission === "allow").length,
    reduced: strategyHealthGates.filter((gate) => gate.entryPermission === "reduce_size").length,
    paused: strategyHealthGates.filter((gate) => gate.entryPermission === "pause").length,
    generatedAt: strategyHealthGates.map((gate) => gate.generatedAt).sort().at(-1) ?? null
  };

  return {
    ...value,
    recommendedAction: normalizedAction,
    summary,
    orders,
    sellOrders,
    ranking,
    nearMisses,
    shadowPlans,
    waitReasons,
    totalBudgetToUse: Number(orders.reduce((sum, order) => sum + order.amount, 0).toFixed(2)),
    totalSellAmount: Number(sellOrders.reduce((sum, order) => sum + order.amount, 0).toFixed(2)),
    totalEstimatedFee: Number((buyFee + sellFee).toFixed(2)),
    totalEstimatedRoundTripFee: roundTripFee,
    totalExpectedNetProfit,
    riskBudget: input.riskBudget,
    plannedRiskAmount,
    riskAfterPlanAmount,
    riskAfterPlanPct,
    availableRiskAfterPlan,
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
    strategyHealthGates,
    strategyHealthSummary,
    feeRule: TRADING_FEE_RULE,
    fallbackReason,
    generatedAt: new Date().toISOString()
  };
}

function buildDecisionNearMisses(
  input: DecisionInput,
  orders: Array<{ symbol: string }>,
  executionBlocks: Map<string, string>
): DecisionNearMiss[] {
  const orderedSymbols = symbolVariantSet(orders.map((order) => order.symbol));
  return input.candidates
    .flatMap((candidate) => {
      const signal = candidate.quantSignal;
      if (!signal || !candidateHasFreshQuote(candidate) || hasSymbolVariant(orderedSymbols, candidate.symbol)) return [];
      const rawGap = signal.adjustedBuyThreshold - signal.buyScore;
      const isActiveBuySignal = signal.action === "buy" || signal.action === "add";
      const isCloseEnough = rawGap <= 5 && signal.riskScore < 72 &&
        (signal.riskRewardRatio === null || signal.riskRewardRatio >= 1.05);
      if (!isCloseEnough && !(isActiveBuySignal && rawGap <= 8)) return [];

      const assessment = assessCandidateBuy(candidate);
      const executionBlock = executionBlocks.get(candidate.symbol);
      const blockers = [
        ...assessment.blockers,
        ...(executionBlock ? [executionBlock] : []),
        ...(assessment.supported && !executionBlock ? ["量化条件已接近或达到，但本轮没有形成结构化买单"] : [])
      ];
      return [{
        symbol: candidate.symbol,
        name: candidate.name ?? null,
        side: "buy" as const,
        price: candidate.price,
        score: signal.buyScore,
        threshold: signal.adjustedBuyThreshold,
        scoreGap: Number(Math.max(0, rawGap).toFixed(1)),
        entryPermission: candidate.strategyHealth?.entryPermission ?? null,
        blockers: [...new Set(blockers)].slice(0, 6),
        blockerDetails: [
          ...assessment.blockerDetails,
          ...(executionBlock ? [{ code: "execution_normalization_failed", category: "execution" as const, message: executionBlock }] : [])
        ].filter((item, index, all) => all.findIndex((candidateItem) => candidateItem.code === item.code && candidateItem.message === item.message) === index)
      }];
    })
    .sort((left, right) => left.scoreGap - right.scoreGap || right.score - left.score)
    .slice(0, 3);
}

function buildDecisionShadowPlans(input: DecisionInput, orders: Array<{ symbol: string }>): DecisionShadowPlan[] {
  const executable = symbolVariantSet(orders.map((order) => order.symbol));
  return input.candidates
    .flatMap((candidate) => {
      if (hasSymbolVariant(executable, candidate.symbol) || candidate.latestAnalysis?.isFallback) return [];
      if (candidate.latestAnalysis?.dataQuality?.status === "insufficient" || candidate.latestAnalysis?.dataQuality?.status === "conflicted") return [];
      const entry = candidate.latestAnalysis?.tradePlan?.entry;
      if (!entry?.shadowEligible || entry.expectedValueStatus !== "not_calibrated") return [];
      if (!entry.triggerPrice || !entry.stopLossPrice || !entry.takeProfitPrice || !entry.shares || !entry.amount || !entry.totalCost || !entry.netMaxLossAmount || !entry.netRiskRewardRatio) return [];
      const assessment = assessCandidateBuy(candidate);
      return [{
        symbol: candidate.symbol,
        name: candidate.name ?? null,
        action: candidate.isHolding ? "add" as const : "buy" as const,
        triggerPrice: entry.triggerPrice,
        stopLossPrice: entry.stopLossPrice,
        takeProfitPrice: entry.takeProfitPrice,
        shares: entry.shares,
        amount: entry.amount,
        totalCost: entry.totalCost,
        roundTripFees: entry.roundTripFees ?? null,
        netMaxLossAmount: entry.netMaxLossAmount,
        netRiskRewardRatio: entry.netRiskRewardRatio,
        expectedValueStatus: "not_calibrated" as const,
        blockers: assessment.blockerDetails
          .filter((item) => item.category === "calibration" || item.code === "analysis_status_not_entry" || item.code === "structured_entry_plan_blocked")
          .map((item) => item.message)
          .slice(0, 4)
      }];
    })
    .sort((left, right) => (input.candidates.find((candidate) => sameSymbol(candidate.symbol, right.symbol))?.quantSignal?.buyScore ?? 0)
      - (input.candidates.find((candidate) => sameSymbol(candidate.symbol, left.symbol))?.quantSignal?.buyScore ?? 0))
    .slice(0, 3);
}

function buildBuyPlanMeta(input: {
  order: DecisionSchemaValue["orders"][number];
  candidate?: Candidate | null;
  price: number;
  shares: number;
}) {
  const structured = input.candidate?.latestAnalysis?.tradePlan?.entry;
  const triggerPrice = normalizedPrice(structured?.triggerPrice) ?? normalizedPrice(input.order.triggerPrice) ?? normalizedPrice(input.price);
  const stopLossPrice = normalizedPrice(structured?.stopLossPrice) ?? normalizedPrice(input.order.stopLossPrice) ?? normalizedPrice(input.candidate?.stopLoss) ?? normalizedPriceFromText(input.candidate?.quantSignal?.stopLoss);
  const takeProfitPrice = normalizedPrice(structured?.takeProfitPrice) ?? normalizedPrice(input.order.takeProfitPrice) ?? normalizedPrice(input.candidate?.targetPrice) ?? normalizedPriceFromText(input.candidate?.quantSignal?.takeProfit);
  return {
    planType: input.order.planType ?? inferBuyPlanType(input.candidate),
    triggerPrice,
    stopLossPrice,
    takeProfitPrice,
    maxLossAmount: normalizedMoney(structured?.maxLossAmount) ?? normalizedMoney(input.order.maxLossAmount) ?? estimateMaxLossAmount({ shares: input.shares, triggerPrice, stopLossPrice }),
    riskRewardRatio: normalizedRatio(structured?.riskRewardRatio) ?? normalizedRatio(input.order.riskRewardRatio) ?? input.candidate?.quantSignal?.riskRewardRatio ?? estimateRiskRewardRatio({ triggerPrice, stopLossPrice, takeProfitPrice }),
    priority: input.order.priority ?? priorityFromBuyCandidate(input.candidate),
    entryCondition: input.order.entryCondition || buildEntryCondition({ candidate: input.candidate, triggerPrice }),
    executionWindow: input.order.executionWindow || buildExecutionWindow(input.candidate),
    positionImpact: input.order.positionImpact || buildBuyPositionImpact({ candidate: input.candidate, shares: input.shares, price: input.price, triggerPrice })
  };
}

function buildSellPlanMeta(input: {
  order: DecisionSchemaValue["sellOrders"][number];
  candidate?: Candidate | null;
  price: number;
  shares: number;
  holdingShares: number;
}) {
  const structured = input.candidate?.latestAnalysis?.tradePlan?.exit;
  const triggerPrice = normalizedPrice(structured?.triggerPrice) ?? normalizedPrice(input.price);
  const stopLossPrice = normalizedPrice(structured?.stopLossPrice) ?? normalizedPrice(input.candidate?.stopLoss) ?? normalizedPriceFromText(input.candidate?.quantSignal?.stopLoss);
  const takeProfitPrice = normalizedPrice(structured?.takeProfitPrice) ?? normalizedPrice(input.candidate?.targetPrice) ?? normalizedPriceFromText(input.candidate?.quantSignal?.takeProfit);
  return {
    triggerPrice,
    stopLossPrice,
    takeProfitPrice,
    sellRatioPct: percent(input.shares, input.holdingShares),
    priority: input.order.priority ?? priorityFromSellCandidate(input.candidate),
    exitCondition: input.order.exitCondition || buildExitCondition({ candidate: input.candidate, triggerPrice, stopLossPrice, takeProfitPrice }),
    executionWindow: input.order.executionWindow || buildExecutionWindow(input.candidate),
    positionImpact: input.order.positionImpact || buildSellPositionImpact({ candidate: input.candidate, shares: input.shares, price: input.price, holdingShares: input.holdingShares })
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

function buildEntryCondition(input: { candidate?: Candidate | null; triggerPrice: number | null }) {
  const signal = input.candidate?.quantSignal;
  if (signal?.entryPlan) return signal.entryPlan;
  const triggerText = input.triggerPrice ? `价格接近或有效站上 ${input.triggerPrice}` : "价格回到计划区间";
  const scoreText = signal ? `买入分维持在 ${signal.adjustedBuyThreshold} 以上，风险分不继续抬升` : "最新分析维持偏多或条件入场";
  const volumeText = signal?.volumeRatio !== null && signal?.volumeRatio !== undefined ? `量能不低于近期均量的 ${Math.max(0.8, Math.min(1.2, signal.volumeRatio)).toFixed(2)} 倍附近` : "量能没有明显萎缩";
  return `${triggerText}，且${scoreText}，${volumeText}时才执行。`;
}

function buildExitCondition(input: { candidate?: Candidate | null; triggerPrice: number | null; stopLossPrice: number | null; takeProfitPrice: number | null }) {
  const signal = input.candidate?.quantSignal;
  if (signal?.action === "sell") {
    return `价格触及 ${formatPlanLevel(input.triggerPrice ?? input.stopLossPrice)} 或卖出分维持在 ${signal.adjustedSellThreshold} 以上时优先执行。`;
  }
  if (input.stopLossPrice && input.triggerPrice && input.triggerPrice <= input.stopLossPrice) {
    return `跌破 ${formatPlanLevel(input.stopLossPrice)} 且不能快速收回时执行风控卖出。`;
  }
  if (input.takeProfitPrice) {
    return `接近 ${formatPlanLevel(input.takeProfitPrice)} 后动量转弱、放量回落或卖出分超过 ${signal?.adjustedReduceThreshold ?? "减仓阈值"} 时执行。`;
  }
  return signal?.exitPlan || "卖出分超过减仓阈值、趋势转弱或持仓计划失效时执行。";
}

function buildExecutionWindow(candidate?: Candidate | null) {
  const signal = candidate?.quantSignal;
  if (!candidateHasFreshQuote(candidate)) return "行情不新鲜时不执行，等待下一次有效报价和分析更新。";
  if (signal?.marketRegime === "risk_off" || signal?.sectorBias === "overheated") return "优先等收盘确认或次日复核，避免盘中追高。";
  if ((signal?.riskScore ?? 0) >= 68) return "盘中触发后仍需二次确认，风险信号回落前不扩大仓位。";
  return "可盘中观察触发价，若收盘仍满足条件再确认执行。";
}

function buildBuyPositionImpact(input: { candidate?: Candidate | null; shares: number; price: number; triggerPrice: number | null }) {
  if (!input.shares || input.price <= 0) return "交易数量不足 100 股/份，本计划不产生实际仓位变化。";
  const amount = input.shares * input.price;
  const fee = calculateFocusTradeFee(amount);
  const risk = estimateMaxLossAmount({
    shares: input.shares,
    triggerPrice: input.triggerPrice ?? input.price,
    stopLossPrice: normalizedPrice(input.candidate?.stopLoss) ?? normalizedPriceFromText(input.candidate?.quantSignal?.stopLoss)
  });
  return `${input.candidate?.isHolding ? "增持" : "新建"} ${input.shares} 股/份，预计占用 ${formatPlanMoney(amount + fee)}；单笔价格风险约 ${formatPlanMoney(risk)}。`;
}

function buildBuyRiskControl(candidate?: Candidate | null) {
  const signal = candidate?.quantSignal;
  const constraints = signal?.tradeConstraints?.slice(0, 2).join("；");
  const stopText = signal?.stopLoss && signal.stopLoss !== "--" ? `跌破 ${signal.stopLoss} 或买入分跌回阈值下方时停止执行。` : "跌破关键支撑、风险分抬升或买入分跌回阈值下方时停止执行。";
  return [stopText, constraints].filter(Boolean).join(" ");
}

function buildBuyInvalidIf(candidate?: Candidate | null) {
  const signal = candidate?.quantSignal;
  if (!signal) return "最新行情、量能或单股分析发生明显变化。";
  const conditions = [
    `买入分低于 ${signal.adjustedBuyThreshold}`,
    `风险分升至 68 以上`,
    signal.riskRewardRatio !== null ? "风险收益比低于 1.25 : 1" : "",
    signal.marketRegime === "risk_off" ? "市场继续转入防守状态" : ""
  ].filter(Boolean);
  return conditions.length ? conditions.join("，") + "。" : "价格快速脱离计划区间或最新分析转弱。";
}

function buildSellRiskControl(candidate?: Candidate | null) {
  const signal = candidate?.quantSignal;
  const feeText = "卖出净回收按成交额扣除同样万分之五、最低 5 元手续费估算。";
  if (signal?.exitPlan) return `${signal.exitPlan} ${feeText}`;
  return `若卖出分回落、价格重新站回关键支撑且风险信号消失，可取消减仓观察。${feeText}`;
}

function buildSellInvalidIf(candidate?: Candidate | null) {
  const signal = candidate?.quantSignal;
  if (!signal) return "最新行情、持仓成本或单股分析发生明显变化。";
  return `卖出分低于 ${signal.adjustedReduceThreshold}，价格重新站回安全趋势区间，且止损/止盈/盈利保护条件未触发。`;
}

function buildSellPositionImpact(input: { candidate?: Candidate | null; shares: number; price: number; holdingShares: number }) {
  if (!input.shares || input.price <= 0) return "交易数量不足 100 股/份，本计划不产生实际仓位变化。";
  const amount = input.shares * input.price;
  const fee = calculateFocusTradeFee(amount);
  const remainingShares = Math.max(0, input.holdingShares - input.shares);
  const ratio = percent(input.shares, input.holdingShares);
  return `卖出 ${input.shares} 股/份${ratio !== null ? `（约 ${ratio.toFixed(0)}%）` : ""}，预计回收 ${formatPlanMoney(amount - fee)}，剩余 ${remainingShares} 股/份。`;
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
  sellOrders: Array<{ symbol: string }>,
  buyExecutionBlocks: Map<string, string>
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
    const executionBlock = findExecutionBlock(buyExecutionBlocks, candidate.symbol);
    if (executionBlock) {
      return {
        ...item,
        symbol: candidate.symbol,
        view: candidate.isHolding ? "持有观察" : "观察",
        reason: `交易净收益校验未通过：${executionBlock} 结构化买入计划已取消。${quantReason(candidate)}`
      };
    }

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
    const executionBlock = findExecutionBlock(buyExecutionBlocks, candidate.symbol);
    normalized.push({
      symbol: candidate.symbol,
      rank: normalized.length + 1,
      view: executionBlock ? "观察" : candidateHasFreshQuote(candidate) ? quantView(candidate) : "观察",
      reason: executionBlock
        ? `交易净收益校验未通过：${executionBlock} 结构化买入计划已取消。${quantReason(candidate)}`
        : candidateHasFreshQuote(candidate) ? quantReason(candidate) : normalizeBlockedRankingReason(candidate, true, false)
    });
  }

  return normalized
    .sort((a, b) => a.rank - b.rank)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function findExecutionBlock(blocks: Map<string, string>, symbol: string) {
  for (const [blockedSymbol, reason] of blocks) {
    if (sameSymbol(blockedSymbol, symbol)) return reason;
  }
  return null;
}

function normalizeBlockedRankingReason(candidate: Candidate, claimedBuy: boolean, claimedSell: boolean) {
  if (!candidateHasFreshQuote(candidate)) {
    return `行情不新鲜或报价不可用（status=${candidate.status}，quoteTime=${candidate.quoteTime ?? "无"}），已禁止生成买入/增持计划。${quantReason(candidate)}`;
  }
  if (claimedSell && !quantAllowsSell(candidate)) {
    return `卖出/减仓未通过本地量化阈值，已降级为观察。${quantReason(candidate)}`;
  }
  if (claimedBuy && !candidateSupportsBuy(candidate)) {
    const assessment = assessCandidateBuy(candidate);
    const constraints = candidate.quantSignal?.tradeConstraints?.length ? ` 交易约束：${candidate.quantSignal.tradeConstraints.join("；")}` : "";
    return `买入/增持未通过结构化单股状态与确定性门控：${assessment.blockers.slice(0, 3).join("；")}。已降级为观察。${quantReason(candidate)}${constraints}`;
  }
  return quantReason(candidate);
}

function buyOrderQuality(order: DecisionSchemaValue["orders"][number], input: DecisionInput) {
  const candidate = input.candidates.find((item) => sameSymbol(item.symbol, order.symbol));
  const signal = candidate?.quantSignal;
  if (!candidate || !signal) return 0;
  const riskReward = signal.riskRewardRatio ?? 1.25;
  const supportBonus = signal.supportDistancePct !== null && signal.supportDistancePct <= 3.5 ? 6 : 0;
  const holdingPenalty = candidate.isHolding ? 3 : 0;
  const feedbackPenalty = tradeFeedbackBuyPenalty(candidate);
  return (
    signal.buyScore -
    signal.riskScore * 0.35 +
    Math.min(8, riskReward * 2) +
    supportBonus -
    holdingPenalty -
    feedbackPenalty -
    Math.max(0, signal.sellScore - 45) * 0.4
  );
}

function tradeFeedbackBuyPenalty(candidate: Candidate) {
  const feedback = candidate.tradeFeedback;
  if (!feedback) return 0;
  let penalty = 0;
  if (isFutureDate(feedback.buyBlockedUntil)) penalty += 18;
  if (candidate.isHolding && isFutureDate(feedback.addBlockedUntil)) penalty += 10;
  if (isWithinDays(feedback.recentLossSellAt, 20)) penalty += 6;
  if (isWithinDays(feedback.lastSkippedBuyAt, 10)) penalty += 4;
  return penalty;
}

function calculateSpendableCash(input: DecisionInput) {
  if (input.availableCash <= TRADING_FEE_RULE.minimumFee) return 0;
  const marketReserveRate =
    input.marketContext.marketRegime === "risk_off" ? 0.2 :
    input.marketContext.marketRegime === "risk_on" ? 0.05 :
    0.1;
  const performanceScale = tradePerformancePositionScale(input.tradePerformance);
  const performanceReserveRate = performanceScale <= 0.6 ? 0.2 : performanceScale < 1 ? 0.1 : input.tradePerformance.currentLossStreak >= 2 ? 0.05 : 0;
  const reserveRate = Math.min(0.4, marketReserveRate + performanceReserveRate);
  const reserve = Math.min(input.availableCash * reserveRate, input.capital * reserveRate);
  return Math.max(0, Number((input.availableCash - reserve).toFixed(2)));
}

function maxBuyAmountForCandidate(candidate: Candidate | null | undefined, input: DecisionInput, remainingCash: number) {
  if (!candidate?.quantSignal || remainingCash <= 0) return 0;
  const suggestedBudget = normalizeSuggestedBuyBudget(candidate, input, remainingCash);
  if (!suggestedBudget || suggestedBudget <= 0) return 0;
  const existingExposure = candidate.isHolding && candidate.price && candidate.holdingShares ? candidate.price * candidate.holdingShares : 0;
  const maxPositionBudget = input.capital * maxSinglePositionPct(candidate, input.capital) / 100;
  const exposureRoom = Math.max(0, maxPositionBudget - existingExposure);
  const performanceAdjustedBudget = suggestedBudget * tradePerformancePositionScale(input.tradePerformance);
  const strategyHealthScale = candidate.strategyHealth?.entryPermission === "reduce_size" ? 0.5 : candidate.strategyHealth?.entryPermission === "pause" ? 0 : 1;
  return Number(Math.min(remainingCash, performanceAdjustedBudget * strategyHealthScale, exposureRoom).toFixed(2));
}

function tradePerformancePositionScale(performance: DecisionInput["tradePerformance"]) {
  if (performance.closedTrades < 5) return 1;
  let scale = 1;
  if ((performance.profitFactor !== null && performance.profitFactor < 0.8) || (performance.expectancy !== null && performance.expectancy < 0 && (performance.maxDrawdownPct ?? 0) >= 5)) scale = Math.min(scale, 0.55);
  else if ((performance.profitFactor !== null && performance.profitFactor < 1) || (performance.expectancy !== null && performance.expectancy < 0)) scale = Math.min(scale, 0.72);
  if (performance.currentLossStreak >= 3) scale = Math.min(scale, 0.6);
  else if (performance.currentLossStreak >= 2) scale = Math.min(scale, 0.8);
  if ((performance.maxDrawdownPct ?? 0) >= 8) scale = Math.min(scale, 0.6);
  else if ((performance.maxDrawdownPct ?? 0) >= 5) scale = Math.min(scale, 0.8);
  return scale;
}

function normalizeSuggestedBuyBudget(candidate: Candidate, input: DecisionInput, remainingCash: number) {
  const rawBudget = input.capital * ((candidate.quantSignal?.suggestedBuyCapitalPct ?? 0) / 100);
  if (input.capital > TRADING_FEE_RULE.minimumFeeBase / 2) return rawBudget;
  const adaptiveFloor = Math.min(remainingCash, input.capital * smallAccountMinPositionPct(candidate) / 100);
  return Math.max(rawBudget, adaptiveFloor, minimumFeeEfficientAmount(input.availableCash));
}

function smallAccountMinPositionPct(candidate: Candidate) {
  const signal = candidate.quantSignal;
  if (!signal) return 20;
  if (signal.marketRegime === "risk_off") return 24;
  if (signal.sectorBias === "overheated") return 24;
  if (signal.marketRegime === "risk_on" && signal.sectorBias === "bullish") return 34;
  return 28;
}

function maxSinglePositionPct(candidate: Candidate, capital: number) {
  const signal = candidate.quantSignal;
  if (!signal) return 20;
  if (capital <= TRADING_FEE_RULE.minimumFeeBase / 2) {
    if (signal.marketRegime === "risk_off") return candidate.isHolding ? 35 : 32;
    if (signal.sectorBias === "overheated") return candidate.isHolding ? 38 : 35;
    if (signal.marketRegime === "risk_on" && signal.sectorBias === "bullish") return candidate.isHolding ? 55 : 48;
    return candidate.isHolding ? 45 : 40;
  }
  if (signal.marketRegime === "risk_off") return candidate.isHolding ? 18 : 15;
  if (signal.sectorBias === "overheated") return candidate.isHolding ? 20 : 18;
  if (signal.marketRegime === "risk_on" && signal.sectorBias === "bullish") return candidate.isHolding ? 35 : 30;
  return candidate.isHolding ? 25 : 22;
}

function sellOrderRisk(order: DecisionSchemaValue["sellOrders"][number], input: DecisionInput) {
  const candidate = input.candidates.find((item) => sameSymbol(item.symbol, order.symbol));
  const signal = candidate?.quantSignal;
  if (!candidate || !signal) return 0;
  const holdingReturn = signal.holdingReturnPct ?? 0;
  const quantShares = signal.suggestedSellShares ?? 0;
  const requestedShares = Math.max(order.shares ?? 0, sharesFromAmount(order.amount ?? 0, candidate.price ?? 0));
  const sharePressure = Math.max(quantShares, requestedShares) / Math.max(candidate.holdingShares ?? 100, 100);
  return (
    signal.sellScore +
    signal.riskScore * 0.35 +
    Math.max(0, holdingReturn) * 0.6 +
    sharePressure * 18 +
    (signal.action === "sell" ? 16 : signal.action === "reduce" ? 8 : 0) -
    (order.priority ? order.priority : 3)
  );
}

function withRequiredStructuredBuyOrders(
  orders: DecisionSchemaValue["orders"],
  input: DecisionInput
): DecisionSchemaValue["orders"] {
  const output = [...orders];
  const existing = symbolVariantSet(output.map((order) => order.symbol));
  const eligible = input.candidates
    .filter(candidateSupportsBuy)
    .sort((left, right) => (right.quantSignal?.buyScore ?? 0) - (left.quantSignal?.buyScore ?? 0));
  for (const candidate of eligible) {
    if (hasSymbolVariant(existing, candidate.symbol)) continue;
    const entry = candidate.latestAnalysis?.tradePlan?.entry;
    if (!entry?.shares || !entry.amount) continue;
    output.push({
      symbol: candidate.symbol,
      action: candidate.isHolding ? "add" : "buy",
      amount: entry.amount,
      shares: entry.shares,
      triggerPrice: entry.triggerPrice,
      stopLossPrice: entry.stopLossPrice,
      takeProfitPrice: entry.takeProfitPrice,
      maxLossAmount: entry.maxLossAmount,
      riskRewardRatio: entry.riskRewardRatio,
      entryCondition: candidate.quantSignal?.entryPlan ?? "结构化单股计划与确定性门控均已满足时执行。",
      executionWindow: buildExecutionWindow(candidate),
      positionImpact: buildBuyPositionImpact({
        candidate,
        shares: entry.shares,
        price: candidate.price ?? entry.triggerPrice ?? 0,
        triggerPrice: entry.triggerPrice
      }),
      reason: `单股结构化状态为 conditional_entry，扣费后期望值为正；${entry.reason}`,
      riskControl: buildBuyRiskControl(candidate),
      invalidIf: buildBuyInvalidIf(candidate)
    });
    for (const symbol of symbolVariants(candidate.symbol)) existing.add(symbol);
  }
  return output;
}

function withRequiredStructuredSellOrders(
  orders: DecisionSchemaValue["sellOrders"],
  input: DecisionInput
): DecisionSchemaValue["sellOrders"] {
  const output = orders.filter((order) => (order.shares ?? 0) > 0 || (order.amount ?? 0) > 0);
  const existing = symbolVariantSet(output.map((order) => order.symbol));
  for (const candidate of input.candidates) {
    if (!candidateSupportsSell(candidate)) continue;
    if (hasSymbolVariant(existing, candidate.symbol)) continue;
    const structuredExit = candidate.latestAnalysis?.tradePlan?.exit;
    const shares = structuredExit?.shares || candidate.quantSignal?.suggestedSellShares || 0;
    if (!shares || shares <= 0) continue;
    output.push({
      symbol: candidate.symbol,
      action: structuredExit?.action === "sell" || candidate.quantSignal?.action === "sell" ? "sell" : "reduce",
      amount: candidate.price && candidate.price > 0 ? Number((shares * candidate.price).toFixed(2)) : 0,
      shares,
      exitCondition: buildExitCondition({
        candidate,
        triggerPrice: normalizedPrice(candidate.price),
        stopLossPrice: normalizedPrice(candidate.stopLoss) ?? normalizedPriceFromText(candidate.quantSignal?.stopLoss),
        takeProfitPrice: normalizedPrice(candidate.targetPrice) ?? normalizedPriceFromText(candidate.quantSignal?.takeProfit)
      }),
      executionWindow: buildExecutionWindow(candidate),
      positionImpact: buildSellPositionImpact({
        candidate,
        shares,
        price: candidate.price ?? 0,
        holdingShares: candidate.holdingShares ?? 0
      }),
      reason: buildRequiredSellReason(candidate),
      riskControl: candidate.quantSignal?.exitPlan || "若风险信号消失、价格重新站回关键支撑并且量化卖出分回落，可取消减仓观察。",
      invalidIf: "最新行情或单股分析显示卖出分低于阈值，且价格重新回到安全趋势区间。"
    });
    for (const symbol of symbolVariants(candidate.symbol)) existing.add(symbol);
  }
  return output;
}

function buildRequiredSellReason(candidate: Candidate) {
  const signal = candidate.quantSignal;
  const parts = [
    "结构化持仓退出计划或本地量化规则触发风控，系统自动补齐减仓/卖出计划。",
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
  if (normalizedAction === "wait") return buildDeterministicWaitSummary(input);
  const unsupportedSellClaims = detectUnsupportedSellClaims(value, input, sellOrders);
  const planText = describeStructuredPlan(orders, sellOrders, normalizedAction);
  const ignoredSellText = unsupportedSellClaims.length
    ? `；已忽略未通过本地量化/持仓校验的卖出表述：${unsupportedSellClaims.join("、")}`
    : "";
  if (planText || ignoredSellText) {
    return `${planText}${ignoredSellText}。AI 原始理由：${summary}`;
  }
  return summary;
}

function buildDecisionWaitReasons(input: DecisionInput): DecisionWaitReason[] {
  const assessments = input.candidates.map((candidate) => assessCandidateBuy(candidate));
  const categories: DecisionWaitReason["category"][] = ["data", "calibration", "market", "quant", "risk", "execution", "analysis"];
  const labels: Record<DecisionWaitReason["category"], string> = {
    data: "证据或时效未闭合",
    calibration: "扣费后期望值尚未校准为正",
    market: "价格或量能条件未满足",
    quant: "量化分数/动作未达到门槛",
    risk: "组合、策略健康或冷静期限制",
    execution: "止损、目标、费用或整手约束不合格",
    analysis: "结构化单股状态尚未进入条件入场"
  };
  return categories.flatMap((category) => {
    const candidateDetails = assessments.filter((assessment) => assessment.blockerDetails.some((item) => item.category === category));
    if (!candidateDetails.length) return [];
    const codes = [...new Set(candidateDetails.flatMap((assessment) => assessment.blockerDetails.filter((item) => item.category === category).map((item) => item.code)))];
    return [{ category, candidateCount: candidateDetails.length, codes, message: labels[category] }];
  });
}

function buildDeterministicWaitSummary(input: DecisionInput) {
  if (!input.candidates.length) return "当前没有候选标的，无法形成交易计划。";
  const reasons = buildDecisionWaitReasons(input);
  const ordered = reasons
    .filter((item) => item.candidateCount > 0)
    .slice(0, 4)
    .map((item) => `${item.candidateCount}/${input.candidates.length} 只${item.message}`);
  const marketText = input.marketContext.marketRegime === "risk_off"
    ? "确定性市场基准处于偏防守状态，并提高了买入门槛。"
    : `确定性市场基准为${marketRegimeLabel(input.marketContext.marketRegime)}，没有单独禁止买入。`;
  return `当前没有可执行计划。主要阻断：${ordered.length ? ordered.join("；") : "没有候选通过全部结构化门控"}。${marketText}`;
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

function formatPlanLevel(value: number | null | undefined) {
  return value ? value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "") : "计划触发价";
}

function formatPlanMoney(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return `${Number(value.toFixed(2)).toLocaleString("zh-CN")} 元`;
}

function orderLabel(input: { symbol: string; name?: string | null }) {
  return input.name ? `${input.name}（${input.symbol}）` : input.symbol;
}

function buildFallbackDecision(input: DecisionInput, reason: string) {
  const sellCandidates = input.candidates.filter(candidateSupportsSell);
  const ranked = input.candidates
    .filter(candidateSupportsBuy)
    .sort((a, b) => (b.quantSignal?.buyScore ?? 0) - (a.quantSignal?.buyScore ?? 0));
  const best = ranked[0];
  const sellTarget = sellCandidates[0];
  if (!best?.price && !sellTarget?.price) {
    return normalizeDecision(
      {
        summary: buildDeterministicWaitSummary(input),
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
    const sellShares = sellTarget.latestAnalysis?.tradePlan?.exit.shares || sellTarget.quantSignal?.suggestedSellShares || 0;
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
            action: sellTarget.latestAnalysis?.tradePlan?.exit.action === "sell" || sellTarget.quantSignal?.action === "sell" ? "sell" : "reduce",
            amount: sellShares * sellTarget.price,
            shares: sellShares,
            triggerPrice: sellTarget.price,
            stopLossPrice: normalizedPrice(sellTarget.stopLoss) ?? normalizedPriceFromText(sellTarget.quantSignal?.stopLoss),
            takeProfitPrice: normalizedPrice(sellTarget.targetPrice) ?? normalizedPriceFromText(sellTarget.quantSignal?.takeProfit),
            sellRatioPct: sellTarget.holdingShares ? percent(sellShares, sellTarget.holdingShares) : null,
            priority: sellTarget.quantSignal?.action === "sell" ? 1 : 2,
            exitCondition: buildExitCondition({
              candidate: sellTarget,
              triggerPrice: sellTarget.price,
              stopLossPrice: normalizedPrice(sellTarget.stopLoss) ?? normalizedPriceFromText(sellTarget.quantSignal?.stopLoss),
              takeProfitPrice: normalizedPrice(sellTarget.targetPrice) ?? normalizedPriceFromText(sellTarget.quantSignal?.takeProfit)
            }),
            executionWindow: buildExecutionWindow(sellTarget),
            positionImpact: buildSellPositionImpact({
              candidate: sellTarget,
              shares: sellShares,
              price: sellTarget.price,
              holdingShares: sellTarget.holdingShares ?? 0
            }),
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
          entryCondition: buildEntryCondition({ candidate: best, triggerPrice: best.price }),
          executionWindow: buildExecutionWindow(best),
          positionImpact: buildBuyPositionImpact({
            candidate: best,
            shares: sharesFromAmount(targetAmount, best.price),
            price: best.price ?? 0,
            triggerPrice: best.price
          }),
          reason: `${best.isHolding ? "已持仓，结构化单股状态与本地规则均允许增持。" : "未持仓，结构化单股状态与本地规则均允许条件入场。"}${best.latestAnalysis?.summary ? ` ${best.latestAnalysis.summary}` : "结构化交易计划已通过确定性门控。"}`,
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
