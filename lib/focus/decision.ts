import { createHash } from "node:crypto";
import type { FocusDecision as StoredFocusDecision, Prisma } from "@prisma/client";

import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { z } from "zod";

import { estimateAiCost, getAiConfig, selectAiModel } from "@/lib/ai/config";
import { createDecisionHistoryFromFocusDecision, refreshAnalysisRun } from "@/lib/analysis/runRecords";
import { createChatCompletion } from "@/lib/ai/deepseek";
import { getCache, setCache } from "@/lib/cache";
import { AppError } from "@/lib/errors";
import { notifyFocusDecision } from "@/lib/notifications/send";
import { prisma } from "@/lib/prisma";
import { buildQuantSignal, type QuantInput, type QuantSectorBias, type QuantSignal, type QuantStrategyContext } from "@/lib/quant/strategy";
import { getQuotesBatch } from "@/lib/services/quoteService";
import { reconcileAndRebuildUserPositions } from "@/lib/trades/ledger";
import { toNumber } from "@/lib/utils";

const TRADING_FEE_RULE = {
  rate: 0.0005,
  minimumFeeBase: 10000,
  minimumFee: 5,
  lotSize: 100,
  description: "买入和卖出手续费均按成交金额的万分之五估算；若成交金额不足 10000 元，按 10000 元计费，即最低手续费 5 元。A 股/ETF 买入和卖出都按 100 股/份整数手执行，低于 100 股/份的买卖计划一律无效。"
};

const decisionSchema = z.object({
  summary: z.string().min(1),
  recommendedAction: z.enum(["buy", "sell", "mixed", "wait"]),
  totalBudgetToUse: z.coerce.number().min(0).default(0),
  cashReserve: z.coerce.number().min(0).default(0),
  orders: z
    .array(
      z.object({
        symbol: z.string().min(1),
        action: z.enum(["buy", "add", "watch", "avoid"]),
        amount: z.coerce.number().min(0).default(0),
        shares: z.coerce.number().int().min(0).default(0),
        reason: z.string().min(1),
        riskControl: z.string().default(""),
        invalidIf: z.string().default("")
      })
    )
    .default([]),
  sellOrders: z
    .array(
      z.object({
        symbol: z.string().min(1),
        action: z.enum(["sell", "reduce", "watch", "avoid"]),
        amount: z.coerce.number().min(0).default(0),
        shares: z.coerce.number().int().min(0).default(0),
        reason: z.string().min(1),
        riskControl: z.string().default(""),
        invalidIf: z.string().default("")
      })
    )
    .default([]),
  ranking: z
    .array(
      z.object({
        symbol: z.string().min(1),
        rank: z.coerce.number().int().positive(),
        view: z.string().min(1),
        reason: z.string().min(1)
      })
    )
    .default([]),
  disclaimer: z.string().default("本内容由 AI 生成，仅供研究参考，不构成投资建议。")
});

type DecisionSchemaValue = z.infer<typeof decisionSchema>;

type Candidate = {
  symbol: string;
  name?: string | null;
  sectorKey?: string | null;
  price: number | null;
  changePct: number | null;
  quoteTime?: string | null;
  analysisGeneratedAt?: string | null;
  analysisDataScope?: {
    quoteTime?: string | null;
    historyTo?: string | null;
    historyRange?: string | null;
    historyInterval?: string | null;
    historyCandles?: number | null;
  } | null;
  status: string;
  note?: string | null;
  riskLevel?: string;
  isHolding?: boolean;
  holdingPrice?: number | null;
  holdingShares?: number | null;
  positionOpenedAt?: Date | null;
  targetPrice?: number | null;
  stopLoss?: number | null;
  latestAnalysis?: {
    trend?: string;
    confidence?: number;
    summary?: string;
    newsSummary?: string;
    newsSentiment?: string;
    newsReferences?: unknown;
    sectorRisks?: unknown;
    holdAdvice?: unknown;
    entryAdvice?: unknown;
    riskFactors?: unknown;
  } | null;
  quantSignal?: QuantSignal | null;
};

type DecisionInput = {
  capital: number;
  investedCost: number;
  availableCash: number;
  currentMarketValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalAssets: number;
  marketContext: QuantStrategyContext;
  candidates: Candidate[];
  dataScope: {
    latestQuoteTime: string | null;
    latestHistoryTo: string | null;
    latestAnalysisGeneratedAt: string | null;
    quoteTimes: Array<{ symbol: string; quoteTime: string | null; status: string }>;
    historyTimes: Array<{ symbol: string; historyTo: string | null; historyRange: string | null; historyInterval: string | null; historyCandles: number | null }>;
  };
};

type GenerateFocusDecisionOptions = {
  userId: string;
  forceRefresh?: boolean;
  source?: "manual" | "scheduled";
  scheduledFor?: Date | string | null;
  runId?: string | null;
  createRunItems?: boolean;
};

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

type PortfolioSnapshot = {
  investedCost: number;
  availableCash: number;
  currentMarketValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalAssets: number;
  portfolioValuationStatus: "live" | "stale" | "partial_fallback" | "cost_fallback" | "empty";
  portfolioSnapshotAt: string;
};

type PortfolioValuationStatus = PortfolioSnapshot["portfolioValuationStatus"];

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
      select: { realizedPnl: true }
    })
  ]);
  const portfolioSymbols = [...new Set(portfolioItems.map((item) => item.symbol.toUpperCase()))];
  const quotes = portfolioSymbols.length ? await getQuotesBatch(portfolioSymbols, { allowStale: true }) : {};
  const investedCost = calculateInvestedCost(portfolioItems);
  const realizedPnl = calculateRealizedPnl(tradeExecutions);
  const availableCash = Number(Math.max(0, capital - investedCost + realizedPnl).toFixed(2));
  const marketValue = calculatePortfolioMarketValue(portfolioItems, quotes);
  const unrealizedPnl = Number((marketValue.value - investedCost).toFixed(2));
  const totalAssets = Number((availableCash + marketValue.value).toFixed(2));

  return {
    investedCost,
    availableCash,
    currentMarketValue: marketValue.value,
    unrealizedPnl,
    realizedPnl,
    totalAssets,
    portfolioValuationStatus: marketValue.status,
    portfolioSnapshotAt: new Date().toISOString()
  };
}

async function loadDecisionSeed(userId: string) {
  const focus = await prisma.focusGroup.findUnique({ where: { userId } });
  if (!focus?.symbols.length) throw new AppError("BAD_REQUEST", "请先在今日关注中选择股票。");

  const capital = toNumber(focus.capital);
  if (!capital || capital <= 0) throw new AppError("BAD_REQUEST", "请先填写总本金，AI 才能计算策略观察金额。");

  const symbols = [...new Set(focus.symbols.map((symbol) => symbol.toUpperCase()))];
  const allSymbolVariants = symbols.flatMap(symbolVariants);
  const [analyses, watchlistItems, portfolioItems] = await Promise.all([
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
    })
  ]);
  const latestAnalysisBySymbol = latestAnalysesForSymbols(symbols, analyses);
  const positionSignature = symbols.map((symbol) => {
    const variants = symbolVariants(symbol);
    const item = watchlistItems.find((row) => variants.includes(row.symbol));
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
    portfolioSignature
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
      select: { realizedPnl: true }
    })
  ]);
  const portfolioSymbols = [...new Set(portfolioItems.map((item) => item.symbol.toUpperCase()))];
  const quoteSymbols = [...new Set([...seed.symbols, ...portfolioSymbols])];
  const quotes = await getQuotesBatch(quoteSymbols, { allowStale: true });
  const investedCost = calculateInvestedCost(portfolioItems);
  const realizedPnl = calculateRealizedPnl(tradeExecutions);
  const availableCash = Number(Math.max(0, seed.capital - investedCost + realizedPnl).toFixed(2));
  const currentMarketValue = calculateCurrentMarketValue(portfolioItems, quotes);
  const unrealizedPnl = Number((currentMarketValue - investedCost).toFixed(2));
  const totalAssets = Number((availableCash + currentMarketValue).toFixed(2));

  const candidateDrafts = seed.symbols.map((symbol) => {
    const variants = symbolVariants(symbol);
    const quote = quotes[symbol] ?? quotes[symbolVariants(symbol).find((item) => quotes[item]) ?? symbol] ?? null;
    const item = watchlistItems.find((row) => variants.includes(row.symbol));
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
        content:
          "你是一个谨慎的股票组合策略观察助手。你必须基于给定候选股票、最新单股分析、价格、持仓状态和手续费规则，生成今日策略观察、候选排序、条件触发型买入计划和卖出/减仓计划。策略框架参考成熟量化系统的做法：先用趋势过滤确认大方向，再用 RSI/MACD/均线/关键价位确认动量和风险，最后用止损、止盈、仓位和手续费约束控制执行。不能保证收益，不能编造数据，不能把观察计划写成确定性指令。输出必须是严格 JSON，所有自然语言字段使用简体中文。"
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

function buildDecisionPrompt(input: DecisionInput) {
  return `请基于今日关注股票生成“今日 AI 策略观察”。返回严格 JSON，不要 Markdown。

账户资金：
- 投入本金：${input.capital} 元
- 已持仓占用成本（按持仓成本价 + 估算买入手续费）：${input.investedCost} 元
- 当前可用现金：${input.availableCash} 元
- 当前持仓市值：${input.currentMarketValue} 元
- 持仓浮盈浮亏：${input.unrealizedPnl} 元
- 已实现盈亏：${input.realizedPnl} 元
- 当前总资产估算（现金 + 持仓市值）：${input.totalAssets} 元

交易手续费规则：
${JSON.stringify(TRADING_FEE_RULE, null, 2)}

本次决策数据截止：
${JSON.stringify(input.dataScope, null, 2)}

市场/行业动态上下文：
${JSON.stringify(input.marketContext, null, 2)}

决策要求：
1. 必须明确 recommendedAction，只能是 buy、sell、mixed 或 wait。buy 表示只有买入/增持计划；sell 表示只有卖出/减仓计划；mixed 表示同时有买入和卖出/减仓计划；wait 表示今日只观察。
2. 每个候选都有 isHolding、holdingPrice、holdingShares。isHolding=true 表示用户已经持仓，买入只能代表“增持/加仓”，卖出只能代表“减仓/止盈/止损/离场”；isHolding=false 不能生成 sellOrders。
3. 未持仓股票必须主要依据 entryAdvice 判断。若 entryAdvice 是“条件入场、小仓试探、分批观察、触发后建仓”，且价格、风险和手续费性价比合理，可以生成 buy；若 entryAdvice 明确等待、不建议入场、回避、观望，则不能买。
4. 已持仓股票必须主要依据 holdAdvice 判断。若 holdAdvice 出现“减仓、止损、离场、回避、跌破止损、趋势转弱、止盈、分批兑现”，必须在 sellOrders 中给出减仓或卖出计划；若 holdAdvice 明确“继续持有、逢低加仓、增持”，才允许保留或生成增持计划。
5. 先判断“市场/行业动态上下文”，再判断单股/ETF。marketContext 是系统根据今日候选、新闻情绪、行业线索和走势生成的动态策略环境：risk_on 可以降低买入阈值并允许小仓试探；risk_off 必须提高买入阈值、降低减仓阈值、控制仓位；sectorBias=overheated 时不能追高，只能等待回调或突破确认。
6. 使用“市场/行业上下文 + 趋势过滤 + 动量确认 + 风险边界 + 风险收益比 + 仓位控制”的策略框架：趋势偏多且 RSI 未明显过热、MACD/均线未恶化、价格靠近支撑或入场区间、riskRewardRatio 不差时，才考虑小仓买入；趋势转弱、跌破支撑/止损、RSI 过热后放量回落、MACD 死叉、riskRewardRatio 偏低或达到目标压力位时，优先考虑减仓/止盈/止损。
7. 每个候选都带有 quantSignal，这是本地量化规则结合市场/行业上下文计算出的硬约束和仓位建议。quantSignal.action=buy/add 才能进入 orders；quantSignal.action=sell/reduce 才能进入 sellOrders；quantSignal.action=avoid/watch/hold 通常只排序观察，除非单股分析给出更强且合理的相反证据。
8. quantSignal 中的 buyScore、sellScore、riskScore、riskRewardRatio、stopDistancePct、takeProfitDistancePct、holdingReturnPct、adjustedBuyThreshold、adjustedReduceThreshold、adjustedSellThreshold、marketRegime、sectorBias、newPositionProtection、suggestedBuyCapitalPct、suggestedSellRatioPct、suggestedSellShares、exitPlan 必须进入 reasoning。不要只写“等待”，必须说明分数、动态阈值或触发条件。
9. newPositionProtection=true 表示新建仓保护期内。除非已经触发硬止损、严重利空或卖出分达到强制卖出级别，否则不要直接卖出刚买入的仓位，只能写继续观察、移动止损或不加仓。
10. quoteTime 必须是当日或最新可交易数据，status 不能是 stale/unavailable/error。行情不新鲜、报价失败或 K 线截止早于其他候选时，不能进入 orders 或 sellOrders，只能写入 ranking 的风险原因。
11. orders 只放买入/增持计划，最多 2 笔；orders.action 只能用 buy 或 add，未持仓新买入用 buy，已持仓增持用 add。sellOrders 只放卖出/减仓计划，最多 3 笔。每笔必须写清 symbol、amount、shares、reason、riskControl、invalidIf。
12. amount 是计划成交金额，不含手续费；买入 shares 必须按 100 股/份整数手计算，买入总成本（amount + 手续费）不能超过“当前可用现金”，不能把已持仓占用成本再次当成现金使用。卖出 shares 也必须按 100 股/份整数手计算，不能返回 1-99 股/份的卖出计划；卖出 shares 不能超过 holdingShares，优先参考 quantSignal.suggestedSellShares。如果持仓不足 100 股/份，不允许生成 sellOrders，只能写移动止盈/继续观察；如果只持有 100 股/份但触发减仓，sellOrders 实际就是卖出 100 股/份。
13. 手续费按 max(amount, 10000) * 0.0005 计算。不足 10000 元的交易也要按 10000 元计费，即最低手续费 5 元；如果因为金额太小导致手续费占比不划算，应建议等待或合并交易。
14. 不要机械保守。如果候选趋势偏多、置信度不低、价格接近入场区间且风险控制清晰，可以给出小仓条件触发型计划；如果持仓风险已触发，不能只写观察，必须在 sellOrders 写明卖出/减仓数量、比例和触发依据。
15. 不要机械平均分配资金，要按 quantSignal.buyScore、quantSignal.sellScore、趋势、置信度、风险、持仓状态、已有持仓计划、浮盈亏、riskRewardRatio、marketRegime、sectorBias 和手续费性价比排序。
16. ranking 必须覆盖所有候选，并在 reason 里体现“市场/行业上下文 + 量化信号 + 已持仓/未持仓 + 持仓建议/入场建议/退出建议 + 卖出或减仓比例”。
17. JSON 示例中的枚举字段只能返回一个合法值，例如 recommendedAction 只能返回 "buy"、"sell"、"mixed" 或 "wait" 其中之一，orders.action 只能返回 "buy" 或 "add"，sellOrders.action 只能返回 "sell" 或 "reduce"，不能返回说明文字。

候选股票：
${JSON.stringify(input.candidates, null, 2)}

请只返回这个 JSON 结构：
{
  "summary": "",
  "recommendedAction": "wait",
  "totalBudgetToUse": 0,
  "cashReserve": 0,
  "orders": [
    {
      "symbol": "",
      "action": "buy",
      "amount": 0,
      "shares": 0,
      "reason": "",
      "riskControl": "",
      "invalidIf": ""
    }
  ],
  "sellOrders": [
    {
      "symbol": "",
      "action": "reduce",
      "amount": 0,
      "shares": 0,
      "reason": "",
      "riskControl": "",
      "invalidIf": ""
    }
  ],
  "ranking": [
    { "symbol": "", "rank": 1, "view": "优先/观察/回避", "reason": "" }
  ],
  "disclaimer": "本内容由 AI 生成，仅供研究参考，不构成投资建议。"
}`;
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
      const candidate = candidatesBySymbol.get(order.symbol) ?? input.candidates.find((item) => item.symbol.replace(/\.(SH|SZ|BJ)$/, "") === order.symbol.replace(/\.(SH|SZ|BJ)$/, ""));
      const price = candidate?.price ?? 0;
      const remainingCash = Math.max(0, input.availableCash - spent);
      const shares = normalizeShares(order.shares || sharesFromAmount(order.amount, price), price, remainingCash);
      const amount = price > 0 ? Number((shares * price).toFixed(2)) : Number(order.amount.toFixed(2));
      const fee = calculateFee(amount);
      if (amount + fee > remainingCash) return null;
      spent += amount + fee;
      return {
        ...order,
        action: candidate?.isHolding ? ("add" as const) : ("buy" as const),
        symbol: candidate?.symbol ?? order.symbol,
        name: candidate?.name ?? null,
        estimatedPrice: price || null,
        shares,
        amount,
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
      const fee = calculateFee(amount);
      const netProceeds = Number((amount - fee).toFixed(2));
      const estimatedPnl = calculateSellPnl({
        sellAmount: amount,
        sellFee: fee,
        shares,
        holdingPrice: candidate?.holdingPrice ?? null
      });
      return {
        ...order,
        action: shares >= holdingShares ? ("sell" as const) : order.action,
        symbol: candidate?.symbol ?? order.symbol,
        name: candidate?.name ?? null,
        estimatedPrice: price || null,
        shares,
        amount,
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

function normalizeRankingItems(
  ranking: DecisionSchemaValue["ranking"],
  input: DecisionInput,
  orders: Array<{ symbol: string }>,
  sellOrders: Array<{ symbol: string }>
) {
  const candidatesBySymbol = new Map(input.candidates.flatMap((candidate) => symbolVariants(candidate.symbol).map((symbol) => [symbol, candidate] as const)));
  const buySymbols = new Set(orders.flatMap((order) => symbolVariants(order.symbol)));
  const sellSymbols = new Set(sellOrders.flatMap((order) => symbolVariants(order.symbol)));
  const covered = new Set(ranking.flatMap((item) => symbolVariants(item.symbol)));
  const normalized = ranking.map((item) => {
    const candidate = candidatesBySymbol.get(item.symbol.toUpperCase());
    if (!candidate) return item;
    const variants = symbolVariants(candidate.symbol);
    const hasBuy = variants.some((symbol) => buySymbols.has(symbol));
    const hasSell = variants.some((symbol) => sellSymbols.has(symbol));
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
    if (symbolVariants(candidate.symbol).some((symbol) => covered.has(symbol))) continue;
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
  const existing = new Set(output.flatMap((order) => symbolVariants(order.symbol)));
  for (const candidate of input.candidates) {
    const rankingClaimsSell = aiRankingClaimsSell(ranking, candidate);
    if (!candidateSupportsSell(candidate) && !rankingClaimsSell) continue;
    if (symbolVariants(candidate.symbol).some((symbol) => existing.has(symbol))) continue;
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
  const supportedSellSymbols = new Set(sellOrders.flatMap((order) => symbolVariants(order.symbol)));
  const rankingBySymbol = new Map(value.ranking.map((item) => [item.symbol, `${item.view} ${item.reason}`]));
  return input.candidates
    .filter((candidate) => candidate.isHolding)
    .filter((candidate) => !symbolVariants(candidate.symbol).some((symbol) => supportedSellSymbols.has(symbol)))
    .filter((candidate) => {
      const text = `${value.summary} ${rankingBySymbol.get(candidate.symbol) ?? ""}`;
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

function candidateSupportsBuy(candidate: Candidate) {
  if (!candidate.price || candidate.price <= 0) return false;
  if (!quantAllowsBuy(candidate)) return false;
  if (candidate.latestAnalysis?.trend === "bearish") return false;
  if ((candidate.latestAnalysis?.confidence ?? 0) < 0.55) return false;

  const advice = candidate.isHolding ? candidate.latestAnalysis?.holdAdvice : candidate.latestAnalysis?.entryAdvice;
  const text = stringifyAdvice(advice);
  if (/减仓|止损|离场|回避|不建议/.test(text)) return false;
  if (candidate.isHolding) return /加仓|增持|逢低|提高仓位/.test(text);
  return /买入|建仓|入场|轻仓|试探|逢低|条件触发|分批观察/.test(text) && !/仅观察|继续观察|观望/.test(text);
}

function candidateSupportsSell(candidate: Candidate) {
  if (!candidate.isHolding || !candidate.price || candidate.price <= 0 || !candidate.holdingShares || candidate.holdingShares <= 0) return false;
  if (!candidateHasFreshQuote(candidate)) return false;
  if (quantAllowsSell(candidate)) return true;
  const text = stringifyAdvice(candidate.latestAnalysis?.holdAdvice);
  const hardExit = /止损|离场|清仓|全部卖出|跌破止损|破位|重大利空/.test(text);
  if (candidate.quantSignal?.newPositionProtection && !hardExit) return false;
  return /减仓|止损|离场|回避|风险规避|止盈|分批兑现|降低仓位/.test(text);
}

function quantView(candidate: Candidate) {
  const action = candidate.quantSignal?.action;
  if (action === "buy" || action === "add") return "优先";
  if (action === "sell" || action === "reduce") return "减仓/卖出";
  if (action === "avoid") return "回避";
  if (action === "hold") return "持有观察";
  return "观察";
}

function quantReason(candidate: Candidate) {
  const signal = candidate.quantSignal;
  if (!signal) return candidate.latestAnalysis?.summary ?? "暂无量化信号。";
  const scores = `量化信号：${actionLabel(signal.action)}，买入分 ${signal.buyScore}/${signal.adjustedBuyThreshold}，卖出分 ${signal.sellScore}/${signal.adjustedReduceThreshold}，趋势分 ${signal.trendScore}，动量分 ${signal.momentumScore}，风险分 ${signal.riskScore}。`;
  const sizing = `仓位建议：买入资金 ${signal.suggestedBuyCapitalPct}%；卖出比例 ${signal.suggestedSellRatioPct}%${signal.suggestedSellShares ? `，约 ${signal.suggestedSellShares} 股/份` : ""}。`;
  const metrics = `风险收益比 ${signal.riskRewardRatio ?? "--"}，止损距离 ${formatPct(signal.stopDistancePct)}，止盈距离 ${formatPct(signal.takeProfitDistancePct)}。`;
  const context = `环境：${signal.marketRegime} / ${signal.sectorBias}${signal.newPositionProtection ? "，新仓保护中" : ""}。`;
  const reason = signal.reasons.slice(0, 2).join("；");
  const risk = signal.risks[0] ? `主要风险：${signal.risks[0]}` : "";
  return [scores, sizing, metrics, context, reason, risk, signal.exitPlan].filter(Boolean).join(" ");
}

function formatPct(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "--";
}

function actionLabel(action: QuantSignal["action"]) {
  const map: Record<QuantSignal["action"], string> = {
    buy: "买入观察",
    add: "增持观察",
    hold: "持有观察",
    watch: "继续观察",
    reduce: "减仓观察",
    sell: "卖出观察",
    avoid: "回避"
  };
  return map[action];
}

function quantAllowsBuy(candidate?: Candidate | null) {
  if (!candidateHasFreshQuote(candidate)) return false;
  if (!candidate?.quantSignal) return true;
  return (
    candidate.quantSignal.action === "buy" ||
    candidate.quantSignal.action === "add" ||
    candidate.quantSignal.buyScore >= candidate.quantSignal.adjustedBuyThreshold
  );
}

function quantAllowsSell(candidate?: Candidate | null) {
  if (!candidateHasFreshQuote(candidate)) return false;
  if (!candidate?.quantSignal) return false;
  const signal = candidate.quantSignal;
  if (signal.newPositionProtection && signal.action !== "sell" && signal.sellScore < signal.adjustedSellThreshold) return false;
  return (
    signal.action === "sell" ||
    signal.action === "reduce" ||
    signal.sellScore >= signal.adjustedReduceThreshold ||
    (signal.suggestedSellRatioPct ?? 0) > 0 ||
    (signal.suggestedSellShares ?? 0) >= 100
  );
}

function candidateHasFreshQuote(candidate?: Candidate | null) {
  if (!candidate?.price || candidate.price <= 0) return false;
  if (["stale", "unavailable", "error", "failed"].includes(candidate.status)) return false;
  if (!candidate.quoteTime) return false;
  return true;
}

function stringifyAdvice(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (isRecord(value)) return Object.values(value).filter((item) => typeof item === "string").join(" ");
  return "";
}

function symbolVariants(symbol: string) {
  const normalized = symbol.toUpperCase();
  const base = normalized.replace(/\.(SH|SZ|BJ)$/, "");
  if (!/^\d{6}$/.test(base)) return [normalized];
  return [normalized, base, `${base}.SH`, `${base}.SZ`, `${base}.BJ`];
}

function sameSymbol(a?: string | null, b?: string | null) {
  if (!a || !b) return false;
  return symbolVariants(a).includes(b.toUpperCase()) || symbolVariants(b).includes(a.toUpperCase());
}

function latestAnalysesForSymbols<T extends { id: string; symbol: string; createdAt: Date }>(symbols: string[], analyses: T[]) {
  const output = new Map<string, T>();
  for (const symbol of symbols) {
    const variants = symbolVariants(symbol);
    const match = analyses.find((analysis) => variants.includes(analysis.symbol));
    if (match) output.set(symbol, match);
  }
  return output;
}

function sharesFromAmount(amount: number, price: number | null) {
  if (!price || price <= 0) return 0;
  return Math.floor(amount / price / TRADING_FEE_RULE.lotSize) * TRADING_FEE_RULE.lotSize;
}

function normalizeShares(shares: number, price: number, availableCash: number) {
  if (!price || price <= 0) return 0;
  let nextShares = Math.floor(shares / TRADING_FEE_RULE.lotSize) * TRADING_FEE_RULE.lotSize;
  while (nextShares > 0) {
    const amount = nextShares * price;
    if (amount + calculateFee(amount) <= availableCash) return nextShares;
    nextShares -= TRADING_FEE_RULE.lotSize;
  }
  return 0;
}

function normalizeSellShares(shares: number, holdingShares: number) {
  if (!Number.isFinite(holdingShares) || holdingShares <= 0) return 0;
  const capped = Math.min(Math.max(0, shares), holdingShares);
  if (capped <= 0 || holdingShares < TRADING_FEE_RULE.lotSize) return 0;
  if (capped < TRADING_FEE_RULE.lotSize) return TRADING_FEE_RULE.lotSize;
  return Math.floor(capped / TRADING_FEE_RULE.lotSize) * TRADING_FEE_RULE.lotSize;
}

function fallbackSellShares(holdingShares: number, adviceText: string) {
  if (!Number.isFinite(holdingShares) || holdingShares <= 0) return 0;
  if (/止损|离场|回避/.test(adviceText)) return normalizeSellShares(holdingShares, holdingShares);
  return normalizeSellShares(Math.max(TRADING_FEE_RULE.lotSize, holdingShares * 0.5), holdingShares);
}

function calculateSellPnl(input: { sellAmount: number; sellFee: number; shares: number; holdingPrice?: number | null }) {
  const holdingPrice = input.holdingPrice ?? 0;
  if (!holdingPrice || holdingPrice <= 0 || input.shares <= 0) return null;
  const costAmount = holdingPrice * input.shares;
  const buyFeeShare = calculateFee(costAmount);
  return Number((input.sellAmount - input.sellFee - costAmount - buyFeeShare).toFixed(2));
}

function calculateInvestedCost(items: Array<{ holdingPrice: unknown; holdingShares: unknown }>) {
  const total = items.reduce((sum, item) => {
    const price = toNumber(item.holdingPrice) ?? 0;
    const shares = toNumber(item.holdingShares) ?? 0;
    if (price <= 0 || shares <= 0) return sum;
    const amount = price * shares;
    return sum + amount + calculateFee(amount);
  }, 0);
  return Number(total.toFixed(2));
}

function calculateCurrentMarketValue(
  items: Array<{ symbol: string; holdingPrice?: unknown; holdingShares: unknown }>,
  quotes: Record<string, { price?: number | null } | null | undefined>
) {
  return calculatePortfolioMarketValue(items, quotes).value;
}

function calculatePortfolioMarketValue(
  items: Array<{ symbol: string; holdingPrice?: unknown; holdingShares: unknown }>,
  quotes: Record<string, { price?: number | null; status?: string } | null | undefined>
) {
  if (!items.length) return { value: 0, status: "empty" as const };
  let usedStaleQuote = 0;
  let usedCostFallback = 0;
  const total = items.reduce((sum, item) => {
    const shares = toNumber(item.holdingShares) ?? 0;
    if (shares <= 0) return sum;
    const quote = quotes[item.symbol] ?? quotes[symbolVariants(item.symbol).find((symbol) => quotes[symbol]) ?? item.symbol];
    const quotePrice = quote?.price ?? null;
    const price = quotePrice ?? toNumber(item.holdingPrice) ?? null;
    if (!price || price <= 0) return sum;
    if (quotePrice && quotePrice > 0) {
      if (quote?.status === "stale") usedStaleQuote += 1;
    } else {
      usedCostFallback += 1;
    }
    return sum + price * shares;
  }, 0);
  const value = Number(total.toFixed(2));
  const activeItems = items.filter((item) => (toNumber(item.holdingShares) ?? 0) > 0).length;
  if (activeItems === 0) return { value, status: "empty" as const };
  const status: PortfolioValuationStatus = usedCostFallback >= activeItems
    ? "cost_fallback"
    : usedCostFallback > 0
      ? "partial_fallback"
      : usedStaleQuote > 0
        ? "stale"
        : "live";
  return { value, status };
}

function calculateRealizedPnl(items: Array<{ realizedPnl: unknown }>) {
  const total = items.reduce((sum, item) => sum + (toNumber(item.realizedPnl) ?? 0), 0);
  return Number(total.toFixed(2));
}

function calculateFee(amount: number) {
  return Number((Math.max(amount, TRADING_FEE_RULE.minimumFeeBase) * TRADING_FEE_RULE.rate).toFixed(2));
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

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
