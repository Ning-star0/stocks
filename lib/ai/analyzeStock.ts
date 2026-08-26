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
import { fitTradeToRiskBudget, type PortfolioRiskBudget } from "@/lib/trading/riskBudget";
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
  const evidencePackage = input.evidencePackage;

  const normalized = {
    evidenceSchemaVersion: evidencePackage?.schemaVersion,
    decisionMode: evidencePackage?.decisionMode,
    trend: normalizeTrend(record.trend),
    confidence: normalizeConfidence(record.confidence),
    entryOutcomeForecast: normalizeEntryOutcomeForecast(record.entryOutcomeForecast, evidencePackage?.decisionMode),
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
    dataQuality: buildOutputDataQuality(evidencePackage),
    supportingEvidence: toChineseStringArray(record.supportingEvidence),
    opposingEvidence: toChineseStringArray(record.opposingEvidence),
    missingEvidence: uniqueStrings([
      ...toChineseStringArray(record.missingEvidence),
      ...(evidencePackage?.dataQuality.missingFields ?? [])
    ]),
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
  const tradePlan = buildAnalysisTradePlan(normalized, input);

  return {
    ...normalized,
    decisionStatus: resolveDecisionStatus({
      input,
      tradePlan
    }),
    tradePlan
  };
}

function normalizeEntryOutcomeForecast(value: unknown, mode: AiAnalysisResult["decisionMode"]): NonNullable<AiAnalysisResult["entryOutcomeForecast"]> {
  const horizonTradingDays = mode === "swing_trade" ? 20 : mode === "long_term" ? 63 : null;
  const definition = horizonTradingDays
    ? `从分析后的下一完整交易日开盘模拟入场，${horizonTradingDays} 个交易日内先触及止盈位而非止损位。`
    : "持仓管理不生成新的入场胜率预测。";
  const record = isRecord(value) ? value : {};
  const probability = toFiniteNumber(record.targetBeforeStopProbability);
  if (!horizonTradingDays || probability === null) {
    return {
      schemaVersion: "entry-outcome-forecast-v1",
      status: "unavailable",
      targetBeforeStopProbability: null,
      horizonTradingDays,
      definition,
      reasoning: "没有可进入影子观察的有效主观概率。"
    };
  }
  return {
    schemaVersion: "entry-outcome-forecast-v1",
    status: "subjective_unvalidated",
    targetBeforeStopProbability: Number(Math.min(0.95, Math.max(0.05, probability)).toFixed(4)),
    horizonTradingDays,
    definition,
    reasoning: ensureChineseAnalysisText(
      toNonEmptyString(record.reasoning, "模型未充分解释该主观概率。"),
      "模型未充分解释该主观概率。"
    )
  };
}

function resolveDecisionStatus(input: {
  input: AnalyzeStockInput;
  tradePlan: NonNullable<AiAnalysisResult["tradePlan"]>;
}): NonNullable<AiAnalysisResult["decisionStatus"]> {
  const evidence = input.input.evidencePackage;
  const mode = evidence?.decisionMode;
  const quality = evidence?.dataQuality;

  if (mode === "position_management") {
    return input.tradePlan.exit.status === "conditional" && (input.tradePlan.exit.action === "sell" || input.tradePlan.exit.action === "reduce")
      ? "exit_risk"
      : "manage_position";
  }
  if (!quality || quality.status === "insufficient" || quality.status === "conflicted" || quality.entryBlockers.length) {
    return "insufficient_data";
  }
  if (input.tradePlan.entry.status === "blocked") return "rejected";
  if (input.tradePlan.entry.status === "conditional") return "conditional_entry";
  if (input.tradePlan.entry.status === "watch") return "setup_wait";
  return "research_candidate";
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
    newsCoverage: fallback.newsCoverage ?? null,
    newsTimeline: fallback.newsTimeline ?? null,
    newsRefreshFailures: fallback.newsRefreshFailures ?? [],
    marketRegimeStatus: fallback.marketRegimeStatus ?? "unavailable",
    marketRegime: fallback.marketRegime ?? "unknown",
    marketRegimeBenchmarkSymbol: fallback.marketRegimeBenchmarkSymbol ?? "000300.SH",
    marketRegimeAsOf: fallback.marketRegimeAsOf ?? null,
    marketRegimeSourceUrl: fallback.marketRegimeSourceUrl ?? "",
    marketRegimeFailure: fallback.marketRegimeFailure ?? null,
    fundamentalsStatus: fallback.fundamentalsStatus ?? "unavailable",
    fundamentalsReportPeriod: fallback.fundamentalsReportPeriod ?? null,
    fundamentalsSourceUrl: fallback.fundamentalsSourceUrl ?? null,
    fundamentalCoverage: fallback.fundamentalCoverage ?? null,
    disclosureStatus: fallback.disclosureStatus ?? "unchecked",
    disclosureCheckedAt: fallback.disclosureCheckedAt ?? null,
    disclosureCount: toInteger(record.disclosureCount, fallback.disclosureCount ?? 0),
    disclosureCriticalCount: fallback.disclosureCriticalCount ?? 0,
    disclosureExtractedCount: fallback.disclosureExtractedCount ?? 0,
    disclosureSources: fallback.disclosureSources ?? [],
    companyEvidenceFailures: fallback.companyEvidenceFailures ?? [],
    portfolioRiskStatus: fallback.portfolioRiskStatus ?? "not_evaluated",
    portfolioAvailableRiskAmount: fallback.portfolioAvailableRiskAmount ?? null,
    portfolioRiskFailure: fallback.portfolioRiskFailure ?? null,
    webSearchStatus: toNonEmptyString(record.webSearchStatus, fallback.webSearchStatus ?? "未执行联网新闻检索")
  };
}

function buildOutputDataQuality(evidencePackage: AnalyzeStockInput["evidencePackage"]): AiAnalysisResult["dataQuality"] {
  if (!evidencePackage) return undefined;
  const news = evidencePackage.news;
  return {
    ...evidencePackage.dataQuality,
    newsCoverage: {
      fetchedCount: news.fetchedCount,
      savedCount: news.savedCount,
      filteredOutCount: news.filteredOutCount,
      relevantCount: news.relevantCount,
      highCount: news.highCount,
      mediumCount: news.mediumCount,
      verifiedAnalyzedCount: news.analyzedCount,
      fallbackAnalysisCount: news.fallbackAnalysisCount,
      failedAnalysisCount: news.failedAnalysisCount,
      pendingCriticalCount: news.pendingCriticalCount,
      pendingRelevantCount: news.pendingRelevantCount,
      deadlineExceeded: news.deadlineExceeded,
      webSearchUsed: news.webSearchUsed,
      quotaStatus: news.quotaStatus,
      cacheHitCount: news.cacheHitCount,
      tianapiCalls: news.tianapiCalls,
      tavilyCalls: news.tavilyCalls,
      sharedTopicReused: news.sharedTopicReused,
      skippedQueryCount: news.skippedQueryCount,
      sourceProviders: news.sourceProviders,
      eventClusterCount: news.timeline.clusterCount,
      duplicateArticleCount: news.timeline.duplicateArticleCount,
      futureDatedArticleCount: news.timeline.futureDatedArticleCount,
      explicitExpectationCount: news.timeline.explicitExpectationCount,
      inferredExpectationCount: news.timeline.inferredExpectationCount,
      unavailableExpectationCount: news.timeline.unavailableExpectationCount,
      priceReactionAvailableCount: news.timeline.priceReactionAvailableCount
    }
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

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
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
): NonNullable<AiAnalysisResult["tradePlan"]> {
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
  const stopLossPrice = configuredStop ?? support;
  const takeProfitPrice = configuredTarget ?? resistance;
  const triggerPrice = price ? roundPriceValue(selectEntryTriggerPrice(price, support)) : null;

  return {
    entry: buildEntryTradePlan({
      analysis,
      price,
      triggerPrice,
      stopLossPrice,
      takeProfitPrice,
      userCapital,
      isHolding,
      riskBudget: input.portfolioRiskContext?.riskBudget ?? null,
      availableCash: input.portfolioRiskContext?.availableCash ?? null,
      evidenceBlockers: input.evidencePackage?.dataQuality.entryBlockers ?? []
    }),
    exit: buildExitTradePlan({
      price,
      stopLossPrice: configuredStop,
      takeProfitPrice: configuredTarget,
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
  riskBudget: PortfolioRiskBudget | null;
  availableCash: number | null;
  evidenceBlockers: string[];
}): NonNullable<AiAnalysisResult["tradePlan"]>["entry"] {
  const constraints: string[] = [];
  const blockers: string[] = [];
  const addBlocker = (message: string) => {
    constraints.push(message);
    blockers.push(message);
  };
  input.evidenceBlockers.forEach((item) => addBlocker(`证据硬门控：${item}。`));
  if (!input.price || input.price <= 0) addBlocker("行情价格不可用，不能测算买入股数。");
  if (!input.userCapital || input.userCapital <= 0) addBlocker("未填写总本金，无法把首次仓位换算为具体股数。");
  if (!input.riskBudget) addBlocker("尚未完成组合风险预算，不能生成执行仓位。");
  if (input.riskBudget?.status === "blocked" || input.riskBudget?.status === "breached_stop") addBlocker(input.riskBudget.reason);
  if (!input.stopLossPrice || !input.triggerPrice || input.stopLossPrice >= input.triggerPrice) {
    addBlocker("缺少低于触发价的有效止损或技术失效位，不能新增风险。");
  }
  if (!input.takeProfitPrice || !input.triggerPrice || input.takeProfitPrice <= input.triggerPrice) {
    addBlocker("缺少高于触发价的首个止盈或压力目标，不能完成收益测算。");
  }
  const suggestedAmount = input.userCapital ? suggestedEntryAmount(input.userCapital) : null;
  const executionPrice = input.triggerPrice ?? input.price;
  const requestedShares = executionPrice && suggestedAmount ? roundLotShares(suggestedAmount / executionPrice) : 0;
  const riskCapacity = input.riskBudget
    ? Math.min(input.riskBudget.singleTradeRiskLimitAmount, input.riskBudget.availableRiskAmount)
    : 0;
  const fitted = input.riskBudget && executionPrice
    ? fitTradeToRiskBudget({
        requestedShares,
        entryPrice: executionPrice,
        stopLossPrice: input.stopLossPrice,
        takeProfitPrice: input.takeProfitPrice,
        maxRiskAmount: riskCapacity
      })
    : null;
  if (fitted?.reason) addBlocker(fitted.reason);
  const shares = fitted ? fitted.shares : requestedShares;
  const economics = fitted?.economics ?? (executionPrice && shares > 0
    ? calculateTradeEconomics({
        entryPrice: executionPrice,
        shares,
        stopLossPrice: input.stopLossPrice,
        takeProfitPrice: input.takeProfitPrice
      })
    : null);
  const amount = economics?.entryAmount ?? null;
  const estimatedFee = economics?.entryFee ?? null;
  const totalCost = economics?.totalEntryCost ?? null;
  const riskRewardRatio = estimateRiskRewardRatio(input.triggerPrice, input.stopLossPrice, input.takeProfitPrice);
  const maxLossAmount = shares > 0 && input.triggerPrice && input.stopLossPrice
    ? roundMoney(Math.max(0, input.triggerPrice - input.stopLossPrice) * shares)
    : null;

  if (suggestedAmount && shares < TRADE_LOT_SIZE) addBlocker(`按当前预算不足 ${TRADE_LOT_SIZE} 股/份整数手，买入无效。`);
  if (amount !== null && amount < TRADE_FEE_MIN_BASE / 2) constraints.push("计划成交金额偏小，最低 5 元手续费会明显抬高交易成本。");
  if (riskRewardRatio !== null && riskRewardRatio < 1.25) addBlocker("按当前止损/止盈估算，风险收益比不足 1.25:1。");
  const economicsBlock = tradeEconomicsBlockReason(economics);
  if (economicsBlock) addBlocker(`${economicsBlock} 暂不可做。`);
  if (!economics || economics.netRiskRewardRatio === null) {
    addBlocker("缺少完整止损/目标数据，无法计算扣除双边手续费后的净风险收益比，不能买入。");
  }
  if (economics?.feeDragPct !== null && economics?.feeDragPct !== undefined && economics.feeDragPct > 1) {
    constraints.push(`预计双边手续费占成交额 ${economics.feeDragPct.toFixed(2)}%，盈亏平衡至少需要上涨 ${economics.breakEvenMovePct.toFixed(2)}%。`);
  }
  if (input.userCapital && totalCost && totalCost > input.userCapital) addBlocker("计划总成本超过用户填写的总本金。");
  if (input.availableCash !== null && totalCost && totalCost > input.availableCash) addBlocker("计划总成本超过组合当前可用现金。");
  const shadowEligible = blockers.length === 0
    && Boolean(economics?.netExpectedProfit && economics.netExpectedProfit > 0)
    && Boolean(economics?.netRiskAmount && economics.netRiskAmount > 0)
    && shares > 0;
  addBlocker("尚未建立同类计划的独立样本外概率校准，扣费后期望值未知，不能新增仓位；本计划仅进入影子观察。");

  const hasHardBlock = blockers.length > 0;
  const status = hasHardBlock ? "blocked" : shares > 0 && amount ? "conditional" : "watch";

  return {
    status,
    action: status === "blocked" ? "avoid" : input.isHolding ? "add" : "buy",
    shadowEligible,
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
    expectedValueStatus: "not_calibrated",
    calibratedWinProbability: null,
    expectedValue: null,
    validationSampleSize: null,
    reason: buildEntryTradeReason(input.analysis.entryAdvice?.reason, status, input.isHolding),
    constraints
  };
}

function buildExitTradePlan(input: {
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

  const hardExit = Boolean(input.price && input.stopLossPrice && input.price <= input.stopLossPrice);
  const reduce = hardExit || Boolean(input.price && input.takeProfitPrice && input.price >= input.takeProfitPrice);
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
    reason: hardExit
      ? "当前价已达到用户配置的止损位，按确定性规则测算全部退出。"
      : reduce
        ? "当前价已达到用户配置的目标位，按确定性规则测算减仓一半。"
        : "尚未触发用户配置的止损或目标位，持仓动作保持观察。",
    constraints: [
      ...constraints,
      ...(!input.stopLossPrice ? ["未配置持仓止损位，系统不会根据 AI 文本自动生成卖出动作。"] : []),
      ...(!input.takeProfitPrice ? ["未配置持仓目标位，系统不会根据 AI 文本自动生成止盈动作。"] : [])
    ]
  };
}

function suggestedEntryAmount(capital: number) {
  const basePct = 0.05;
  const feeEfficientFloor = capital <= TRADE_FEE_MIN_BASE / 2 ? Math.max(500, capital * 0.25) : TRADE_FEE_MIN_BASE / 2;
  const target = Math.max(feeEfficientFloor, capital * basePct);
  return roundMoney(Math.min(capital * 0.9, target));
}

function selectEntryTriggerPrice(price: number, support: number | null) {
  if (!support || support <= 0) return price;
  const distancePct = ((price - support) / price) * 100;
  if (distancePct > 3.5 && distancePct <= 10) return support * 1.01;
  return price;
}

function buildEntryTradeReason(reason: string | undefined, status: string, isHolding: boolean) {
  if (status === "blocked") return "交易测算存在硬约束，暂不形成可执行买入计划。";
  const actionText = isHolding ? "增持" : "首次买入";
  return reason || `满足触发条件后才考虑${actionText}，并按止损和手续费约束控制单笔风险。`;
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
  const evidencePackage = input.evidencePackage;
  const outputDataQuality = buildOutputDataQuality(evidencePackage);
  const fallbackDataQuality = outputDataQuality
    ? {
        ...outputDataQuality,
        status: "insufficient" as const,
        fallbacksUsed: uniqueStrings([...outputDataQuality.fallbacksUsed, reason]),
        entryBlockers: uniqueStrings([...outputDataQuality.entryBlockers, "AI 分析使用了本地兜底结果"])
      }
    : undefined;

  return {
    evidenceSchemaVersion: evidencePackage?.schemaVersion,
    decisionMode: evidencePackage?.decisionMode,
    decisionStatus: evidencePackage?.decisionMode === "position_management" ? "manage_position" : "insufficient_data",
    trend,
    confidence: 0.42,
    entryOutcomeForecast: normalizeEntryOutcomeForecast(null, evidencePackage?.decisionMode),
    analysisAsOf: input.analysisAsOf ?? new Date().toISOString(),
    dataScope,
    isFallback: true,
    fallbackReason: reason,
    dataQuality: fallbackDataQuality,
    supportingEvidence: [],
    opposingEvidence: ["AI 服务未返回通过校验的研究结论。"],
    missingEvidence: uniqueStrings([...(fallbackDataQuality?.missingFields ?? []), "validatedAiAnalysis"]),
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
