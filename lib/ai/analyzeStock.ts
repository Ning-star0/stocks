import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

import { createChatCompletion } from "@/lib/ai/deepseek";
import { AppError } from "@/lib/errors";
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
  "你是一个谨慎的股票市场分析助手。你只能基于用户提供的数据进行分析。你不能声称能预测市场，不能保证收益，不能给出确定性买卖指令。你需要从趋势、动量、成交量、风险、关键价位和用户风险偏好角度进行结构化分析。你的输出必须是严格 JSON，不要输出 Markdown。";

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
                : `${userPrompt}\n\n上一次输出不是合法 JSON，或没有通过 schema 校验。请只返回严格 JSON。`
          }
        ]
      };
      const completion = await createChatCompletion(client, request);

      const text = completion.choices[0]?.message?.content;
      if (!text) throw new Error("AI 返回了空内容。");
      const parsed = JSON.parse(text);
      return aiAnalysisSchema.parse(parsed);
    } catch (error) {
      lastError = error;
    }
  }

  throw new AppError("AI_INVALID_JSON", "AI 多次返回非法 JSON，或未通过 schema 校验。", {
    reason: lastError instanceof Error ? lastError.message : "未知错误"
  });
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

请返回以下 JSON schema：
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

function buildFallbackAnalysis(input: AnalyzeStockInput): AiAnalysisResult {
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
    summary: "当前未配置 OPENAI_API_KEY，系统返回基于报价和技术指标的本地兜底分析，用于开发和演示。",
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
