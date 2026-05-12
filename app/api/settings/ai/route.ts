import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/currentUser";
import { getAiConfig, updateAiConfig } from "@/lib/ai/config";
import { apiError } from "@/lib/errors";

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
    const newApiKey = String(body.apiKey ?? "").trim();
    const current = await getAiConfig();
    // 防止错误输入（如邮箱地址）被写进 DB
    const rawBaseUrl = String(body.baseUrl ?? "").trim();
    let baseUrl = rawBaseUrl || "https://api.deepseek.com";
    if (!baseUrl.startsWith("https://") && !baseUrl.startsWith("http://")) {
      baseUrl = "https://api.deepseek.com";
    }

    const config = await updateAiConfig({
      apiKey: newApiKey || current.apiKey,
      baseUrl,
      model: String(body.model ?? "").trim() || "deepseek-v4-pro"
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
