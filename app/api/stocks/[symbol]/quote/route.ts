import { NextResponse } from "next/server";

import { apiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { symbolSchema } from "@/lib/schemas";
import { getQuote } from "@/lib/services/quoteService";

export async function GET(_request: Request, context: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol } = await context.params;
    const normalized = symbolSchema.parse(symbol);
    const quote = await getQuote(normalized, { allowStale: true });

    if (quote.raw && quote.price !== null) await prisma.priceSnapshot.create({
      data: {
        symbol: quote.raw.symbol,
        open: quote.raw.open,
        high: quote.raw.high,
        low: quote.raw.low,
        close: quote.raw.close,
        price: quote.raw.price,
        volume: BigInt(quote.raw.volume),
        timestamp: new Date(quote.raw.timestamp)
      }
    });

    return NextResponse.json({ quote });
  } catch (error) {
    return apiError(error);
  }
}
