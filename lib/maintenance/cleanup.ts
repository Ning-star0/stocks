import { deleteExpiredCache } from "@/lib/cache";
import { prisma } from "@/lib/prisma";

export async function cleanupRetention() {
  const quoteCutoff = daysAgo(numberEnv("QUOTE_RETENTION_DAYS", 7));
  const newsCutoff = daysAgo(numberEnv("NEWS_RETENTION_DAYS", 90));
  const aiLogCutoff = daysAgo(numberEnv("AI_LOG_RETENTION_DAYS", 90));
  const jobCutoff = daysAgo(numberEnv("JOB_RETENTION_DAYS", 30));

  await deleteExpiredCache();

  const [priceSnapshots, newsItems, aiUsageLogs, failedJobs, completedJobs] = await Promise.all([
    prisma.priceSnapshot.deleteMany({ where: { timestamp: { lt: quoteCutoff } } }),
    prisma.newsItem.deleteMany({ where: { publishedAt: { lt: newsCutoff } } }),
    prisma.aiUsageLog.deleteMany({ where: { createdAt: { lt: aiLogCutoff } } }),
    prisma.analysisJob.deleteMany({ where: { status: "failed", completedAt: { lt: jobCutoff } } }),
    prisma.analysisJob.deleteMany({ where: { status: { in: ["completed", "skipped_cached"] }, completedAt: { lt: jobCutoff } } })
  ]);

  return {
    priceSnapshots: priceSnapshots.count,
    newsItems: newsItems.count,
    aiUsageLogs: aiUsageLogs.count,
    failedJobs: failedJobs.count,
    completedJobs: completedJobs.count
  };
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

