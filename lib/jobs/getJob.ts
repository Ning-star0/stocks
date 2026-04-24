import { prisma } from "@/lib/prisma";

export async function getJob(id: string, userId?: string) {
  return prisma.analysisJob.findFirst({
    where: {
      id,
      ...(userId ? { userId } : {})
    }
  });
}

