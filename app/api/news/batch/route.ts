import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getCache, setCache } from "@/lib/cache";
import { apiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { symbolSchema } from "@/lib/schemas";
import { serializeNewsItem } from "@/lib/news/store";

const requestSchema = z.object({
  symbols: z.array(symbolSchema).min(1).max(numberEnv("MAX_BATCH_SYMBOLS", 50)),
  pageSize: z.coerce.number().int().min(1).max(20).default(10)
});

export async function POST(request: NextRequest) {
  try {
    const body = requestSchema.parse(await request.json());
    const news: Record<string, unknown[]> = {};

    for (const symbol of [...new Set(body.symbols)]) {
      const cacheKey = `news:${symbol}:24h`;
      const cached = await getCache<unknown[]>(cacheKey);
      if (cached) {
        news[symbol] = cached;
        continue;
      }
      const rows = await prisma.newsItem.findMany({
        where: {
          symbols: { has: symbol },
          importance: { in: ["high", "medium"] },
          publishedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        },
        select: {
          id: true,
          title: true,
          titleHash: true,
          url: true,
          source: true,
          publishedAt: true,
          summary: true,
          symbols: true,
          sectors: true,
          sentiment: true,
          importance: true,
          createdAt: true,
          analyses: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              aiSummary: true,
              sentiment: true,
              affectedSymbols: true,
              affectedSectors: true,
              impactLevel: true,
              riskNotes: true,
              whyItMatters: true,
              confidence: true,
              createdAt: true
            }
          }
        },
        orderBy: [{ importance: "desc" }, { publishedAt: "desc" }],
        take: body.pageSize
      });
      news[symbol] = rows.map(serializeNewsItem);
      await setCache(cacheKey, news[symbol], numberEnv("NEWS_CACHE_TTL_SECONDS", 900));
    }

    return NextResponse.json({ news });
  } catch (error) {
    return apiError(error);
  }
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
