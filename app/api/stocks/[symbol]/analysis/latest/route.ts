import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/currentUser";
import { apiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { symbolSchema } from "@/lib/schemas";
import { stockSymbolVariants } from "@/lib/symbols";

export async function GET(_request: Request, context: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol } = await context.params;
    const normalized = symbolSchema.parse(symbol);
    const user = await getCurrentUser();
    const analysis = await prisma.aiAnalysis.findFirst({
      where: {
        userId: user.id,
        symbol: { in: stockSymbolVariants(normalized) }
      },
      orderBy: { createdAt: "desc" }
    });

    return NextResponse.json({ analysis });
  } catch (error) {
    return apiError(error);
  }
}
