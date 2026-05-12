import { NextResponse } from "next/server";

import { getAiConfig } from "@/lib/ai/config";
import { apiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const aiConfig = await getAiConfig();
    return NextResponse.json({
      ok: true,
      database: "ok",
      aiModel: aiConfig.model,
      aiBaseUrl: aiConfig.baseUrl,
      aiKeyConfigured: !!aiConfig.apiKey,
      stockDataProvider: process.env.STOCK_DATA_PROVIDER || "mock",
      newsProvider: process.env.NEWS_PROVIDER || "mock",
      backgroundWorkerEnabled: process.env.ENABLE_BACKGROUND_WORKER !== "false",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return apiError(error);
  }
}
