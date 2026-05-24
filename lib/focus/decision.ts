import { createHash } from "node:crypto";
import type { FocusDecision as StoredFocusDecision, Prisma } from "@prisma/client";

import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { z } from "zod";

import { getAiConfig } from "@/lib/ai/config";
import { createDecisionHistoryFromFocusDecision, refreshAnalysisRun } from "@/lib/analysis/runRecords";
import { createChatCompletion } from "@/lib/ai/deepseek";
import { getCache, setCache } from "@/lib/cache";
import { AppError } from "@/lib/errors";
import { notifyFocusDecision } from "@/lib/notifications/send";
import { prisma } from "@/lib/prisma";
import { getQuotesBatch } from "@/lib/services/quoteService";
import { toNumber } from "@/lib/utils";

const TRADING_FEE_RULE = {
  rate: 0.0005,
  minimumFeeBase: 10000,
  minimumFee: 5,
  lotSize: 100,
  description: "买入手续费为成交金额的万分之五；若成交金额不足 10000 元，按 10000 元计费，即最低手续费 5 元。A 股/ETF 按 100 股/份整数手买入。"
};

const decisionSchema = z.object({
  summary: z.string().min(1),
  recommendedAction: z.enum(["buy", "wait"]),
  totalBudgetToUse: z.coerce.number().min(0).default(0),
  cashReserve: z.coerce.number().min(0).default(0),
  orders: z
    .array(
      z.object({
        symbol: z.string().min(1),
        action: z.enum(["buy", "watch", "avoid"]),
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

type Candidate = {
  symbol: string;
  name?: string | null;
  price: number | null;
  changePct: number | null;
  status: string;
  note?: string | null;
  riskLevel?: string;
  isHolding?: boolean;
  holdingPrice?: number | null;
  positionOpenedAt?: Date | null;
  targetPrice?: number | null;
  stopLoss?: number | null;
  latestAnalysis?: {
    trend?: string;
    confidence?: number;
    summary?: string;
    holdAdvice?: unknown;
    entryAdvice?: unknown;
    riskFactors?: unknown;
  } | null;
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
  const seed = await loadDecisionSeed(userId);
  const inputHash = createDecisionSignature(seed);
  const exact = await prisma.focusDecision.findFirst({
    where: { userId, inputHash },
    orderBy: { createdAt: "desc" }
  });
  if (exact) return attachStoredMetadata(exact, { fromCache: true, stale: false });

  const latest = await prisma.focusDecision.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" }
  });
  return latest ? attachStoredMetadata(latest, { fromCache: true, stale: true }) : null;
}

export async function generateAndStoreFocusDecision(options: GenerateFocusDecisionOptions) {
  const source = options.source ?? "manual";
  const seed = await loadDecisionSeed(options.userId);
  const inputHash = createDecisionSignature(seed);
  const cacheKey = `focus_decision:${options.userId}:${inputHash}`;

  if (!options.forceRefresh) {
    const stored = await prisma.focusDecision.findFirst({
      where: { userId: options.userId, inputHash },
      orderBy: { createdAt: "desc" }
    });
    if (stored) return attachStoredMetadata(stored, { fromCache: true, stale: false });

    const cached = await getCache<Awaited<ReturnType<typeof generateFocusDecision>>>(cacheKey);
    if (cached) return { ...cached, fromCache: true, stale: false };
  }

  const input = await loadDecisionInput(seed);
  const decision = await generateFocusDecision(input);
  await setCache(cacheKey, decision, numberEnv("FOCUS_DECISION_CACHE_TTL_SECONDS", 900));
  const row = await upsertStoredDecision({
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
  await notifyFocusDecision({
    userId: options.userId,
    decisionId: row.id,
    source,
    summary: decision.summary,
    generatedAt: new Date(),
    orders: decision.orders,
    cashReserve: decision.cashReserve,
    totalBudgetToUse: decision.totalBudgetToUse,
    totalEstimatedFee: decision.totalEstimatedFee
  }).catch(() => null);
  return attachStoredMetadata(row, { fromCache: false, stale: false });
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

function attachStoredMetadata(row: StoredFocusDecision, metadata: { fromCache: boolean; stale: boolean }) {
  const decision = isRecord(row.decisionJson) ? row.decisionJson : {};
  return {
    ...decision,
    decisionId: row.id,
    persistedAt: row.updatedAt.toISOString(),
    scheduledFor: row.scheduledFor?.toISOString() ?? null,
    source: row.source,
    fromCache: metadata.fromCache,
    stale: metadata.stale
  };
}

async function loadDecisionSeed(userId: string) {
  const focus = await prisma.focusGroup.findUnique({ where: { userId } });
  if (!focus?.symbols.length) throw new AppError("BAD_REQUEST", "请先在今日关注中选择股票。");

  const capital = toNumber(focus.capital);
  if (!capital || capital <= 0) throw new AppError("BAD_REQUEST", "请先填写总本金，AI 才能计算买入金额。");

  const symbols = [...new Set(focus.symbols.map((symbol) => symbol.toUpperCase()))];
  const allSymbolVariants = symbols.flatMap(symbolVariants);
  const analyses = await prisma.aiAnalysis.findMany({
    where: { userId, symbol: { in: allSymbolVariants } },
    orderBy: { createdAt: "desc" },
    take: Math.max(20, symbols.length * 5)
  });
  const watchlistItems = await prisma.watchlistItem.findMany({
    where: { watchlist: { userId }, symbol: { in: allSymbolVariants } },
    select: {
      symbol: true,
      isHolding: true,
      holdingPrice: true,
      targetPrice: true,
      stopLoss: true,
      positionOpenedAt: true
    }
  });
  const latestAnalysisBySymbol = latestAnalysesForSymbols(symbols, analyses);
  const positionSignature = symbols.map((symbol) => {
    const variants = symbolVariants(symbol);
    const item = watchlistItems.find((row) => variants.includes(row.symbol));
    return {
      symbol,
      isHolding: item?.isHolding ?? false,
      holdingPrice: toNumber(item?.holdingPrice),
      targetPrice: toNumber(item?.targetPrice),
      stopLoss: toNumber(item?.stopLoss),
      positionOpenedAt: item?.positionOpenedAt?.toISOString() ?? null
    };
  });

  return {
    userId,
    capital,
    symbols,
    allSymbolVariants,
    focusUpdatedAt: focus.updatedAt.toISOString(),
    focusLastAnalysis: focus.lastAnalysis?.toISOString() ?? null,
    analyses,
    latestAnalysisBySymbol,
    positionSignature
  };
}

async function loadDecisionInput(seed: Awaited<ReturnType<typeof loadDecisionSeed>>) {
  const [watchlistItems, quotes] = await Promise.all([
    prisma.watchlistItem.findMany({
      where: { watchlist: { userId: seed.userId }, symbol: { in: seed.allSymbolVariants } }
    }),
    getQuotesBatch(seed.symbols, { allowStale: true })
  ]);

  const candidates = seed.symbols.map((symbol) => {
    const variants = symbolVariants(symbol);
    const quote = quotes[symbol] ?? quotes[symbolVariants(symbol).find((item) => quotes[item]) ?? symbol] ?? null;
    const item = watchlistItems.find((row) => variants.includes(row.symbol));
    const analysis = seed.latestAnalysisBySymbol.get(symbol) ?? null;
    const output = analysis?.outputJson as Candidate["latestAnalysis"] | undefined;
    const holdingPrice = toNumber(item?.holdingPrice);
    return {
      symbol: quote?.symbol ?? symbol,
      name: quote?.name ?? null,
      price: quote?.price ?? null,
      changePct: quote?.changePct ?? null,
      status: quote?.status ?? "unavailable",
      note: item?.note ?? null,
      riskLevel: item?.riskLevel,
      isHolding: item?.isHolding ?? false,
      holdingPrice,
      positionOpenedAt: item?.positionOpenedAt ?? null,
      targetPrice: toNumber(item?.targetPrice),
      stopLoss: toNumber(item?.stopLoss),
      latestAnalysis: output
        ? {
            trend: output.trend,
            confidence: output.confidence,
            summary: output.summary,
            holdAdvice: output.holdAdvice,
            entryAdvice: output.entryAdvice,
            riskFactors: output.riskFactors
          }
        : null
    } satisfies Candidate;
  });

  return {
    capital: seed.capital,
    candidates,
    focusUpdatedAt: seed.focusUpdatedAt,
    focusLastAnalysis: seed.focusLastAnalysis,
    latestAnalysisIds: [...seed.latestAnalysisBySymbol.values()].map((analysis) => analysis.id)
  };
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
        latestAnalysisIds: [...input.latestAnalysisBySymbol.values()].map((analysis) => analysis.id)
      })
    )
    .digest("hex")
    .slice(0, 16);
}

async function generateFocusDecision(input: { capital: number; candidates: Candidate[] }) {
  const config = await getAiConfig();
  if (!config.apiKey) return buildFallbackDecision(input, "AI API key 未配置，已使用本地规则生成临时决策。");

  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl || undefined });
  const request: ChatCompletionCreateParamsNonStreaming = {
    model: config.model,
    temperature: 0.2,
    max_tokens: numberEnv("AI_FOCUS_DECISION_MAX_TOKENS", 1400),
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "你是一个谨慎的股票组合决策助手。你必须基于给定候选股票、最新分析、价格和手续费规则，回答今天是否应该买、买哪只、花多少钱买。不能保证收益，不能编造数据。输出必须是严格 JSON，所有自然语言字段使用简体中文。"
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

function buildDecisionPrompt(input: { capital: number; candidates: Candidate[] }) {
  return `请从今日关注股票中给出买入决策。返回严格 JSON，不要 Markdown。

总本金：${input.capital} 元

交易手续费规则：
${JSON.stringify(TRADING_FEE_RULE, null, 2)}

决策要求：
1. 必须明确 recommendedAction 是 buy 还是 wait。
2. 每个候选都有 isHolding。isHolding=true 表示用户已经持仓，buy 只能代表“增持/加仓”；只有 holdAdvice 明确偏向加仓、增持、逢低加仓，且风险可控时才允许生成 buy 订单。
3. isHolding=false 表示用户未持仓，buy 代表“新买入/建仓”；必须主要依据 entryAdvice 判断，若 entryAdvice 是等待、不建议入场、回避、观望，则不能买。
4. 如果最新分析 trend=bearish、confidence 低于 0.55、行情价格不可用、或建议里出现减仓/止损/离场/回避，应 recommendedAction=wait 或在 ranking 标为回避。
5. 如果建议买入，orders 里最多给 2 笔 buy；必须写清 symbol、amount、shares、reason、riskControl、invalidIf。reason 必须说明这是“新买入”还是“增持”。
6. amount 是计划成交金额，不含手续费；shares 必须按 100 股/份整数手计算，不能超过总本金扣除手续费后的可用金额。
7. 手续费按 max(amount, 10000) * 0.0005 计算。不足 10000 元的交易也要按 10000 元计费，即最低手续费 5 元；如果因为金额太小导致手续费占比不划算，应建议等待或合并交易。
8. 如果没有足够确定性，宁可 recommendedAction=wait，并说明等待什么触发条件。
9. 不要机械平均分配资金，要按趋势、置信度、风险、持仓状态、已有持仓计划和手续费性价比排序。
10. ranking 必须覆盖所有候选，并在 reason 里体现“已持仓/未持仓”和对应的持仓建议或入场建议。

候选股票：
${JSON.stringify(input.candidates, null, 2)}

请只返回这个 JSON 结构：
{
  "summary": "",
  "recommendedAction": "buy | wait",
  "totalBudgetToUse": 0,
  "cashReserve": 0,
  "orders": [
    {
      "symbol": "",
      "action": "buy | watch | avoid",
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

function normalizeDecision(value: z.infer<typeof decisionSchema>, input: { capital: number; candidates: Candidate[] }, fallbackReason: string | null) {
  const candidatesBySymbol = new Map(input.candidates.map((candidate) => [candidate.symbol, candidate]));
  let spent = 0;
  const orders = value.orders
    .filter((order) => order.action === "buy")
    .slice(0, 2)
    .map((order) => {
      const candidate = candidatesBySymbol.get(order.symbol) ?? input.candidates.find((item) => item.symbol.replace(/\.(SH|SZ|BJ)$/, "") === order.symbol.replace(/\.(SH|SZ|BJ)$/, ""));
      const price = candidate?.price ?? 0;
      const shares = normalizeShares(order.shares || sharesFromAmount(order.amount, price), price, input.capital - spent);
      const amount = price > 0 ? Number((shares * price).toFixed(2)) : Number(order.amount.toFixed(2));
      const fee = calculateFee(amount);
      if (amount + fee > input.capital - spent) return null;
      spent += amount + fee;
      return {
        ...order,
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

  return {
    ...value,
    recommendedAction: orders.length ? value.recommendedAction : "wait",
    summary: orders.length || value.recommendedAction === "wait" ? value.summary : `当前没有形成可执行买入单，已改为等待。${value.summary}`,
    orders,
    totalBudgetToUse: Number(orders.reduce((sum, order) => sum + order.amount, 0).toFixed(2)),
    totalEstimatedFee: Number(orders.reduce((sum, order) => sum + order.estimatedFee, 0).toFixed(2)),
    totalEstimatedCost: Number(orders.reduce((sum, order) => sum + order.totalCost, 0).toFixed(2)),
    cashReserve: Number((input.capital - orders.reduce((sum, order) => sum + order.totalCost, 0)).toFixed(2)),
    capital: input.capital,
    feeRule: TRADING_FEE_RULE,
    fallbackReason,
    generatedAt: new Date().toISOString()
  };
}

function buildFallbackDecision(input: { capital: number; candidates: Candidate[] }, reason: string) {
  const ranked = input.candidates
    .filter(candidateSupportsBuy)
    .sort((a, b) => (b.latestAnalysis?.confidence ?? 0) - (a.latestAnalysis?.confidence ?? 0));
  const best = ranked[0];
  if (!best?.price || (best.latestAnalysis?.confidence ?? 0) < 0.55) {
    return normalizeDecision(
      {
        summary: "当前没有足够清晰的买入候选，建议等待更高置信度的信号。",
        recommendedAction: "wait",
        totalBudgetToUse: 0,
        cashReserve: input.capital,
        orders: [],
        ranking: input.candidates.map((candidate, index) => ({
          symbol: candidate.symbol,
          rank: index + 1,
          view: "观察",
          reason: candidate.latestAnalysis?.summary ?? "暂无足够分析。"
        })),
        disclaimer: "本内容由本地规则生成，仅供研究参考，不构成投资建议。"
      },
      input,
      reason
    );
  }

  const targetAmount = Math.min(input.capital * 0.3, input.capital - TRADING_FEE_RULE.minimumFee);
  return normalizeDecision(
    {
      summary: `本地规则优先选择 ${best.symbol}，但仍需等待真实 AI 服务恢复后复核。`,
      recommendedAction: "buy",
      totalBudgetToUse: targetAmount,
      cashReserve: input.capital - targetAmount,
      orders: [
        {
          symbol: best.symbol,
          action: "buy",
          amount: targetAmount,
          shares: sharesFromAmount(targetAmount, best.price),
          reason: `${best.isHolding ? "已持仓，按本地规则仅视为增持候选。" : "未持仓，按本地规则视为新买入候选。"}${best.latestAnalysis?.summary ? ` ${best.latestAnalysis.summary}` : "趋势和置信度在候选中相对更高。"}`,
          riskControl: "若跌破最近分析给出的止损或关键支撑，停止加仓并复核。",
          invalidIf: "AI 服务恢复后结论相反，或价格快速偏离计划买入区间。"
        }
      ],
      ranking: ranked.map((candidate, index) => ({
        symbol: candidate.symbol,
        rank: index + 1,
        view: index === 0 ? "优先" : "观察",
        reason: candidate.latestAnalysis?.summary ?? "暂无摘要。"
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
  if (candidate.latestAnalysis?.trend === "bearish") return false;
  if ((candidate.latestAnalysis?.confidence ?? 0) < 0.55) return false;

  const advice = candidate.isHolding ? candidate.latestAnalysis?.holdAdvice : candidate.latestAnalysis?.entryAdvice;
  const text = stringifyAdvice(advice);
  if (/减仓|止损|离场|回避|不建议|等待|观望/.test(text)) return false;
  if (candidate.isHolding) return /加仓|增持|逢低|提高仓位/.test(text);
  return /买入|建仓|入场|轻仓|试探|逢低/.test(text);
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

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
