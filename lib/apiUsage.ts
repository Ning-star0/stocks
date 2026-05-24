import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

type LogApiUsageInput = {
  userId?: string | null;
  provider: string;
  apiName: string;
  status?: "success" | "failed" | "cache_hit";
  unit?: string;
  amount?: number;
  metadata?: Prisma.InputJsonValue;
};

export async function logApiUsage(input: LogApiUsageInput) {
  try {
    await prisma.apiUsageLog.create({
      data: {
        userId: input.userId ?? null,
        provider: input.provider,
        apiName: input.apiName,
        status: input.status ?? "success",
        unit: input.unit ?? "request",
        amount: Math.max(1, Math.floor(input.amount ?? 1)),
        metadata: input.metadata ?? undefined
      }
    });
  } catch {
    // 用量统计不能影响主业务接口。
  }
}

export function readQuota(name: string) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : null;
}
