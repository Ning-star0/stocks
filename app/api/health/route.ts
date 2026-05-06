import { NextResponse } from "next/server";

import { apiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      ok: true,
      database: "ok",
      aiModel: process.env.OPENAI_MODEL || "deepseek-v4-pro",
      stockDataProvider: process.env.STOCK_DATA_PROVIDER || "mock",
      newsProvider: process.env.NEWS_PROVIDER || "mock",
      backgroundWorkerEnabled: process.env.ENABLE_BACKGROUND_WORKER !== "false",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return apiError(error);
  }
}
