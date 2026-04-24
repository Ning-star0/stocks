import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

import { createChatCompletion } from "@/lib/ai/deepseek";

export type DailyBriefInput = {
  watchlistItems: unknown[];
  newsItems: unknown[];
  sectorWatches: unknown[];
};

export async function generateDailyBrief(input: DailyBriefInput) {
  if (!process.env.OPENAI_API_KEY) return fallbackBrief(input);

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
        content: `请基于以下数据生成每日市场简报：\n${JSON.stringify(input, null, 2)}`
      }
    ]
  };
  const completion = await createChatCompletion(client, request);

  const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Partial<ReturnType<typeof fallbackBrief>>;
  return {
    watchlistSummary: parsed.watchlistSummary || "暂无自选股摘要。",
    sectorSummary: parsed.sectorSummary || "暂无行业摘要。",
    riskSummary: parsed.riskSummary || "暂无风险摘要。"
  };
}

function fallbackBrief(input: DailyBriefInput) {
  return {
    watchlistSummary: `当前跟踪 ${input.watchlistItems.length} 个自选股，本摘要由本地兜底逻辑生成。`,
    sectorSummary: `当前关注 ${input.sectorWatches.length} 个行业主题，并纳入 ${input.newsItems.length} 条近期新闻。`,
    riskSummary: "做任何判断前，请复核高影响新闻、宏观消息和数据更新时间。本内容不构成投资建议。"
  };
}
