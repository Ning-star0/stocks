import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/currentUser";
import { apiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { readRequestJson } from "@/lib/serverApi";
import { symbolSchema } from "@/lib/schemas";
import { stockSymbolVariants } from "@/lib/symbols";

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
  const variants = [...new Set(symbols.flatMap(stockSymbolVariants))];
  const rows = await prisma.aiAnalysis.findMany({
    where: { userId, symbol: { in: variants } },
    orderBy: { createdAt: "desc" },
    take: Math.max(20, symbols.length * 5)
  });

  for (const symbol of symbols) {
    const match = rows.find((row) => stockSymbolVariants(symbol).includes(row.symbol));
    if (!match) continue;
    output[symbol] = {
      id: match.id,
      symbol: match.symbol,
      createdAt: match.createdAt,
      outputJson: match.outputJson
    };
  }
  return output;
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
