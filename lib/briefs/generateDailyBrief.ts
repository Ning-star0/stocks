import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

import { createChatCompletion } from "@/lib/ai/deepseek";

export type DailyBriefInput = {
  watchlistItems: unknown[];
  newsItems: unknown[];
  sectorWatches: unknown[];
};

export async function generateDailyBrief(input: DailyBriefInput) {
  if (!normalizeApiKey(process.env.OPENAI_API_KEY)) {
    return fallbackBrief(input, "DeepSeek API key 未配置，已生成本地规则简报。");
  }

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined
  });

  const request: ChatCompletionCreateParamsNonStreaming = {
    model: process.env.OPENAI_MODEL || "deepseek-v4-flash",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "你负责生成谨慎的每日市场简报，仅供研究使用。不要给出交易指令，不要承诺收益。请返回严格 JSON，字段包括 watchlistSummary、sectorSummary、riskSummary。"
      },
      {
        role: "user",
        content: `请基于以下数据生成每日市场简报，输出严格 JSON：\n${JSON.stringify(trimInput(input), null, 2)}`
      }
    ]
  };

  try {
    const completion = await createChatCompletion(client, request);
    const parsed = parseJsonObject(completion.choices[0]?.message?.content ?? "{}") as Partial<ReturnType<typeof fallbackBrief>>;
    return {
      watchlistSummary: toNonEmptyString(parsed.watchlistSummary, "暂无自选股摘要。"),
      sectorSummary: toNonEmptyString(parsed.sectorSummary, "暂无行业摘要。"),
      riskSummary: toNonEmptyString(parsed.riskSummary, "暂无风险摘要。")
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return fallbackBrief(input, `AI 简报生成失败，已改用本地规则简报。原因：${message}`);
  }
}

function fallbackBrief(input: DailyBriefInput, reason: string) {
  return {
    watchlistSummary: `当前跟踪 ${input.watchlistItems.length} 个自选标的。${reason}`,
    sectorSummary: `当前关注 ${input.sectorWatches.length} 个行业主题，纳入 ${input.newsItems.length} 条近期新闻。`,
    riskSummary: "做任何判断前，请复核高影响新闻、宏观消息和数据更新时间。本内容仅供研究参考，不构成投资建议。"
  };
}

function trimInput(input: DailyBriefInput): DailyBriefInput {
  return {
    watchlistItems: input.watchlistItems.slice(0, 30),
    sectorWatches: input.sectorWatches.slice(0, 20),
    newsItems: input.newsItems.slice(0, 20)
  };
}

function parseJsonObject(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("AI 返回内容不是可解析的 JSON。");
  }
}

function toNonEmptyString(value: unknown, fallback: string) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeApiKey(value?: string) {
  const key = value?.trim().replace(/^["']|["']$/g, "");
  if (!key || key.includes("CHANGE_ME")) return null;
  return key;
}
