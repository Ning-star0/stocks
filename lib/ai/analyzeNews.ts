import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

import { createChatCompletion } from "@/lib/ai/deepseek";
import { newsAnalysisSchema } from "@/lib/schemas";
import type { NewsAnalysisResult } from "@/lib/types";

export type AnalyzeNewsInput = {
  title: string;
  source?: string | null;
  publishedAt: string;
  content?: string | null;
  candidateSymbols?: string[];
  candidateSectors?: string[];
};

const systemPrompt =
  "你是一个谨慎的金融新闻分析助手。你只能基于提供的新闻内容进行分析。你不能夸大新闻影响，不能给出确定性投资建议。请判断新闻情绪、影响方向、影响级别、相关股票、相关行业和风险点。必须输出严格 JSON，不要输出 Markdown。";

export async function analyzeNews(input: AnalyzeNewsInput): Promise<NewsAnalysisResult> {
  if (!process.env.OPENAI_API_KEY) return fallbackNewsAnalysis(input);

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined
  });

  const prompt = buildPrompt(input);
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const request: ChatCompletionCreateParamsNonStreaming = {
        model: process.env.OPENAI_MODEL || "deepseek-v4-flash",
        temperature: 0.15,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: attempt === 0 ? prompt : `${prompt}\n\n上一次输出没有通过校验。请只返回严格 JSON，枚举值必须使用英文值。`
          }
        ]
      };
      const completion = await createChatCompletion(client, request);

      const text = completion.choices[0]?.message?.content;
      if (!text) throw new Error("AI 返回了空内容。");
      return newsAnalysisSchema.parse(normalizeNewsAnalysis(parseJsonObject(text), input));
    } catch (error) {
      lastError = error;
    }
  }

  return fallbackNewsAnalysis(
    input,
    `AI 新闻分析返回内容未通过 JSON/schema 校验，系统已改用关键词规则兜底。原因：${lastError instanceof Error ? lastError.message : "未知错误"}`
  );
}

function buildPrompt(input: AnalyzeNewsInput) {
  return `请分析以下新闻：

标题：
${input.title}

来源：
${input.source ?? "未知来源"}

发布时间：
${input.publishedAt}

正文或摘要：
${truncate(input.content ?? input.title, 6000)}

相关股票候选：
${JSON.stringify(input.candidateSymbols ?? [])}

相关行业候选：
${JSON.stringify(input.candidateSectors ?? [])}

请只返回严格 JSON：
{
  "summary": "",
  "sentiment": "positive | neutral | negative",
  "impactLevel": "low | medium | high",
  "affectedSymbols": [],
  "affectedSectors": [],
  "riskNotes": [],
  "whyItMatters": "",
  "confidence": 0.0
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

function normalizeNewsAnalysis(value: unknown, input: AnalyzeNewsInput) {
  const record = isRecord(value) ? value : {};
  return {
    summary: toNonEmptyString(record.summary, truncate(input.content || input.title, 280)),
    sentiment: normalizeSentiment(record.sentiment),
    impactLevel: normalizeImpact(record.impactLevel ?? record.importance),
    affectedSymbols: normalizeSymbolArray(record.affectedSymbols, input.candidateSymbols ?? []),
    affectedSectors: toStringArray(record.affectedSectors).length ? toStringArray(record.affectedSectors) : input.candidateSectors ?? [],
    riskNotes: toStringArray(record.riskNotes).length ? toStringArray(record.riskNotes) : ["AI 新闻分析可能遗漏上下文，请结合原文和市场数据复核。"],
    whyItMatters: toNonEmptyString(record.whyItMatters, "该新闻可能影响市场情绪或相关主题关注度，但影响需要结合行情验证。"),
    confidence: normalizeConfidence(record.confidence)
  };
}

function normalizeSentiment(value: unknown) {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("positive") || text.includes("利好") || text.includes("正面")) return "positive";
  if (text.includes("negative") || text.includes("利空") || text.includes("负面")) return "negative";
  return "neutral";
}

function normalizeImpact(value: unknown) {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("high") || text.includes("高")) return "high";
  if (text.includes("medium") || text.includes("中")) return "medium";
  return "low";
}

function normalizeConfidence(value: unknown) {
  const number = typeof value === "number" ? value : Number(String(value ?? "").replace("%", ""));
  if (!Number.isFinite(number)) return 0.5;
  const normalized = number > 1 ? number / 100 : number;
  return Math.min(1, Math.max(0, normalized));
}

function normalizeSymbolArray(value: unknown, fallback: string[]) {
  const values = Array.isArray(value) ? value : fallback;
  return values.map((item) => String(item ?? "").trim().toUpperCase()).filter((item) => /^[A-Z0-9.\-_:]{1,16}$/.test(item));
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

function fallbackNewsAnalysis(input: AnalyzeNewsInput, reason = "当前未配置 OPENAI_API_KEY，新闻分析使用关键词规则兜底，可能遗漏上下文。"): NewsAnalysisResult {
  const text = `${input.title} ${input.content ?? ""}`.toLowerCase();
  const negativeTerms = ["risk", "miss", "cut", "probe", "lawsuit", "delay", "weak", "loss", "下滑", "调查", "诉讼"];
  const positiveTerms = ["beat", "growth", "upgrade", "launch", "partnership", "demand", "approval", "增长", "上调", "合作"];
  const sentiment = negativeTerms.some((term) => text.includes(term))
    ? "negative"
    : positiveTerms.some((term) => text.includes(term))
      ? "positive"
      : "neutral";
  const impactLevel = text.includes("fed") || text.includes("earnings") || text.includes("guidance") || text.includes("业绩") ? "medium" : "low";

  return {
    summary: truncate(input.content || input.title, 280),
    sentiment,
    impactLevel,
    affectedSymbols: input.candidateSymbols ?? [],
    affectedSectors: input.candidateSectors ?? [],
    riskNotes: [reason],
    whyItMatters: "该消息可能影响市场情绪或短期交易定位，但当前上下文有限。",
    confidence: 0.35
  };
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}
