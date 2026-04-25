import { NextRequest, NextResponse } from "next/server";

import { remember } from "@/lib/cache";
import { apiError } from "@/lib/errors";
import { isNewsRelevantToStock } from "@/lib/news/relevance";
import { serializeNewsItem } from "@/lib/news/store";
import { prisma } from "@/lib/prisma";
import { newsQuerySchema } from "@/lib/schemas";

export async function GET(request: NextRequest) {
  try {
    const query = newsQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") ?? 1));
    const pageSize = Math.min(20, Math.max(1, Number(request.nextUrl.searchParams.get("pageSize") ?? 20)));
    const includeLow = request.nextUrl.searchParams.get("includeLow") === "1";
    const name = request.nextUrl.searchParams.get("name");
    const where = {
      ...(includeLow ? {} : { importance: { in: ["high", "medium"] } }),
      ...(query.symbol ? { symbols: { has: query.symbol } } : {}),
      ...(query.sector ? { sectors: { has: query.sector } } : {}),
      ...(query.from || query.to
        ? {
            publishedAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {})
            }
          }
        : {}),
      ...(query.keyword
        ? {
            OR: [
              { title: { contains: query.keyword, mode: "insensitive" as const } },
              { summary: { contains: query.keyword, mode: "insensitive" as const } },
              { rawContent: { contains: query.keyword, mode: "insensitive" as const } }
            ]
          }
        : {})
    };

    const cacheKey =
      page === 1 && query.symbol && !query.sector && !query.keyword && !query.from && !query.to
        ? `news:v2:${query.symbol}:${includeLow ? "all" : "24h"}`
        : null;
    const loadNews = () =>
      prisma.newsItem.findMany({
        where,
        include: {
          analyses: {
            orderBy: { createdAt: "desc" },
            take: 1
          }
        },
        orderBy: { publishedAt: "desc" },
        take: pageSize,
        skip: (page - 1) * pageSize
      });
    const rows = cacheKey ? await remember(cacheKey, 15 * 60, loadNews) : await loadNews();

    const relevantRows = query.symbol && name ? rows.filter((row) => isNewsRelevantToStock(row, { symbol: query.symbol!, name })) : rows;
    const news = relevantRows
      .map(serializeNewsItem)
      .sort((a, b) => importanceRank(b.importance as string | null) - importanceRank(a.importance as string | null));
    return NextResponse.json({ news, page, pageSize });
  } catch (error) {
    return apiError(error);
  }
}

function importanceRank(value?: string | null) {
  if (value === "high") return 3;
  if (value === "medium") return 2;
  if (value === "low") return 1;
  return 0;
}
