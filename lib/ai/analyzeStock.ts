import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

import { getAiConfig } from "@/lib/ai/config";
import { createChatCompletion } from "@/lib/ai/deepseek";
import { AppError } from "@/lib/errors";
import { aiAnalysisSchema } from "@/lib/schemas";
import { containsCjk, toSimplifiedChinese } from "@/lib/text/simplifiedChinese";
import type { AiAnalysisResult } from "@/lib/types";

export type AnalyzeStockInput = {
  symbol: string;
  quote: unknown;
  indicators: unknown;
  historySummary: unknown;
  userContext: unknown;
  // 用户在 /memory 页面维护的长期交易习惯，AI 分析时作为背景参考
  userMemory?: string;
  // 用户在 /focus 填的总本金，用于计算具体买入股数和仓位
  userCapital?: number | null;
  analysisAsOf?: string;
  dataScope?: {
    quoteTime?: string | null;
    historyRange?: string;
    historyInterval?: string;
    historyFrom?: string | null;
    historyTo?: string | null;
    historyCandles?: number;
    newsWindow?: string;
    newsCount?: number;
    webSearchStatus?: string;
  };
  tradingFeeRule?: {
    rate: number;
    minimumFeeBase: number;
    minimumFee: number;
    lotSize: number;
    description: string;
  };
  recentNews?: unknown;
  webSearchResults?: unknown;
};

const systemPrompt =
  "你是一个谨慎的股票投资顾问。你只能基于用户提供的数据给出投资建议，不能声称能预测市场，不能保证收益，不能给出确定性买卖指令，必须使用「若...则考虑...」的表述方式。你的核心任务是为用户回答两个问题：1）如果已持仓，现在该怎么办？2）如果尚未持仓，应该在什么点位、什么时机考虑入场？你需要从趋势、动量、成交量、风险、关键价位、用户持仓、相关新闻和宏观/行业风险角度进行综合分析，并最终给出可执行的操作建议。无论新闻原文是英文、繁体中文或其他语言，所有自然语言分析字段必须使用简体中文。输出必须是严格 JSON，不要输出 Markdown，不要编造新闻链接。";

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
        model: config.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
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

function buildUserPrompt(input: AnalyzeStockInput) {
  return `请分析以下股票数据，并给出投资建议。返回严格 JSON。

重要要求：
1. summary 是简短摘要（80字内），概括当前局面的核心矛盾：机会是什么，风险是什么。
2. 不能给出确定性买卖指令，不能承诺收益，必须使用「若...则考虑.../观察.../等待...」的表述方式。
3. 新闻链接只能来自 recentNews 或 webSearchResults，不允许编造 URL。
4. webSearchResults 是后端联网新闻检索得到的结果，不代表 AI 自己浏览网页；请把它作为外部新闻参考。
5. 如果新闻不足或没有当日新闻，请明确说明”新闻样本有限”或”未检索到当日强相关新闻”。
6. newsSummary 必须综合 recentNews 和 webSearchResults 的共同主线，控制在 120 字以内，不要逐条复述。
7. 对 ETF、行业主题和指数基金，要优先分析行业催化：政策、采购、招标、中标、订单、投资、产业链景气度。不要把”ETF 涨跌、净值变化、成交额”当成核心催化。
8. catalystEvents、sectorRisks、macroRisks 必须结合新闻和技术指标一起判断；如果新闻只是候选结果，要说明不确定性。
9. 所有自然语言分析字段必须使用简体中文。新闻标题、来源和 URL 可以保留原文。
10. holdAdvice 和 entryAdvice 是本报告的核心。holdAdvice 回答”如果已持仓，现在该怎么办”；entryAdvice 回答”如果尚未持仓，应该在什么点位、什么时机考虑入场”。每个字段都必须具体、可执行，不能写空话。必须使用”若...则考虑...”的谨慎语气。
11. 如果用户提供了交易手续费规则，entryAdvice.firstPositionSize 必须结合手续费和最小计费金额，不要建议过小金额的交易；A 股/ETF 买入数量按 100 股/份取整。
12. possibleActions 保留作为补充计划，沿用原有格式，至少 2 个场景。

股票代码：
${input.symbol}

分析生成时间：
${input.analysisAsOf ?? new Date().toISOString()}

数据覆盖范围：
${JSON.stringify(input.dataScope ?? {}, null, 2)}

当前报价：
${JSON.stringify(input.quote, null, 2)}

技术指标：
${JSON.stringify(input.indicators, null, 2)}

历史价格摘要：
${JSON.stringify(input.historySummary, null, 2)}

用户持仓和风险上下文：
${JSON.stringify(input.userContext, null, 2)}

用户的交易记忆（交易习惯、偏好、历史总结等）：
${input.userMemory || "暂无记录"}

用户的可用本金：
${input.userCapital ? `${input.userCapital} 元。请基于总本金计算 entryAdvice.firstPositionSize 为具体股数或百分比（如"约100股，占总本金8%"），不要写"轻仓"这种模糊表述。` : "用户未填写。仓位建议用百分比表述，不要写模糊词。"}

交易手续费规则：
${input.tradingFeeRule ? JSON.stringify(input.tradingFeeRule, null, 2) : "未提供。"}



已入库的高重要性相关新闻：
${JSON.stringify(input.recentNews ?? [], null, 2)}

联网新闻检索结果：
${JSON.stringify(input.webSearchResults ?? [], null, 2)}

请只返回以下 JSON schema，不要 Markdown，不要解释：
{
  “trend”: “bullish | neutral | bearish”,
  “confidence”: 0.0,
  “analysisAsOf”: “”,
  “dataScope”: {
    “quoteTime”: “”,
    “historyRange”: “”,
    “historyInterval”: “”,
    “historyFrom”: “”,
    “historyTo”: “”,
    “historyCandles”: 0,
    “newsWindow”: “”,
    “newsCount”: 0,
    “webSearchStatus”: “”
  },
  “summary”: “”,
  “newsSummary”: “”,
  “newsSentiment”: “positive | neutral | negative | mixed”,
  “webSearchSummary”: “”,
  “newsReferences”: [
    {
      “title”: “”,
      “source”: “”,
      “publishedAt”: “”,
      “url”: “”,
      “sentiment”: “positive | neutral | negative”,
      “impactLevel”: “low | medium | high”
    }
  ],
  “webSearchResults”: [
    {
      “title”: “”,
      “source”: “”,
      “publishedAt”: “”,
      “url”: “”,
      “summary”: “”
    }
  ],
  “catalystEvents”: [],
  “macroRisks”: [],
  “sectorRisks”: [],
  “keyLevels”: {
    “support”: [],
    “resistance”: []
  },
  “riskFactors”: [],
  “holdAdvice”: {
    “action”: “继续持有观察 | 逢高减仓 | 逢低加仓 | 止损离场”,
    “reason”: “为什么给出这个建议”,
    “stopLoss”: “止损位和止损方式”,
    “takeProfit”: “止盈位和止盈方式”,
    “positionManagement”: “仓位管理建议”,
    “keyMonitorPoints”: “需要持续关注的关键点”,
    “invalidIf”: “什么情况下这个建议失效”
  },
  “entryAdvice”: {
    “action”: “等待回调 | 可轻仓试探 | 不建议入场”,
    “reason”: “为什么给出这个入场建议”,
    “entryZone”: “入场价格区间”,
    “timing”: “入场时间窗口”,
    “triggerCondition”: “触发入场的具体条件”,
    “firstPositionSize”: “首次建仓仓位建议”,
    “stopLoss”: “入场后止损位”,
    “takeProfit”: “入场后止盈目标”,
    “invalidIf”: “什么情况下放弃入场计划”
  },
  “possibleActions”: [
    {
      “action”: “hold | watch | reduce | consider_entry | avoid”,
      “reason”: “”,
      “timing”: “”,
      “triggerCondition”: “”,
      “entryZone”: “”,
      “stopLossPlan”: “”,
      “takeProfitPlan”: “”,
      “positionSizing”: “”,
      “followUpCheck”: “”,
      “invalidIf”: “”
    }
  ],
  “disclaimer”: “本内容由 AI 生成，仅供研究参考，不构成投资建议。”
}`;
}

function parseJsonObject(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("AI 返回内容不是可解析的 JSON 对象。");
  }
}

function normalizeStockAnalysis(value: unknown, input: AnalyzeStockInput) {
  const record = isRecord(value) ? value : {};
  const keyLevels = isRecord(record.keyLevels) ? record.keyLevels : {};
  const actions = Array.isArray(record.possibleActions) ? record.possibleActions : [];
  const riskFactors = toStringArray(record.riskFactors);
  const dataScope = normalizeDataScope(record.dataScope, input);
  const newsReferences = normalizeNewsReferences(record.newsReferences, input.recentNews);
  const webSearchResults = normalizeWebSearchResults(record.webSearchResults, input.webSearchResults);

  return {
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

function normalizeTrend(value: unknown) {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("bull") || text.includes("positive") || text.includes("看多") || text.includes("偏多")) return "bullish";
  if (text.includes("bear") || text.includes("negative") || text.includes("看空") || text.includes("偏空")) return "bearish";
  return "neutral";
}

function normalizeNewsSentiment(value: unknown) {
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

