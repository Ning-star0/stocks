import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/currentUser";
import { apiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await getCurrentUser();
    const job = await prisma.analysisJob.findFirst({
      where: { id, userId: user.id }
    });
    if (!job) return NextResponse.json({ error: { code: "BAD_REQUEST", message: "未找到该任务。" } }, { status: 404 });

    let result = null;
    if (job.resultId && job.jobType === "stock_analysis") {
      result = await prisma.aiAnalysis.findUnique({ where: { id: job.resultId } });
    }
    if (job.resultId && job.jobType === "news_analysis") {
      result = await prisma.newsAnalysis.findUnique({ where: { id: job.resultId } });
    }
    if (job.resultId && job.jobType === "daily_brief") {
      result = await prisma.dailyMarketBrief.findUnique({ where: { id: job.resultId } });
    }

    return NextResponse.json({
      id: job.id,
      status: job.status,
      result,
      errorMessage: job.errorMessage,
      job,
      resultId: job.resultId
    });
  } catch (error) {
    return apiError(error);
  }
}
