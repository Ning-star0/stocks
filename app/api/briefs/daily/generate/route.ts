import { NextResponse } from "next/server";

import { generateDailyBrief } from "@/lib/briefs/generateDailyBrief";
import { getCurrentUser } from "@/lib/currentUser";
import { apiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

export async function POST() {
  try {
    const user = await getCurrentUser();
    const today = startOfDay(new Date());
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [watchlists, sectorWatches, newsItems] = await Promise.all([
      prisma.watchlist.findMany({
        where: { userId: user.id },
        include: { items: true }
      }),
      prisma.sectorWatch.findMany({ where: { userId: user.id } }),
      prisma.newsItem.findMany({
        where: { publishedAt: { gte: since } },
        include: { analyses: { orderBy: { createdAt: "desc" }, take: 1 } },
        orderBy: { publishedAt: "desc" },
        take: 30
      })
    ]);

    const output = await generateDailyBrief({
      watchlistItems: watchlists.flatMap((watchlist) => watchlist.items),
      sectorWatches,
      newsItems
    });

    const brief = await prisma.dailyMarketBrief.upsert({
      where: {
        userId_date: {
          userId: user.id,
          date: today
        }
      },
      update: output,
      create: {
        userId: user.id,
        date: today,
        ...output
      }
    });

    return NextResponse.json({ brief });
  } catch (error) {
    return apiError(error);
  }
}

function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

