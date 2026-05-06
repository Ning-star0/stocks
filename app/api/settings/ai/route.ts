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
    const newApiKey = String(body.apiKey ?? "").trim();
    const current = await getAiConfig();
    const config = await updateAiConfig({
      apiKey: newApiKey || current.apiKey,
      baseUrl: String(body.baseUrl ?? "").trim() || "https://api.deepseek.com",
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
