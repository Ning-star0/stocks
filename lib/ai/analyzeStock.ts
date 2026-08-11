import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

import { getAiConfig, selectAiModel } from "@/lib/ai/config";
import { createChatCompletion } from "@/lib/ai/deepseek";
import { buildUserPrompt, STOCK_ANALYSIS_SYSTEM_PROMPT } from "@/lib/ai/stockAnalysisPrompt";
import type { AnalyzeStockInput } from "@/lib/ai/stockAnalysisTypes";
import { AppError } from "@/lib/errors";
import { aiAnalysisSchema } from "@/lib/schemas";
import { containsCjk, toSimplifiedChinese } from "@/lib/text/simplifiedChinese";
import {
  calculateTradingFee,
  roundMoney,
  TRADE_FEE_MIN_BASE,
  TRADE_FEE_RULE,
  TRADE_LOT_SIZE
} from "@/lib/trading/rules";
import { calculateTradeEconomics, tradeEconomicsBlockReason } from "@/lib/trading/economics";
import type { AiAnalysisResult } from "@/lib/types";

export type { AnalyzeStockInput } from "@/lib/ai/stockAnalysisTypes";

export async function analyzeStock(input: AnalyzeStockInput): Promise<AiAnalysisResult> {
  const config = await getAiConfig();
  if (!config.apiKey) {
    return buildFallbackAnalysis(input, "API key 未配置，系统已改用本地规则生成临时分析。");
  }

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl || undefined
  });

  const userPrompt = buildUserPrompt(input);
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const request: ChatCompletionCreateParamsNonStreaming = {
        model: selectAiModel(config, "flagship"),
        temperature: 0.2,
        max_tokens: numberEnv("AI_STOCK_MAX_TOKENS", 4000),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: STOCK_ANALYSIS_SYSTEM_PROMPT },
          {
            role: "user",
            content:
              attempt === 0
                ? userPrompt
                : `${userPrompt}\n\n上一次输出没有通过 JSON/schema 校验。请只返回一个 JSON 对象，枚举值必须严格使用 schema 中的英文值，不能输出 Markdown。`
          }
        ]
      };
      const completion = await createChatCompletion(client, request);

      const text = completion.choices[0]?.message?.content;
      if (!text) throw new Error("AI 返回了空内容。");
      const parsed = parseJsonObject(text);
      return aiAnalysisSchema.parse(normalizeStockAnalysis(parsed, input));
    } catch (error) {
      lastError = error;
      if (error instanceof AppError && (error.code === "DATA_PROVIDER_ERROR" || error.code === "RATE_LIMIT")) break;
    }
  }

  if (lastError instanceof AppError) {
    return buildFallbackAnalysis(input, `AI 服务请求失败，系统已改用本地规则生成临时分析。原因：${lastError.message}`);
  }

  return buildFallbackAnalysis(
    input,
    `AI 返回内容多次未通过 JSON/schema 校验，系统已改用本地规则生成临时分析。原因：${lastError instanceof Error ? lastError.message : "未知错误"}`
  );
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseJsonObject(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const candidates = [
    cleaned,
    extractJsonObject(cleaned),
    normalizeJsonLikeText(cleaned),
    normalizeJsonLikeText(extractJsonObject(cleaned))
  ].filter(Boolean);

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("AI 返回内容不是可解析的 JSON 对象。");
}

function extractJsonObject(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : "";
}

function normalizeJsonLikeText(text: string) {
  return text
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1")
    .trim();
}

function normalizeStockAnalysis(value: unknown, input: AnalyzeStockInput) {
  const record = isRecord(value) ? value : {};
  const keyLevels = isRecord(record.keyLevels) ? record.keyLevels : {};
  const actions = Array.isArray(record.possibleActions) ? record.possibleActions : [];
  const riskFactors = toStringArray(record.riskFactors);
  const dataScope = normalizeDataScope(record.dataScope, input);
  const newsReferences = normalizeNewsReferences(record.newsReferences, input.recentNews);
  const webSearchResults = normalizeWebSearchResults(record.webSearchResults, input.webSearchResults);

  const normalized = {
    trend: normalizeTrend(record.trend),
    confidence: normalizeConfidence(record.confidence),
    analysisAsOf: toNonEmptyString(record.analysisAsOf, input.analysisAsOf ?? new Date().toISOString()),
    dataScope,
    summary: ensureChineseAnalysisText(toNonEmptyString(record.summary, buildDefaultSummary(input, dataScope)), buildDefaultSummary(input, dataScope)),
    newsSummary: ensureChineseAnalysisText(toNonEmptyString(record.newsSummary, buildFallbackNewsSummary(input.recentNews, input.webSearchResults)), buildFallbackNewsSummary(input.recentNews, input.webSearchResults)),
    newsSentiment: normalizeNewsSentiment(record.newsSentiment),
    webSearchSummary: ensureChineseAnalysisText(toNonEmptyString(record.webSearchSummary, buildWebSearchSummary(webSearchResults)), buildWebSearchSummary(webSearchResults)),
    newsReferences,
    webSearchResults,
    catalystEvents: toChineseStringArray(record.catalystEvents),
    macroRisks: toChineseStringArray(record.macroRisks),
    sectorRisks: toChineseStringArray(record.sectorRisks),
    keyLevels: {
      support: toNumberArray(keyLevels.support ?? record.support),
      resistance: toNumberArray(keyLevels.resistance ?? record.resistance)
    },
    riskFactors: riskFactors.length && riskFactors.every(containsCjk) ? riskFactors.map(toSimplifiedChinese) : ["AI 未提供明确风险因素，请结合行情、新闻和自身风险承受能力复核。"],
    possibleActions: actions.length
      ? actions.map(normalizeAction).filter(Boolean)
      : [
          {
            action: "watch",
            reason: "AI 未提供完整操作计划，建议继续观察关键价位、成交量和新闻变化。",
            timing: "观察",
            triggerCondition: "等待价格接近支撑/压力位、成交量明显变化或出现高重要性新闻后再复核。",
            entryZone: "",
            stopLossPlan: "以用户持仓设置中的止损价或关键支撑跌破作为风险边界。",
            takeProfitPlan: "以目标价、压力位或趋势转弱信号作为分批止盈参考。",
            positionSizing: "未形成明确信号前控制仓位，不因单一指标扩大风险。",
            followUpCheck: "复核 RSI、MACD、均线状态、成交量和相关新闻是否同步改善。",
            invalidIf: "价格、成交量、技术指标或相关新闻发生明显变化。"
          }
        ],
    holdAdvice: normalizeHoldAdvice(record.holdAdvice, actions),
    entryAdvice: normalizeEntryAdvice(record.entryAdvice, actions),
    disclaimer: toNonEmptyString(record.disclaimer, "本内容由 AI 生成，仅供研究参考，不构成投资建议。")
  };

  return {
    ...normalized,
    tradePlan: buildAnalysisTradePlan(normalized, input)
  };
}

function normalizeHoldAdvice(value: unknown, actions: unknown[]) {
  const record = isRecord(value) ? value : {};
  const holdAction = actions.find((a) => isRecord(a) && String(a.action ?? "").toLowerCase().includes("hold"));

  return {
    action: ensureChineseAnalysisText(toNonEmptyString(record.action, "继续持有观察"), "继续持有观察"),
    reason: ensureChineseAnalysisText(toNonEmptyString(record.reason, holdAction ? String((holdAction as Record<string,unknown>).reason ?? "") : ""), "趋势尚可但需警惕风险，建议持有观察。"),
    stopLoss: ensureChineseOptionalText(record.stopLoss || (holdAction ? (holdAction as Record<string,unknown>).stopLossPlan : "")),
    takeProfit: ensureChineseOptionalText(record.takeProfit || (holdAction ? (holdAction as Record<string,unknown>).takeProfitPlan : "")),
    positionManagement: ensureChineseOptionalText(record.positionManagement || (holdAction ? (holdAction as Record<string,unknown>).positionSizing : "")),
    keyMonitorPoints: ensureChineseOptionalText(record.keyMonitorPoints || (holdAction ? (holdAction as Record<string,unknown>).followUpCheck : "")),
    invalidIf: ensureChineseAnalysisText(toNonEmptyString(record.invalidIf, holdAction ? String((holdAction as Record<string,unknown>).invalidIf ?? "") : ""), "关键价位被突破或行业出现重大变化。")
  };
}

function normalizeEntryAdvice(value: unknown, actions: unknown[]) {
  const record = isRecord(value) ? value : {};
  const entryAction = actions.find((a) => isRecord(a) && (String(a.action ?? "").toLowerCase().includes("watch") || String(a.action ?? "").toLowerCase().includes("entry") || String(a.action ?? "").toLowerCase().includes("consider")));

  return {
    action: ensureChineseAnalysisText(toNonEmptyString(record.action, "等待回调"), "等待回调"),
    reason: ensureChineseAnalysisText(toNonEmptyString(record.reason, entryAction ? String((entryAction as Record<string,unknown>).reason ?? "") : ""), "当前价位追高风险较大，建议等待更好的入场时机。"),
    entryZone: ensureChineseOptionalText(record.entryZone || (entryAction ? (entryAction as Record<string,unknown>).entryZone : "")),
    timing: ensureChineseOptionalText(record.timing || (entryAction ? (entryAction as Record<string,unknown>).timing : "")),
    triggerCondition: ensureChineseOptionalText(record.triggerCondition || (entryAction ? (entryAction as Record<string,unknown>).triggerCondition : "")),
    firstPositionSize: ensureChineseOptionalText(record.firstPositionSize || (entryAction ? (entryAction as Record<string,unknown>).positionSizing : "")),
    stopLoss: ensureChineseOptionalText(record.stopLoss || (entryAction ? (entryAction as Record<string,unknown>).stopLossPlan : "")),
    takeProfit: ensureChineseOptionalText(record.takeProfit || (entryAction ? (entryAction as Record<string,unknown>).takeProfitPlan : "")),
    invalidIf: ensureChineseAnalysisText(toNonEmptyString(record.invalidIf, entryAction ? String((entryAction as Record<string,unknown>).invalidIf ?? "") : ""), "价格快速脱离入场区间或出现重大利空。")
  };
}

function normalizeDataScope(value: unknown, input: AnalyzeStockInput) {
  const record = isRecord(value) ? value : {};
  const fallback = input.dataScope ?? {};
  return {
    quoteTime: toNullableString(record.quoteTime, fallback.quoteTime ?? getQuoteTime(input.quote)),
    historyRange: toNonEmptyString(record.historyRange, fallback.historyRange ?? "1y"),
    historyInterval: toNonEmptyString(record.historyInterval, fallback.historyInterval ?? "1d"),
    historyFrom: toNullableString(record.historyFrom, fallback.historyFrom ?? null),
    historyTo: toNullableString(record.historyTo, fallback.historyTo ?? null),
    historyCandles: toInteger(record.historyCandles, fallback.historyCandles ?? 0),
    newsWindow: toNonEmptyString(record.newsWindow, fallback.newsWindow ?? "最近 7 天，高重要性新闻优先"),
    newsCount: toInteger(record.newsCount, fallback.newsCount ?? countArray(input.recentNews)),
    webSearchStatus: toNonEmptyString(record.webSearchStatus, fallback.webSearchStatus ?? "未执行联网新闻检索")
  };
}

function normalizeTrend(value: unknown): AiAnalysisResult["trend"] {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("bull") || text.includes("positive") || text.includes("看多") || text.includes("偏多")) return "bullish";
  if (text.includes("bear") || text.includes("negative") || text.includes("看空") || text.includes("偏空")) return "bearish";
  return "neutral";
}

function normalizeNewsSentiment(value: unknown): AiAnalysisResult["newsSentiment"] {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("mixed") || text.includes("分歧") || text.includes("混合")) return "mixed";
  if (text.includes("positive") || text.includes("利好") || text.includes("正面")) return "positive";
  if (text.includes("negative") || text.includes("利空") || text.includes("负面")) return "negative";
  return "neutral";
}

function normalizeAction(value: unknown) {
  const record = isRecord(value) ? value : {};
  const text = String(record.action ?? "").toLowerCase();
  const action =
    text.includes("reduce") || text.includes("减")
      ? "reduce"
      : text.includes("entry") || text.includes("买") || text.includes("consider")
        ? "consider_entry"
        : text.includes("avoid") || text.includes("回避")
          ? "avoid"
          : text.includes("hold") || text.includes("持有")
            ? "hold"
            : "watch";
  return {
    action,
    reason: ensureChineseAnalysisText(toNonEmptyString(record.reason, "AI 未提供原因。"), "AI 未提供原因。"),
    timing: ensureChineseOptionalText(record.timing),
    triggerCondition: ensureChineseOptionalText(record.triggerCondition),
    entryZone: ensureChineseOptionalText(record.entryZone),
    stopLossPlan: ensureChineseOptionalText(record.stopLossPlan),
    takeProfitPlan: ensureChineseOptionalText(record.takeProfitPlan),
    positionSizing: ensureChineseOptionalText(record.positionSizing),
    followUpCheck: ensureChineseOptionalText(record.followUpCheck),
    invalidIf: ensureChineseAnalysisText(toNonEmptyString(record.invalidIf, "关键数据发生明显变化。"), "关键数据发生明显变化。")
  };
}

function normalizeConfidence(value: unknown) {
  const number = typeof value === "number" ? value : Number(String(value ?? "").replace("%", ""));
  if (!Number.isFinite(number)) return 0.5;
  const normalized = number > 1 ? number / 100 : number;
  return Math.min(1, Math.max(0, normalized));
}

function normalizeNewsReferences(value: unknown, fallback: unknown) {
  const values = Array.isArray(value) && value.length ? value : Array.isArray(fallback) ? fallback : [];
  return values.map(toNewsReference).filter((item): item is NonNullable<ReturnType<typeof toNewsReference>> => Boolean(item)).slice(0, 10);
}

function normalizeWebSearchResults(value: unknown, fallback: unknown) {
  const values = Array.isArray(value) && value.length ? value : Array.isArray(fallback) ? fallback : [];
  return values.map(toWebSearchResult).filter((item): item is NonNullable<ReturnType<typeof toWebSearchResult>> => Boolean(item)).slice(0, 8);
}

function toNewsReference(value: unknown) {
  const record = isRecord(value) ? value : {};
  const title = String(record.title ?? "").trim();
  if (!title) return null;
  return {
    title,
    source: toNullableString(record.source, null),
    publishedAt: toNullableString(record.publishedAt, null),
    url: normalizeUrl(record.url),
    sentiment: toNullableString(record.sentiment, null),
    impactLevel: toNullableString(record.impactLevel, null)
  };
}

function toWebSearchResult(value: unknown) {
  const record = isRecord(value) ? value : {};
  const title = String(record.title ?? "").trim();
  if (!title) return null;
  return {
    title,
    source: toNullableString(record.source, null),
    publishedAt: toNullableString(record.publishedAt, null),
    url: normalizeUrl(record.url),
    summary: toNullableString(record.summary, null)
  };
}

function normalizeUrl(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  try {
    return new URL(text).toString();
  } catch {
    return null;
  }
}

function toNumberArray(value: unknown) {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return values.map((item) => (typeof item === "number" ? item : Number.parseFloat(String(item)))).filter((item) => Number.isFinite(item));
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function toNonEmptyString(value: unknown, fallback: string) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function toNullableString(value: unknown, fallback: string | null) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function toInteger(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function countArray(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getQuoteTime(quote: unknown) {
  const record = isRecord(quote) ? quote : {};
  return typeof record.timestamp === "string" ? record.timestamp : null;
}

function buildDefaultSummary(input: AnalyzeStockInput, scope: ReturnType<typeof normalizeDataScope>) {
  return `本分析截至 ${input.analysisAsOf ?? new Date().toISOString()}，报价时间 ${scope.quoteTime ?? "未知"}，历史数据范围 ${scope.historyRange ?? "未知"} / ${scope.historyInterval ?? "未知"}。当前数据不足以形成更完整的 AI 摘要。`;
}

function buildFallbackNewsSummary(recentNews: unknown, webSearchResults: unknown) {
  const combined = [...(Array.isArray(recentNews) ? recentNews : []), ...(Array.isArray(webSearchResults) ? webSearchResults : [])];
  if (!combined.length) return "暂无已分析的相关新闻或联网检索结果。";
  const text = combined
    .slice(0, 3)
    .map((item) => {
      const news = item as { title?: string; summary?: string; aiSummary?: string };
      return news.aiSummary ?? news.summary ?? news.title ?? "未命名新闻";
    })
    .join(" ");
  if (containsCjk(text)) {
    const simplified = toSimplifiedChinese(text);
    return simplified.length > 160 ? `${simplified.slice(0, 160)}...` : simplified;
  }
  return `已检索到 ${combined.length} 条相关新闻候选，但原文或摘要不是简体中文；系统已纳入标题、来源和时间作为参考，具体内容需点开原文复核。`;
}

function buildWebSearchSummary(results: Array<{ title: string }>) {
  if (!results.length) return "本次没有可用的联网新闻检索结果。";
  return `本次联网新闻检索返回 ${results.length} 条候选结果，已按相关性和时间筛选后纳入参考。`;
}

function toChineseStringArray(value: unknown) {
  return toStringArray(value).filter(containsCjk).map(toSimplifiedChinese);
}

function ensureChineseAnalysisText(value: string, fallback: string) {
  return containsCjk(value) ? toSimplifiedChinese(value) : fallback;
}

function ensureChineseOptionalText(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return containsCjk(text) ? toSimplifiedChinese(text) : "";
}

export function buildAnalysisTradePlan(
  analysis: Pick<AiAnalysisResult, "trend" | "confidence" | "keyLevels" | "holdAdvice" | "entryAdvice">,
  input: AnalyzeStockInput
): AiAnalysisResult["tradePlan"] {
  const quote = isRecord(input.quote) ? input.quote : {};
  const userContext = isRecord(input.userContext) ? input.userContext : {};
  const price = toFiniteNumber(quote.price);
  const userCapital = toFiniteNumber(input.userCapital);
  const holdingPrice = toFiniteNumber(userContext.holdingPrice);
  const holdingShares = toFiniteNumber(userContext.holdingShares);
  const explicitHolding = typeof userContext.isHolding === "boolean" ? userContext.isHolding : null;
  const isHolding = explicitHolding === true || (explicitHolding !== false && Boolean(holdingPrice && holdingShares));
  const support = price ? nearestBelowLevel(price, analysis.keyLevels.support) : null;
  const resistance = price ? nearestAboveLevel(price, analysis.keyLevels.resistance) : null;
  const configuredStop = toFiniteNumber(userContext.stopLoss);
  const configuredTarget = toFiniteNumber(userContext.targetPrice);
  const stopLossPrice = price ? roundPriceValue(configuredStop ?? support ?? price * 0.96) : null;
  const takeProfitPrice = price ? roundPriceValue(configuredTarget ?? resistance ?? price * 1.06) : null;
  const triggerPrice = price ? roundPriceValue(selectEntryTriggerPrice(price, support)) : null;

  return {
    entry: buildEntryTradePlan({
      analysis,
      price,
      triggerPrice,
      stopLossPrice,
      takeProfitPrice,
      userCapital,
      isHolding
    }),
    exit: buildExitTradePlan({
      analysis,
      price,
      stopLossPrice,
      takeProfitPrice,
      isHolding,
      holdingPrice,
      holdingShares
    }),
    feeRule: TRADE_FEE_RULE
  };
}

function buildEntryTradePlan(input: {
  analysis: Pick<AiAnalysisResult, "trend" | "confidence" | "entryAdvice">;
  price: number | null;
  triggerPrice: number | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  userCapital: number | null;
  isHolding: boolean;
}): NonNullable<AiAnalysisResult["tradePlan"]>["entry"] {
  const constraints: string[] = [];
  if (!input.price || input.price <= 0) constraints.push("行情价格不可用，不能测算买入股数。");
  if (!input.userCapital || input.userCapital <= 0) constraints.push("未填写总本金，无法把首次仓位换算为具体股数。");
  if (input.analysis.trend === "bearish") constraints.push("当前趋势偏空，买入计划需降级为观察。");
  if (adviceBlocksEntry(input.analysis.entryAdvice)) constraints.push("AI 入场建议明确偏等待或回避，不能直接形成买入计划。");

  const suggestedAmount = input.userCapital ? suggestedEntryAmount(input.userCapital, input.analysis.confidence, input.analysis.trend) : null;
  const executionPrice = input.triggerPrice ?? input.price;
  const shares = executionPrice && suggestedAmount ? roundLotShares(suggestedAmount / executionPrice) : 0;
  const economics = executionPrice && shares > 0
    ? calculateTradeEconomics({
        entryPrice: executionPrice,
        shares,
        stopLossPrice: input.stopLossPrice,
        takeProfitPrice: input.takeProfitPrice
      })
    : null;
  const amount = economics?.entryAmount ?? null;
  const estimatedFee = economics?.entryFee ?? null;
  const totalCost = economics?.totalEntryCost ?? null;
  const riskRewardRatio = estimateRiskRewardRatio(input.triggerPrice, input.stopLossPrice, input.takeProfitPrice);
  const maxLossAmount = shares > 0 && input.triggerPrice && input.stopLossPrice
    ? roundMoney(Math.max(0, input.triggerPrice - input.stopLossPrice) * shares)
    : null;

  if (suggestedAmount && shares < TRADE_LOT_SIZE) constraints.push(`按当前预算不足 ${TRADE_LOT_SIZE} 股/份整数手，买入无效。`);
  if (amount !== null && amount < TRADE_FEE_MIN_BASE / 2) constraints.push("计划成交金额偏小，最低 5 元手续费会明显抬高交易成本。");
  if (riskRewardRatio !== null && riskRewardRatio < 1.25) constraints.push("按当前止损/止盈估算，风险收益比不足 1.25:1。");
  const economicsBlock = tradeEconomicsBlockReason(economics);
  if (economicsBlock) constraints.push(`${economicsBlock} 暂不可做。`);
  if (economics?.feeDragPct !== null && economics?.feeDragPct !== undefined && economics.feeDragPct > 1) {
    constraints.push(`预计双边手续费占成交额 ${economics.feeDragPct.toFixed(2)}%，盈亏平衡至少需要上涨 ${economics.breakEvenMovePct.toFixed(2)}%。`);
  }
  if (input.userCapital && totalCost && totalCost > input.userCapital) constraints.push("计划总成本超过用户填写的总本金。");

  const hasHardBlock = constraints.some((item) => /不可用|不能|无效|超过/.test(item));
  const status = hasHardBlock ? "blocked" : shares > 0 && amount ? "conditional" : "watch";

  return {
    status,
    action: status === "blocked" ? "avoid" : input.isHolding ? "add" : "buy",
    triggerPrice: input.triggerPrice,
    stopLossPrice: input.stopLossPrice,
    takeProfitPrice: input.takeProfitPrice,
    shares: shares > 0 ? shares : null,
    amount,
    estimatedFee,
    totalCost,
    maxLossAmount,
    riskRewardRatio,
    estimatedExitFee: economics?.targetExitFee ?? null,
    roundTripFees: economics?.roundTripFees ?? null,
    feeDragPct: economics?.feeDragPct ?? null,
    breakEvenPrice: economics?.breakEvenPrice ?? null,
    breakEvenMovePct: economics?.breakEvenMovePct ?? null,
    grossExpectedProfit: economics?.grossExpectedProfit ?? null,
    netExpectedProfit: economics?.netExpectedProfit ?? null,
    netMaxLossAmount: economics?.netRiskAmount ?? null,
    netRiskRewardRatio: economics?.netRiskRewardRatio ?? null,
    reason: buildEntryTradeReason(input.analysis.entryAdvice?.reason, status, input.isHolding),
    constraints
  };
}

function buildExitTradePlan(input: {
  analysis: Pick<AiAnalysisResult, "holdAdvice">;
  price: number | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  isHolding: boolean;
  holdingPrice: number | null;
  holdingShares: number | null;
}): NonNullable<AiAnalysisResult["tradePlan"]>["exit"] {
  const constraints: string[] = [];
  if (!input.isHolding) {
    return {
      status: "not_applicable",
      action: "watch",
      triggerPrice: input.price ? roundPriceValue(input.price) : null,
      stopLossPrice: input.stopLossPrice,
      takeProfitPrice: input.takeProfitPrice,
      shares: null,
      amount: null,
      estimatedFee: null,
      netProceeds: null,
      sellRatioPct: null,
      estimatedPnl: null,
      reason: "当前未标记持仓，卖出/减仓测算不适用。",
      constraints: []
    };
  }

  if (!input.price || input.price <= 0) constraints.push("行情价格不可用，不能测算卖出金额。");
  if (!input.holdingShares || input.holdingShares < TRADE_LOT_SIZE) constraints.push(`持仓数量不足 ${TRADE_LOT_SIZE} 股/份整数手，不能生成卖出计划。`);

  const adviceText = stringifyAdviceText(input.analysis.holdAdvice);
  const hardExit = /止损|离场|清仓|回避|卖出/.test(adviceText);
  const reduce = hardExit || /减仓|止盈|兑现|盈利保护|降低风险/.test(adviceText);
  const targetRatio = hardExit ? 100 : reduce ? 50 : 0;
  const shares = input.holdingShares && targetRatio > 0 ? normalizeSellLotShares(input.holdingShares * (targetRatio / 100), input.holdingShares) : 0;
  const amount = input.price && shares > 0 ? roundMoney(input.price * shares) : null;
  const estimatedFee = amount ? calculateTradingFee(amount) : null;
  const netProceeds = amount && estimatedFee !== null ? roundMoney(amount - estimatedFee) : null;
  const estimatedPnl = netProceeds !== null && input.holdingPrice && shares > 0
    ? roundMoney(netProceeds - input.holdingPrice * shares - calculateTradingFee(input.holdingPrice * shares))
    : null;

  const status = constraints.length ? "blocked" : reduce && shares > 0 ? "conditional" : "watch";

  return {
    status,
    action: status === "blocked" ? "avoid" : shares && input.holdingShares && shares >= input.holdingShares ? "sell" : reduce ? "reduce" : "watch",
    triggerPrice: input.price ? roundPriceValue(input.price) : null,
    stopLossPrice: input.stopLossPrice,
    takeProfitPrice: input.takeProfitPrice,
    shares: shares > 0 ? shares : null,
    amount,
    estimatedFee,
    netProceeds,
    sellRatioPct: shares > 0 && input.holdingShares ? roundMoney((shares / input.holdingShares) * 100) : null,
    estimatedPnl,
    reason: reduce ? "持仓建议触发了减仓、止盈、止损或风险降低语义，系统给出卖出测算。" : "持仓建议暂未触发明确卖出/减仓语义，先保留为观察。",
    constraints
  };
}

function suggestedEntryAmount(capital: number, confidence: number, trend: AiAnalysisResult["trend"]) {
  const basePct = trend === "bullish" ? 0.08 : trend === "neutral" ? 0.05 : 0.03;
  const confidenceBoost = confidence >= 0.72 ? 0.02 : confidence >= 0.6 ? 0.01 : 0;
  const feeEfficientFloor = capital <= TRADE_FEE_MIN_BASE / 2 ? Math.max(500, capital * 0.25) : TRADE_FEE_MIN_BASE / 2;
  const target = Math.max(feeEfficientFloor, capital * Math.min(0.12, basePct + confidenceBoost));
  return roundMoney(Math.min(capital * 0.9, target));
}

function selectEntryTriggerPrice(price: number, support: number | null) {
  if (!support || support <= 0) return price;
  const distancePct = ((price - support) / price) * 100;
  if (distancePct > 3.5 && distancePct <= 10) return support * 1.01;
  return price;
}

function adviceBlocksEntry(advice: AiAnalysisResult["entryAdvice"]) {
  const text = stringifyAdviceText(advice);
  return /不建议|回避|暂不|等待|观望|不能买|不买/.test(text) && !/条件入场|小仓试探|触发后|分批/.test(text);
}

function buildEntryTradeReason(reason: string | undefined, status: string, isHolding: boolean) {
  if (status === "blocked") return "交易测算存在硬约束，暂不形成可执行买入计划。";
  const actionText = isHolding ? "增持" : "首次买入";
  return reason || `满足触发条件后才考虑${actionText}，并按止损和手续费约束控制单笔风险。`;
}

function stringifyAdviceText(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (!isRecord(value)) return "";
  return Object.values(value).map((item) => String(item ?? "")).join(" ");
}

function estimateRiskRewardRatio(triggerPrice: number | null, stopLossPrice: number | null, takeProfitPrice: number | null) {
  if (!triggerPrice || !stopLossPrice || !takeProfitPrice) return null;
  const risk = triggerPrice - stopLossPrice;
  const reward = takeProfitPrice - triggerPrice;
  if (risk <= 0 || reward <= 0) return null;
  return Number((reward / risk).toFixed(2));
}

function roundLotShares(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value / TRADE_LOT_SIZE) * TRADE_LOT_SIZE;
}

function normalizeSellLotShares(value: number, holdingShares: number) {
  if (!Number.isFinite(value) || !Number.isFinite(holdingShares) || holdingShares < TRADE_LOT_SIZE) return 0;
  const capped = Math.min(Math.max(value, TRADE_LOT_SIZE), holdingShares);
  return Math.floor(capped / TRADE_LOT_SIZE) * TRADE_LOT_SIZE;
}

function nearestBelowLevel(price: number, values: number[]) {
  const candidates = values.filter((value) => Number.isFinite(value) && value > 0 && value <= price);
  return candidates.length ? Math.max(...candidates) : null;
}

function nearestAboveLevel(price: number, values: number[]) {
  const candidates = values.filter((value) => Number.isFinite(value) && value > 0 && value >= price);
  return candidates.length ? Math.min(...candidates) : null;
}

function toFiniteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function roundPriceValue(value: number) {
  return Number(value.toFixed(4));
}

function buildFallbackAnalysis(input: AnalyzeStockInput, reason: string): AiAnalysisResult {
  const quote = input.quote as { price?: number; changePercent?: number };
  const indicators = input.indicators as {
    sma20?: number | null;
    sma50?: number | null;
    bollingerLower?: number | null;
    bollingerUpper?: number | null;
  };
  const price = quote.price ?? 0;
  const trend =
    quote.changePercent && quote.changePercent > 1 && indicators.sma20 && indicators.sma50 && indicators.sma20 > indicators.sma50
      ? "bullish"
      : quote.changePercent && quote.changePercent < -1
        ? "bearish"
        : "neutral";
  const dataScope = normalizeDataScope(null, input);
  const newsReferences = normalizeNewsReferences(null, input.recentNews);
  const webSearchResults = normalizeWebSearchResults(null, input.webSearchResults);

  return {
    trend,
    confidence: 0.42,
    analysisAsOf: input.analysisAsOf ?? new Date().toISOString(),
    dataScope,
    isFallback: true,
    fallbackReason: reason,
    summary: `${reason} 本分析截至 ${input.analysisAsOf ?? new Date().toISOString()}，报价时间 ${dataScope.quoteTime ?? "未知"}，历史数据范围 ${dataScope.historyRange}/${dataScope.historyInterval}。`,
    newsSummary: buildFallbackNewsSummary(input.recentNews, input.webSearchResults),
    newsSentiment: "neutral",
    webSearchSummary: buildWebSearchSummary(webSearchResults),
    newsReferences,
    webSearchResults,
    catalystEvents: [],
    macroRisks: ["宏观环境、利率、流动性和政策变化可能快速影响市场风险偏好。"],
    sectorRisks: [],
    keyLevels: {
      support: [indicators.bollingerLower, indicators.sma50, price * 0.97]
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
        .map((value) => Number(value.toFixed(2))),
      resistance: [indicators.bollingerUpper, price * 1.03]
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
        .map((value) => Number(value.toFixed(2)))
    },
    riskFactors: [
      "本地兜底分析没有完整纳入基本面和更广泛的市场背景。",
      "技术指标存在滞后，在市场状态快速切换时可能失效。",
      "新闻检索结果可能遗漏上下文，需点开原文复核。"
    ],
    holdAdvice: {
      action: trend === "bearish" ? "逢高减仓" : "继续持有观察",
      reason: "在真实 AI 服务恢复前，将此作为临时参考。",
      stopLoss: "优先使用你在持仓设置中填写的止损价。",
      takeProfit: "优先使用你在持仓设置中填写的目标价。",
      positionManagement: "兜底分析不建议扩大仓位。",
      keyMonitorPoints: "检查行情源、AI 服务状态、最新新闻和技术指标是否恢复正常。",
      invalidIf: "价格、成交量或相关新闻发生明显变化。"
    },
    entryAdvice: {
      action: trend === "bearish" ? "不建议入场" : "等待回调",
      reason: "在真实 AI 服务恢复前，将此作为临时参考。",
      entryZone: "不提供新的参考介入区间。",
      timing: "临时观察",
      triggerCondition: "等待真实 AI 分析恢复后再复核。",
      firstPositionSize: "兜底分析不建议开新仓。",
      stopLoss: "以关键支撑位跌破作为风险边界。",
      takeProfit: "以关键压力位或趋势转弱信号作为参考。",
      invalidIf: "价格、成交量或相关新闻发生明显变化。"
    },
    possibleActions: [
      {
        action: trend === "bearish" ? "watch" : "hold",
        reason: "在真实 AI 服务恢复前，可将其作为临时监控备注使用。",
        timing: "临时观察",
        triggerCondition: "等待真实 AI 分析恢复，或价格、成交量、新闻出现明显变化后再复核。",
        entryZone: "不提供新的参考介入区间。",
        stopLossPlan: "优先使用你在持仓设置中填写的止损价；未填写时不要依赖兜底分析。",
        takeProfitPlan: "优先使用你在持仓设置中填写的目标价；未填写时以人工复核为准。",
        positionSizing: "兜底分析不建议扩大仓位。",
        followUpCheck: "检查行情源、AI 服务状态、最新新闻和技术指标是否恢复正常。",
        invalidIf: "价格、成交量、RSI 状态或相关新闻发生明显变化。"
      }
    ],
    disclaimer: "本内容由系统本地规则生成，仅供研究参考，不构成投资建议。"
  };
}
