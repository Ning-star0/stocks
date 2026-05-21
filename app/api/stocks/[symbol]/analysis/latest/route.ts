import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/currentUser";
import { apiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { symbolSchema } from "@/lib/schemas";

export async function GET(_request: Request, context: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol } = await context.params;
    const normalized = symbolSchema.parse(symbol);
    const user = await getCurrentUser();
    const symbolVariants = [normalized, ...expandChinaSymbol(normalized)];
    const analysis = await prisma.aiAnalysis.findFirst({
      where: {
        userId: user.id,
        symbol: { in: symbolVariants }
      },
      orderBy: { createdAt: "desc" }
    });

    return NextResponse.json({ analysis });
  } catch (error) {
    return apiError(error);
  }
}

function expandChinaSymbol(normalized: string) {
  const base = normalized.replace(/\.(SH|SZ|BJ)$/, "");
  if (!/^\d{6}$/.test(base)) return [];
  return [base, `${base}.SH`, `${base}.SZ`, `${base}.BJ`];
}
