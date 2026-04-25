import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/currentUser";
import { AppError, apiError } from "@/lib/errors";
import { enqueueJob } from "@/lib/jobs/enqueueJob";
import { JOB_PRIORITY, JOB_TYPES } from "@/lib/jobs/jobTypes";
import { prisma } from "@/lib/prisma";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await getCurrentUser();
    const newsItem = await prisma.newsItem.findUnique({ where: { id } });
    if (!newsItem) throw new AppError("SYMBOL_NOT_FOUND", "未找到该新闻。");

    const existing = await prisma.newsAnalysis.findFirst({ where: { newsItemId: newsItem.id }, orderBy: { createdAt: "desc" } });
    if (existing) return NextResponse.json({ analysis: existing, fromCache: true });

    if (newsItem.importance !== "high") {
      throw new AppError("BAD_REQUEST", "只有高重要性新闻才会进入 AI 精读，普通新闻只展示不调用 AI。");
    }

    const job = await enqueueJob({
      userId: user.id,
      symbol: newsItem.symbols[0] ?? null,
      jobType: JOB_TYPES.NEWS_ANALYSIS,
      priority: JOB_PRIORITY.HIGH_IMPORTANCE_NEWS,
      inputHash: `news:${newsItem.id}`,
      payload: { newsItemId: newsItem.id, reason: "user_requested_high_importance_news_analysis" }
    });

    return NextResponse.json({ jobId: job.id, status: job.status, queued: true }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
