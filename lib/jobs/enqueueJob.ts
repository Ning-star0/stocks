import type { Prisma } from "@prisma/client";

import { JOB_STATUS, type JobType } from "@/lib/jobs/jobTypes";
import { prisma } from "@/lib/prisma";

export type EnqueueJobInput = {
  userId: string;
  symbol?: string | null;
  jobType: JobType;
  priority: number;
  inputHash?: string | null;
  maxAttempts?: number;
  payload?: Prisma.InputJsonValue;
  includeCompletedInDedupe?: boolean;
};

export async function enqueueJob(input: EnqueueJobInput) {
  if (input.inputHash) {
    const existing = await prisma.analysisJob.findFirst({
      where: {
        userId: input.userId,
        symbol: input.symbol ?? null,
        jobType: input.jobType,
        inputHash: input.inputHash,
        status: {
          in: input.includeCompletedInDedupe === false
            ? [JOB_STATUS.QUEUED, JOB_STATUS.RUNNING]
            : [JOB_STATUS.QUEUED, JOB_STATUS.RUNNING, JOB_STATUS.COMPLETED, JOB_STATUS.SKIPPED_CACHED]
        }
      },
      orderBy: { createdAt: "desc" }
    });
    if (existing) return existing;
  }

  return prisma.analysisJob.create({
    data: {
      userId: input.userId,
      symbol: input.symbol ?? null,
      jobType: input.jobType,
      priority: input.priority,
      inputHash: input.inputHash ?? null,
      maxAttempts: input.maxAttempts ?? 2,
      payload: input.payload ?? undefined
    }
  });
}
