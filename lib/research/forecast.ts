import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { z } from "zod";

import { getAiConfig, selectAiModel } from "@/lib/ai/config";
import { createChatCompletion } from "@/lib/ai/deepseek";
import type { ResearchForecast, ResearchSymbolData, ResearchSymbolForecast } from "@/lib/research/types";

const symbolForecastSchema = z.object({
  symbol: z.string().min(1),
  bias: z.enum(["bullish", "neutral", "bearish"]),
  upProbability: z.coerce.number().min(0).max(100),
  sidewaysProbability: z.coerce.number().min(0).max(100),
  downProbability: z.coerce.number().min(0).max(100),
  confidence: z.coerce.number().min(0).max(1),
  expectedLow: z.coerce.number().positive().nullable().optional(),
  expectedBase: z.coerce.number().positive().nullable().optional(),
  expectedHigh: z.coerce.number().positive().nullable().optional(),
  triggerPrice: z.coerce.number().positive().nullable().optional(),
  stopLossPrice: z.coerce.number().positive().nullable().optional(),
  takeProfitPrice: z.coerce.number().positive().nullable().optional(),
  rationale: z.string().min(1),
  catalysts: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  invalidIf: z.string().min(1)
});

const forecastSchema = z.object({
  horizonTradingDays: z.coerce.number().int().min(1).max(60),
  marketView: z.string().min(1),
  riskNotes: z.array(z.string()).default([]),
  symbols: z.array(symbolForecastSchema),
  disclaimer: z.string().default("概率场景仅供研究，不构成投资建议。")
});

export async function generateResearchForecast(input: {
  symbols: ResearchSymbolData[];
  portfolio: Record<string, unknown>;
  performance: Record<string, unknown>;
  riskBudget: Record<string, unknown>;
  latestDecision: Record<string, unknown> | null;
}): Promise<ResearchForecast> {
  const config = await getAiConfig();
  const model = selectAiModel(config, "standard");
  if (!config.apiKey) return fallbackForecast(input.symbols, model, "DeepSeek API key 未配置。");

  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl || undefined });
  const prompt = buildForecastPrompt(input);
  try {
    const request: ChatCompletionCreateParamsNonStreaming = {
      model,
      temperature: 0.15,
      max_tokens: numberEnv("AI_RESEARCH_FORECAST_MAX_TOKENS", 3000),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "你是谨慎的交易概率研究助手。你只能基于输入数据给出多情景概率，不得承诺收益，不得编造行情、新闻或确定性价格。所有自然语言必须使用简体中文，只返回严格 JSON。"
        },
        { role: "user", content: prompt }
      ]
    };
    const completion = await createChatCompletion(client, request);
    const text = completion.choices[0]?.message?.content;
    if (!text) throw new Error("DeepSeek 返回空内容。");
    const parsed = forecastSchema.parse(parseJsonObject(text));
    return normalizeForecast(parsed, input.symbols, model);
  } catch (error) {
    return fallbackForecast(input.symbols, model, `DeepSeek 场景预测失败：${error instanceof Error ? error.message : "未知错误"}`);
  }
}

function buildForecastPrompt(input: {
  symbols: ResearchSymbolData[];
  portfolio: Record<string, unknown>;
  performance: Record<string, unknown>;
  riskBudget: Record<string, unknown>;
  latestDecision: Record<string, unknown> | null;
}) {
  const compactSymbols = input.symbols.map((item) => ({
    symbol: item.symbol,
    name: item.name,
    quote: item.quote,
    position: item.position,
    indicators: item.indicators,
    historySummary: item.historySummary,
    recentCandles: item.candles.slice(-60),
    latestAnalysis: compactAnalysis(item.latestAnalysis),
    news: item.news.slice(0, 8).map((news) => ({
      title: news.title,
      source: news.source,
      publishedAt: news.publishedAt,
      summary: news.summary,
      sentiment: news.sentiment,
      importance: news.importance,
      analysis: news.analysis
    }))
  }));

  return `请对以下股票/ETF生成未来 5-20 个交易日的概率场景。

硬性要求：
1. 每个标的必须给出上涨、震荡、下跌三种概率，三者合计必须为 100。
2. 价格区间必须基于最近 K 线波动和关键位，expectedLow <= expectedBase <= expectedHigh。
3. triggerPrice、stopLossPrice、takeProfitPrice 只能是条件观察位，不能写成确定性指令。
4. 数据不足时降低 confidence，并在 risks 和 invalidIf 中明确说明。
5. 不能因为历史绩效好而放大风险；必须参考 riskBudget。

账户：${JSON.stringify(input.portfolio)}
策略绩效：${JSON.stringify(input.performance)}
风险预算：${JSON.stringify(input.riskBudget)}
最新组合决策：${JSON.stringify(input.latestDecision)}
标的数据：${JSON.stringify(compactSymbols)}

只返回：
{
  "horizonTradingDays": 10,
  "marketView": "",
  "riskNotes": [],
  "symbols": [{
    "symbol": "",
    "bias": "neutral",
    "upProbability": 33,
    "sidewaysProbability": 34,
    "downProbability": 33,
    "confidence": 0.5,
    "expectedLow": null,
    "expectedBase": null,
    "expectedHigh": null,
    "triggerPrice": null,
    "stopLossPrice": null,
    "takeProfitPrice": null,
    "rationale": "",
    "catalysts": [],
    "risks": [],
    "invalidIf": ""
  }],
  "disclaimer": "概率场景仅供研究，不构成投资建议。"
}`;
}

function compactAnalysis(value: Record<string, unknown> | null) {
  if (!value) return null;
  const output = value.output && typeof value.output === "object" ? value.output as Record<string, unknown> : {};
  return {
    createdAt: value.createdAt ?? null,
    trend: output.trend ?? null,
    confidence: output.confidence ?? null,
    summary: output.summary ?? null,
    newsSummary: output.newsSummary ?? null,
    keyLevels: output.keyLevels ?? null,
    riskFactors: output.riskFactors ?? null,
    holdAdvice: output.holdAdvice ?? null,
    entryAdvice: output.entryAdvice ?? null,
    tradePlan: output.tradePlan ?? null
  };
}

function normalizeForecast(
  value: z.infer<typeof forecastSchema>,
  symbols: ResearchSymbolData[],
  model: string
): ResearchForecast {
  const bySymbol = new Map(value.symbols.map((item) => [item.symbol.toUpperCase(), item]));
  return {
    status: "ai",
    model,
    generatedAt: new Date().toISOString(),
    horizonTradingDays: value.horizonTradingDays,
    marketView: value.marketView,
    riskNotes: value.riskNotes,
    symbols: symbols.map((source) => {
      const item = bySymbol.get(source.symbol.toUpperCase());
      return item ? normalizeSymbolForecast(item, source) : fallbackSymbolForecast(source);
    }),
    fallbackReason: null,
    disclaimer: value.disclaimer
  };
}

function normalizeSymbolForecast(
  value: z.infer<typeof symbolForecastSchema>,
  source: ResearchSymbolData
): ResearchSymbolForecast {
  const probabilities = normalizeProbabilities(value.upProbability, value.sidewaysProbability, value.downProbability);
  const prices = normalizePriceRange(value.expectedLow ?? null, value.expectedBase ?? null, value.expectedHigh ?? null);
  return {
    symbol: source.symbol,
    name: source.name,
    bias: value.bias,
    ...probabilities,
    confidence: Number(value.confidence.toFixed(2)),
    ...prices,
    triggerPrice: nullablePrice(value.triggerPrice),
    stopLossPrice: nullablePrice(value.stopLossPrice),
    takeProfitPrice: nullablePrice(value.takeProfitPrice),
    rationale: value.rationale,
    catalysts: value.catalysts.slice(0, 5),
    risks: value.risks.slice(0, 5),
    invalidIf: value.invalidIf
  };
}

function fallbackForecast(symbols: ResearchSymbolData[], model: string, reason: string): ResearchForecast {
  return {
    status: "fallback",
    model,
    generatedAt: new Date().toISOString(),
    horizonTradingDays: 10,
    marketView: "DeepSeek 场景预测暂不可用，当前仅按价格趋势和历史波动生成本地基线。",
    riskNotes: ["本地基线未完整理解新闻语义，需在 ChatGPT 线程或下一次 DeepSeek 分析中复核。"],
    symbols: symbols.map(fallbackSymbolForecast),
    fallbackReason: reason,
    disclaimer: "本地概率基线仅供研究，不构成投资建议。"
  };
}

function fallbackSymbolForecast(source: ResearchSymbolData): ResearchSymbolForecast {
  const candles = source.candles;
  const latest = candles.at(-1);
  const lookback = candles.slice(-20);
  const first = lookback[0];
  const momentum = latest && first?.close ? (latest.close / first.close - 1) * 100 : 0;
  const dailyReturns = candles.slice(-30).map((item, index, rows) => index ? (item.close / rows[index - 1].close - 1) : 0).slice(1);
  const volatility = standardDeviation(dailyReturns);
  const score = Math.max(-18, Math.min(18, momentum * 2));
  const probabilities = normalizeProbabilities(33 + score, 34, 33 - score);
  const price = latest?.close ?? null;
  const rangeMove = price ? Math.max(0.03, volatility * Math.sqrt(10)) : 0;
  const expectedLow = price ? roundPrice(price * (1 - rangeMove)) : null;
  const expectedHigh = price ? roundPrice(price * (1 + rangeMove)) : null;
  return {
    symbol: source.symbol,
    name: source.name,
    bias: momentum > 2 ? "bullish" : momentum < -2 ? "bearish" : "neutral",
    ...probabilities,
    confidence: candles.length >= 60 ? 0.45 : 0.3,
    expectedLow,
    expectedBase: price ? roundPrice(price) : null,
    expectedHigh,
    triggerPrice: price ? roundPrice(price) : null,
    stopLossPrice: expectedLow,
    takeProfitPrice: expectedHigh,
    rationale: `最近 ${lookback.length} 根 K 线涨跌约 ${momentum.toFixed(2)}%，本地基线按历史波动估算。`,
    catalysts: [],
    risks: source.historyError ? [source.historyError] : ["本地基线没有完成新闻因果判断。"],
    invalidIf: "新行情、重大新闻或波动结构变化后，本场景立即失效并需重新生成。"
  };
}

function normalizeProbabilities(up: number, sideways: number, down: number) {
  const values = [Math.max(0, up), Math.max(0, sideways), Math.max(0, down)];
  const total = values.reduce((sum, item) => sum + item, 0) || 1;
  const normalized = values.map((item) => Math.round(item / total * 100));
  normalized[1] += 100 - normalized.reduce((sum, item) => sum + item, 0);
  return { upProbability: normalized[0], sidewaysProbability: normalized[1], downProbability: normalized[2] };
}

function normalizePriceRange(low: number | null, base: number | null, high: number | null) {
  const values = [nullablePrice(low), nullablePrice(base), nullablePrice(high)].filter((item): item is number => item !== null).sort((a, b) => a - b);
  if (values.length !== 3) return { expectedLow: null, expectedBase: null, expectedHigh: null };
  return { expectedLow: values[0], expectedBase: values[1], expectedHigh: values[2] };
}

function nullablePrice(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? roundPrice(number) : null;
}

function parseJsonObject(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("DeepSeek 返回内容不是有效 JSON。");
  }
}

function standardDeviation(values: number[]) {
  if (!values.length) return 0.02;
  const mean = values.reduce((sum, item) => sum + item, 0) / values.length;
  const variance = values.reduce((sum, item) => sum + (item - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function roundPrice(value: number) {
  return Number(value.toFixed(4));
}

function numberEnv(name: string, fallback: number) {
  const number = Number(process.env[name]);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
