import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

import { createChatCompletion } from "@/lib/ai/deepseek";

export type GenerateNewsSearchQueriesInput = {
  symbol: string;
  name?: string | null;
  sectorKeywords?: string[];
};

export async function generateNewsSearchQueries(input: GenerateNewsSearchQueriesInput): Promise<string[]> {
  if (!normalizeApiKey(process.env.OPENAI_API_KEY)) return fallbackQueries(input);

  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined
    });
    const request: ChatCompletionCreateParamsNonStreaming = {
      model: process.env.OPENAI_MODEL || "deepseek-v4-flash",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "你是金融新闻搜索关键词生成器。你不能编造新闻，只能生成适合搜索引擎检索真实网页新闻的中文搜索词。输出严格 JSON。"
        },
        {
          role: "user",
          content: `请为以下股票或 ETF 生成 6 个中文联网搜索词，用于搜索相关新闻、公告、行业消息和政策影响。搜索词要覆盖股票名称、股票代码、简称、行业主题、上下游、公告/业绩/订单/政策等角度。

股票代码：${input.symbol}
股票名称：${input.name ?? "未知"}
行业/主题关键词：${JSON.stringify(input.sectorKeywords ?? [])}

只返回 JSON：
{
  "queries": []
}`
        }
      ]
    };
    const completion = await createChatCompletion(client, request);
    const text = completion.choices[0]?.message?.content ?? "";
    const parsed = parseJson(text);
    const queries = Array.isArray(parsed.queries) ? parsed.queries : [];
    return cleanQueries([...queries.map(String), ...fallbackQueries(input)]).slice(0, 8);
  } catch {
    return fallbackQueries(input);
  }
}

function fallbackQueries(input: GenerateNewsSearchQueriesInput) {
  const compact = input.symbol.replace(/\.(SH|SZ|BJ|HK)$/i, "");
  const name = input.name?.trim();
  const sectors = (input.sectorKeywords ?? []).filter(Boolean).slice(0, 4);
  return cleanQueries([
    `${name || compact} 最新公告`,
    `${name || compact} 最新新闻`,
    `${name || compact} 业绩 订单 合同`,
    `${name || compact} 政策 影响`,
    `${compact} 股票 新闻`,
    ...sectors.map((sector) => `${name || compact} ${sector} 最新消息`)
  ]);
}

function cleanQueries(values: string[]) {
  return [...new Set(values.map((value) => value.replace(/\s+/g, " ").trim()).filter((value) => value.length >= 4))];
}

function parseJson(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned) as { queries?: unknown[] };
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as { queries?: unknown[] };
    return {};
  }
}

function normalizeApiKey(value?: string) {
  const key = value?.trim().replace(/^["']|["']$/g, "");
  if (!key || key.includes("CHANGE_ME")) return null;
  return key;
}
