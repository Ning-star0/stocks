import OpenAI from "openai";
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

import { getAiConfig } from "@/lib/ai/config";
import { AppError } from "@/lib/errors";

type DeepSeekErrorPayload = {
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
};

export async function createChatCompletion(
  client: OpenAI,
  request: ChatCompletionCreateParamsNonStreaming
): Promise<ChatCompletion> {
  const config = await getAiConfig();
  if (!config.baseUrl.includes("deepseek.com")) {
    return client.chat.completions.create(request);
  }
  return createDeepSeekCompletion(config, request);
}

async function createDeepSeekCompletion(config: { apiKey: string; baseUrl: string }, request: ChatCompletionCreateParamsNonStreaming) {
  const apiKey = config.apiKey;
  if (!apiKey) {
    throw new AppError("DATA_PROVIDER_ERROR", "API key 未配置。请在 AI 设置页面填写 API 密钥。");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), numberEnv("AI_REQUEST_TIMEOUT_MS", 120000));

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...request,
        thinking: { type: "disabled" }
      }),
      signal: controller.signal
    });

    const text = await response.text();
    const payload = parsePayload(text);

    if (!response.ok) {
      const message = payload.error?.message || text.slice(0, 500) || response.statusText;
      if (response.status === 401 || response.status === 403) {
        throw new AppError("DATA_PROVIDER_ERROR", `DeepSeek 鉴权失败：${message}`, {
          status: response.status
        });
      }
      if (response.status === 429) {
        throw new AppError("RATE_LIMIT", `DeepSeek API 限流：${message}`, {
          status: response.status
        });
      }
      throw new AppError("DATA_PROVIDER_ERROR", `DeepSeek API 请求失败：HTTP ${response.status}，${message}`, {
        status: response.status
      });
    }

    return payload as ChatCompletion;
  } catch (error) {
    if (error instanceof AppError) throw error;
    const message = error instanceof Error && error.name === "AbortError"
      ? `请求超过 ${Math.round(numberEnv("AI_REQUEST_TIMEOUT_MS", 120000) / 1000)} 秒未返回，已自动中断`
      : error instanceof Error ? error.message : "未知连接错误";
    throw new AppError("DATA_PROVIDER_ERROR", `DeepSeek API 连接失败：${message}`, {
      baseUrl: config.baseUrl,
      hint: error instanceof Error && error.name === "AbortError"
        ? "请稍后重试，或减少传入新闻数量/切换更快模型。"
        : "请检查 API 地址和密钥是否正确。"
    });
  } finally {
    clearTimeout(timeout);
  }
}

function parsePayload(text: string): ChatCompletion & DeepSeekErrorPayload {
  if (!text) return {} as ChatCompletion & DeepSeekErrorPayload;
  try {
    return JSON.parse(text) as ChatCompletion & DeepSeekErrorPayload;
  } catch {
    return { error: { message: text.slice(0, 500) } } as ChatCompletion & DeepSeekErrorPayload;
  }
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
