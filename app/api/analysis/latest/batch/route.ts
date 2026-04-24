import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getCache, setCache } from "@/lib/cache";
import { getCurrentUser } from "@/lib/currentUser";
import { apiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { symbolSchema } from "@/lib/schemas";

const requestSchema = z.object({
  symbols: z.array(symbolSchema).min(1).max(numberEnv("MAX_BATCH_SYMBOLS", 50))
});

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const body = requestSchema.parse(await request.json());
    const symbols = [...new Set(body.symbols)];
    const analyses: Record<string, unknown> = {};

    for (const symbol of symbols) {
      const cacheKey = `latest_analysis:${symbol}`;
      const cached = await getCache<unknown>(cacheKey);
      if (cached) {
        analyses[symbol] = cached;
        continue;
      }
      const latest = await prisma.aiAnalysis.findFirst({
        where: { userId: user.id, symbol },
        orderBy: { createdAt: "desc" }
      });
      analyses[symbol] = latest
        ? { id: latest.id, symbol: latest.symbol, createdAt: latest.createdAt, outputJson: latest.outputJson }
        : null;
      await setCache(cacheKey, analyses[symbol], numberEnv("LATEST_ANALYSIS_CACHE_TTL_SECONDS", 300));
    }

    return NextResponse.json({ analyses });
  } catch (error) {
    return apiError(error);
  }
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

