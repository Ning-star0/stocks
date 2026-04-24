import { NextRequest, NextResponse } from "next/server";

import { apiError, parseProviderError } from "@/lib/errors";
import { symbolSchema } from "@/lib/schemas";
import { getStockDataProvider } from "@/lib/stock-data";

export async function GET(request: NextRequest, context: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol } = await context.params;
    const normalized = symbolSchema.parse(symbol);
    const range = request.nextUrl.searchParams.get("range") ?? "6mo";
    const interval = request.nextUrl.searchParams.get("interval") ?? "1d";
    const candles = await getStockDataProvider()
      .getHistory(normalized, range, interval)
      .catch((error) => {
        throw parseProviderError(error);
      });

    return NextResponse.json({ candles });
  } catch (error) {
    return apiError(error);
  }
}
