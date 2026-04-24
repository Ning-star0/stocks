import { NextResponse } from "next/server";

import { apiError } from "@/lib/errors";
import { enqueueJob } from "@/lib/jobs/enqueueJob";
import { JOB_PRIORITY, JOB_TYPES } from "@/lib/jobs/jobTypes";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/currentUser";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await getCurrentUser();
    const newsItem = await prisma.newsItem.findUnique({ where: { id } });
    if (!newsItem) return NextResponse.json({ error: { code: "SYMBOL_NOT_FOUND", message: "未找到该新闻。" } }, { status: 404 });
    const existing = await prisma.newsAnalysis.findFirst({ where: { newsItemId: newsItem.id }, orderBy: { createdAt: "desc" } });
    if (existing) return NextResponse.json({ analysis: existing, fromCache: true });
    const job = await enqueueJob({
      userId: user.id,
      symbol: newsItem.symbols[0] ?? null,
      jobType: JOB_TYPES.NEWS_ANALYSIS,
      priority: newsItem.importance === "high" ? JOB_PRIORITY.HIGH_IMPORTANCE_NEWS : JOB_PRIORITY.SCHEDULED_REFRESH,
      inputHash: `news:${newsItem.id}`,
      payload: { newsItemId: newsItem.id, reason: "user_requested_news_analysis" }
    });

    return NextResponse.json({ jobId: job.id, status: job.status, queued: true }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
