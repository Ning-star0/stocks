import OpenAI from "openai";
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

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
  const baseUrl = normalizeBaseUrl(process.env.OPENAI_BASE_URL);
  if (!baseUrl.includes("deepseek.com")) {
    return client.chat.completions.create(request);
  }

  return createDeepSeekCompletion(baseUrl, request);
}

async function createDeepSeekCompletion(baseUrl: string, request: ChatCompletionCreateParamsNonStreaming) {
  const apiKey = normalizeApiKey(process.env.OPENAI_API_KEY);
  if (!apiKey) {
    throw new AppError("DATA_PROVIDER_ERROR", "DeepSeek API key 未配置。请在 .env 中设置 OPENAI_API_KEY 后重启网站和 worker。");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), numberEnv("AI_REQUEST_TIMEOUT_MS", 60000));

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
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
    const message = error instanceof Error ? error.message : "未知连接错误";
    throw new AppError("DATA_PROVIDER_ERROR", `DeepSeek API 连接失败：${message}`, {
      baseUrl,
      hint: "请在服务器执行 curl -I https://api.deepseek.com 检查出站网络。"
    });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeBaseUrl(value?: string) {
  return (value || "https://api.deepseek.com").trim().replace(/\/+$/, "");
}

function normalizeApiKey(value?: string) {
  const key = value?.trim().replace(/^["']|["']$/g, "");
  if (!key || key.includes("CHANGE_ME")) return null;
  return key;
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
