import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/errors";
import { symbolSchema } from "@/lib/schemas";
import { getQuotesBatch } from "@/lib/services/quoteService";

const requestSchema = z.object({
  symbols: z.array(symbolSchema).min(1).max(numberEnv("MAX_BATCH_SYMBOLS", 50))
});

export async function POST(request: NextRequest) {
  try {
    const body = requestSchema.parse(await request.json());
    const quotes = await getQuotesBatch(body.symbols, { allowStale: true });
    const cacheStatus = Object.fromEntries(Object.entries(quotes).map(([symbol, quote]) => [symbol, quote.status]));

    return NextResponse.json({ quotes, cacheStatus });
  } catch (error) {
    return apiError(error);
  }
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
