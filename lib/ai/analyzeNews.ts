import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

import { createChatCompletion } from "@/lib/ai/deepseek";
import { AppError } from "@/lib/errors";
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
  "你是一个谨慎的金融新闻分析助手。你只能基于提供的新闻内容进行分析。你不能夸大新闻影响，不能给出确定性投资建议。请判断新闻情绪、影响方向、影响级别、相关股票、相关行业和风险点。必须输出严格 JSON。";

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
            content: attempt === 0 ? prompt : `${prompt}\n\n上一次输出没有通过校验。请只返回严格 JSON。`
          }
        ]
      };
      const completion = await createChatCompletion(client, request);

      const text = completion.choices[0]?.message?.content;
      if (!text) throw new Error("AI 返回了空内容。");
      return newsAnalysisSchema.parse(JSON.parse(text));
    } catch (error) {
      lastError = error;
    }
  }

  throw new AppError("AI_INVALID_JSON", "AI 多次返回非法新闻分析 JSON。", {
    reason: lastError instanceof Error ? lastError.message : "未知错误"
  });
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

请返回严格 JSON：
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

function fallbackNewsAnalysis(input: AnalyzeNewsInput): NewsAnalysisResult {
  const text = `${input.title} ${input.content ?? ""}`.toLowerCase();
  const negativeTerms = ["risk", "miss", "cut", "probe", "lawsuit", "delay", "weak", "loss"];
  const positiveTerms = ["beat", "growth", "upgrade", "launch", "partnership", "demand", "approval"];
  const sentiment = negativeTerms.some((term) => text.includes(term))
    ? "negative"
    : positiveTerms.some((term) => text.includes(term))
      ? "positive"
      : "neutral";
  const impactLevel = text.includes("fed") || text.includes("earnings") || text.includes("guidance") ? "medium" : "low";

  return {
    summary: truncate(input.content || input.title, 280),
    sentiment,
    impactLevel,
    affectedSymbols: input.candidateSymbols ?? [],
    affectedSectors: input.candidateSectors ?? [],
    riskNotes: ["当前未配置 OPENAI_API_KEY，新闻分析使用关键词规则兜底，可能遗漏上下文。"],
    whyItMatters: "该消息可能影响市场情绪或短期交易定位，但当前上下文有限。",
    confidence: 0.35
  };
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}
