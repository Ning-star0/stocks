import { enqueueJob } from "@/lib/jobs/enqueueJob";
import { JOB_PRIORITY, JOB_TYPES } from "@/lib/jobs/jobTypes";
import { prisma } from "@/lib/prisma";

// 每分钟由 worker 调用一次，检查是否有到时间的关注板块任务
export async function checkFocusSchedules() {
  try {
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    const groups = await prisma.focusGroup.findMany({
      where: { symbols: { isEmpty: false } }
    });

    for (const group of groups) {
      // 新闻抓取
      if (group.newsFetchTime === timeStr && !sameDay(group.lastNewsFetch, now)) {
        for (const symbol of group.symbols) {
          await enqueueJob({
            userId: group.userId,
            symbol,
            jobType: JOB_TYPES.STOCK_ANALYSIS,
            priority: JOB_PRIORITY.SCHEDULED_REFRESH,
            payload: { reason: `关注板块每日新闻抓取 ${timeStr}`, refreshNews: true }
          });
        }
        await prisma.focusGroup.update({
          where: { id: group.id },
          data: { lastNewsFetch: now }
        });
      }

      // AI 分析时间点
      if (group.analysisTimes.includes(timeStr) && !sameDay(group.lastAnalysis, now)) {
        for (const symbol of group.symbols) {
          await enqueueJob({
            userId: group.userId,
            symbol,
            jobType: JOB_TYPES.STOCK_ANALYSIS,
            priority: JOB_PRIORITY.SCHEDULED_REFRESH,
            payload: { reason: `关注板块定时分析 ${timeStr}` }
          });
        }
        await prisma.focusGroup.update({
          where: { id: group.id },
          data: { lastAnalysis: now }
        });
      }
    }
  } catch {
    // 调度检查失败不影响 worker 主循环
  }
}

function sameDay(a: Date | null, b: Date) {
  if (!a) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
