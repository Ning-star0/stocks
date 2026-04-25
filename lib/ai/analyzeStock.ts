import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

import { createChatCompletion } from "@/lib/ai/deepseek";
import { aiAnalysisSchema } from "@/lib/schemas";
import type { AiAnalysisResult } from "@/lib/types";

export type AnalyzeStockInput = {
  symbol: string;
  quote: unknown;
  indicators: unknown;
  historySummary: unknown;
  userContext: unknown;
  recentNews?: unknown;
};

const systemPrompt =
  "你是一个谨慎的股票市场分析助手。你只能基于用户提供的数据进行分析。你不能声称能预测市场，不能保证收益，不能给出确定性买卖指令。你需要从趋势、动量、成交量、风险、关键价位、新闻和用户风险偏好角度进行结构化分析。你的输出必须是严格 JSON，不要输出 Markdown。";

export async function analyzeStock(input: AnalyzeStockInput): Promise<AiAnalysisResult> {
  if (!process.env.OPENAI_API_KEY) {
    return buildFallbackAnalysis(input);
  }

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined
  });

  const userPrompt = buildUserPrompt(input);
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const request: ChatCompletionCreateParamsNonStreaming = {
        model: process.env.OPENAI_MODEL || "deepseek-v4-flash",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content:
              attempt === 0
                ? userPrompt
                : `${userPrompt}\n\n上一次输出没有通过 JSON schema 校验。请只返回一个 JSON 对象，所有枚举值必须严格使用 schema 中的英文值。`
          }
        ]
      };
      const completion = await createChatCompletion(client, request);

      const text = completion.choices[0]?.message?.content;
      if (!text) throw new Error("AI 返回了空内容。");
      const parsed = parseJsonObject(text);
      return aiAnalysisSchema.parse(normalizeStockAnalysis(parsed));
    } catch (error) {
      lastError = error;
    }
  }

  return buildFallbackAnalysis(
    input,
    `AI 返回内容多次未通过 JSON/schema 校验，系统已改用本地规则生成临时分析。原因：${lastError instanceof Error ? lastError.message : "未知错误"}`
  );
}

function buildUserPrompt(input: AnalyzeStockInput) {
  return `请分析以下股票数据，并返回严格 JSON。请同时考虑当前报价、历史价格、技术指标、用户持仓和风险偏好、最近相关新闻、行业新闻和宏观风险。不要给出确定性买卖指令。

股票代码：
${input.symbol}

当前报价：
${JSON.stringify(input.quote, null, 2)}

技术指标：
${JSON.stringify(input.indicators, null, 2)}

历史价格摘要：
${JSON.stringify(input.historySummary, null, 2)}

用户上下文：
${JSON.stringify(input.userContext, null, 2)}

相关新闻：
${JSON.stringify(input.recentNews ?? [], null, 2)}

请只返回以下 JSON schema，不要 Markdown，不要解释：
{
  "trend": "bullish | neutral | bearish",
  "confidence": 0.0,
  "summary": "",
  "newsSummary": "",
  "newsSentiment": "positive | neutral | negative | mixed",
  "catalystEvents": [],
  "macroRisks": [],
  "sectorRisks": [],
  "keyLevels": {
    "support": [],
    "resistance": []
  },
  "riskFactors": [],
  "possibleActions": [
    {
      "action": "hold | watch | reduce | consider_entry | avoid",
      "reason": "",
      "invalidIf": ""
    }
  ],
  "disclaimer": "本内容由 AI 生成，仅供研究参考，不构成投资建议。"
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

function normalizeStockAnalysis(value: unknown) {
  const record = isRecord(value) ? value : {};
  const keyLevels = isRecord(record.keyLevels) ? record.keyLevels : {};
  const actions = Array.isArray(record.possibleActions) ? record.possibleActions : [];

  return {
    trend: normalizeTrend(record.trend),
    confidence: normalizeConfidence(record.confidence),
    summary: toNonEmptyString(record.summary, "暂无摘要。"),
    newsSummary: toNonEmptyString(record.newsSummary, "暂无已分析的相关新闻。"),
    newsSentiment: normalizeNewsSentiment(record.newsSentiment),
    catalystEvents: toStringArray(record.catalystEvents),
    macroRisks: toStringArray(record.macroRisks),
    sectorRisks: toStringArray(record.sectorRisks),
    keyLevels: {
      support: toNumberArray(keyLevels.support ?? record.support),
      resistance: toNumberArray(keyLevels.resistance ?? record.resistance)
    },
    riskFactors: toStringArray(record.riskFactors).length ? toStringArray(record.riskFactors) : ["AI 输出未提供明确风险因素，请结合行情和新闻自行复核。"],
    possibleActions: actions.length
      ? actions.map(normalizeAction).filter(Boolean)
      : [
          {
            action: "watch",
            reason: "数据已生成结构化摘要，但操作计划不足，建议继续观察。",
            invalidIf: "价格、成交量、技术指标或相关新闻发生明显变化。"
          }
        ],
    disclaimer: toNonEmptyString(record.disclaimer, "本内容由 AI 生成，仅供研究参考，不构成投资建议。")
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
  const action = text.includes("reduce") || text.includes("减") ? "reduce" : text.includes("entry") || text.includes("买") || text.includes("consider") ? "consider_entry" : text.includes("avoid") || text.includes("回避") ? "avoid" : text.includes("hold") || text.includes("持") ? "hold" : "watch";
  return {
    action,
    reason: toNonEmptyString(record.reason, "AI 未提供原因。"),
    invalidIf: toNonEmptyString(record.invalidIf, "关键数据发生明显变化。")
  };
}

function normalizeConfidence(value: unknown) {
  const number = typeof value === "number" ? value : Number(String(value ?? "").replace("%", ""));
  if (!Number.isFinite(number)) return 0.5;
  const normalized = number > 1 ? number / 100 : number;
  return Math.min(1, Math.max(0, normalized));
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function buildFallbackAnalysis(input: AnalyzeStockInput, reason = "当前未配置 OPENAI_API_KEY，系统返回基于报价和技术指标的本地兜底分析，用于开发和演示。"): AiAnalysisResult {
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

  return {
    trend,
    confidence: 0.42,
    summary: reason,
    newsSummary: buildFallbackNewsSummary(input.recentNews),
    newsSentiment: "neutral",
    catalystEvents: [],
    macroRisks: ["宏观环境和利率变化可能快速影响市场风险偏好。"],
    sectorRisks: [],
    keyLevels: {
      support: [indicators.bollingerLower, indicators.sma50, price * 0.97]
        .filter((value): value is number => typeof value === "number")
        .map((value) => Number(value.toFixed(2))),
      resistance: [indicators.bollingerUpper, price * 1.03]
        .filter((value): value is number => typeof value === "number")
        .map((value) => Number(value.toFixed(2)))
    },
    riskFactors: [
      "本地兜底分析没有完整纳入实时新闻、基本面和更广泛的市场背景。",
      "技术指标存在滞后，在市场状态快速切换时可能失效。"
    ],
    possibleActions: [
      {
        action: trend === "bearish" ? "watch" : "hold",
        reason: "在配置真实 AI 服务前，可将其作为监控备注使用。",
        invalidIf: "价格、成交量或 RSI 状态发生明显变化。"
      }
    ],
    disclaimer: "本内容由 AI 生成，仅供研究参考，不构成投资建议。"
  };
}

function buildFallbackNewsSummary(recentNews: unknown) {
  if (!Array.isArray(recentNews) || recentNews.length === 0) return "暂无已分析的相关新闻。";
  return recentNews
    .slice(0, 3)
    .map((item) => {
      const news = item as { title?: string; summary?: string; aiSummary?: string };
      return news.aiSummary ?? news.summary ?? news.title ?? "未命名新闻";
    })
    .join(" ");
}
