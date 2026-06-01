import { NextRequest, NextResponse } from "next/server";

import { logApiUsage } from "@/lib/apiUsage";
import { apiError, parseProviderError } from "@/lib/errors";
import { symbolSchema } from "@/lib/schemas";
import { getStockDataProvider } from "@/lib/stock-data";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol } = await context.params;
    const normalized = symbolSchema.parse(symbol);
    const range = request.nextUrl.searchParams.get("range") ?? "6mo";
    const interval = request.nextUrl.searchParams.get("interval") ?? "1d";
    const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
    const candles = await getStockDataProvider()
      .getHistory(normalized, range, interval, { forceRefresh })
      .catch((error) => {
        void logApiUsage({
          provider: process.env.STOCK_DATA_PROVIDER || "mock",
          apiName: "history",
          status: "failed",
          metadata: { symbol: normalized, range, interval, forceRefresh }
        });
        throw parseProviderError(error);
      });
    await logApiUsage({
      provider: process.env.STOCK_DATA_PROVIDER || "mock",
      apiName: "history",
      status: "success",
      metadata: { symbol: normalized, range, interval, forceRefresh }
    });

    return NextResponse.json(
      { candles, fetchedAt: new Date().toISOString() },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0"
        }
      }
    );
  } catch (error) {
    return apiError(error);
  }
}
