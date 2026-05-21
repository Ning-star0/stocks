import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/currentUser";
import { getAiConfig, normalizeAiApiKey, normalizeAiBaseUrl, normalizeAiModel, updateAiConfig } from "@/lib/ai/config";
import { AppError, apiError } from "@/lib/errors";

export async function GET() {
  try {
    await getCurrentUser();
    const config = await getAiConfig();
    return NextResponse.json({
      baseUrl: config.baseUrl,
      model: config.model,
      apiKeyMasked: config.apiKey ? `${config.apiKey.slice(0, 8)}***${config.apiKey.slice(-4)}` : ""
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    await getCurrentUser();
    const body = await request.json();
    // 前端不填密钥时 newApiKey 为空，用 current.apiKey 保留之前的值
    const newApiKey = normalizeAiApiKey(body.apiKey);
    const current = await getAiConfig();
    const baseUrl = normalizeAiBaseUrl(body.baseUrl);

    const config = await updateAiConfig({
      apiKey: newApiKey || current.apiKey,
      baseUrl,
      model: normalizeAiModel(body.model)
    });
    return NextResponse.json({
      baseUrl: config.baseUrl,
      model: config.model,
      apiKeyMasked: config.apiKey ? `${config.apiKey.slice(0, 8)}***${config.apiKey.slice(-4)}` : ""
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await getCurrentUser();
    const body = await request.json().catch(() => ({}));
    const current = await getAiConfig();
    const config = {
      apiKey: normalizeAiApiKey(body.apiKey) || current.apiKey,
      baseUrl: normalizeAiBaseUrl(body.baseUrl ?? current.baseUrl),
      model: normalizeAiModel(body.model ?? current.model)
    };
    const startedAt = Date.now();
    const result = await testAiConnection(config);
    return NextResponse.json({
      ok: true,
      model: config.model,
      baseUrl: config.baseUrl,
      latencyMs: Date.now() - startedAt,
      sample: result
    });
  } catch (error) {
    return apiError(error);
  }
}

async function testAiConnection(config: { apiKey: string; baseUrl: string; model: string }) {
  if (!config.apiKey) throw new AppError("DATA_PROVIDER_ERROR", "API key 未配置。");

  const controller = new AbortController();
  const timeoutMs = numberEnv("AI_TEST_TIMEOUT_MS", 20000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        max_tokens: 8,
        ...(config.baseUrl.includes("deepseek.com") ? { thinking: { type: "disabled" } } : {}),
        messages: [
          { role: "system", content: "只回复 OK。" },
          { role: "user", content: "ping" }
        ]
      }),
      signal: controller.signal
    });

    const text = await response.text();
    let payload: { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } } = {};
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: { message: text.slice(0, 300) } };
    }
    if (!response.ok) {
      throw new AppError("DATA_PROVIDER_ERROR", `AI 测试失败：HTTP ${response.status}，${payload.error?.message || response.statusText}`);
    }
    return payload.choices?.[0]?.message?.content?.trim() || "OK";
  } catch (error) {
    if (error instanceof AppError) throw error;
    const message = error instanceof Error && error.name === "AbortError"
      ? `测试超过 ${Math.round(timeoutMs / 1000)} 秒未返回`
      : error instanceof Error ? error.message : "未知错误";
    throw new AppError("DATA_PROVIDER_ERROR", `AI 测试连接失败：${message}`);
  } finally {
    clearTimeout(timeout);
  }
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
