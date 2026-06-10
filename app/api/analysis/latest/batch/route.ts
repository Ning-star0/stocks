import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { Prisma as PrismaSql } from "@prisma/client";
import { z } from "zod";

import { getCurrentUser } from "@/lib/currentUser";
import { apiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { readRequestJson } from "@/lib/serverApi";
import { symbolSchema } from "@/lib/schemas";

const requestSchema = z.object({
  symbols: z.array(symbolSchema).min(1).max(numberEnv("MAX_BATCH_SYMBOLS", 50))
});

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const body = requestSchema.parse(await readRequestJson(request));
    const symbols = [...new Set(body.symbols)];
    const analyses = await loadLatestAnalyses(user.id, symbols);

    return NextResponse.json({ analyses });
  } catch (error) {
    return apiError(error);
  }
}

async function loadLatestAnalyses(userId: string, symbols: string[]) {
  const output: Record<string, unknown> = Object.fromEntries(symbols.map((symbol) => [symbol, null]));
  if (!symbols.length) return output;
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      symbol: string;
      createdAt: Date;
      outputJson: Prisma.JsonValue;
    }>
  >(PrismaSql.sql`
    SELECT DISTINCT ON ("symbol") "id", "symbol", "createdAt", "outputJson"
    FROM "AiAnalysis"
    WHERE "userId" = ${userId}
      AND "symbol" IN (${PrismaSql.join(symbols)})
    ORDER BY "symbol", "createdAt" DESC
  `);

  for (const row of rows) {
    output[row.symbol] = {
      id: row.id,
      symbol: row.symbol,
      createdAt: row.createdAt,
      outputJson: row.outputJson
    };
  }
  return output;
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
