import { NextRequest, NextResponse } from "next/server";

import { apiError, parseProviderError } from "@/lib/errors";
import { calculateIndicators } from "@/lib/indicators";
import { prisma } from "@/lib/prisma";
import { symbolSchema } from "@/lib/schemas";
import { getStockDataProvider } from "@/lib/stock-data";

export async function GET(request: NextRequest, context: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol } = await context.params;
    const normalized = symbolSchema.parse(symbol);
    const force = request.nextUrl.searchParams.get("refresh") === "1";
    const latest = await prisma.technicalIndicator.findFirst({
      where: { symbol: normalized },
      orderBy: { timestamp: "desc" }
    });

    if (latest && !force && Date.now() - latest.timestamp.getTime() < 10 * 60_000) {
      return NextResponse.json({
        indicators: {
          symbol: latest.symbol,
          rsi14: latest.rsi14 ? Number(latest.rsi14) : null,
          macd: latest.macd ? Number(latest.macd) : null,
          macdSignal: latest.macdSignal ? Number(latest.macdSignal) : null,
          sma20: latest.sma20 ? Number(latest.sma20) : null,
          sma50: latest.sma50 ? Number(latest.sma50) : null,
          sma200: latest.sma200 ? Number(latest.sma200) : null,
          ema20: latest.ema20 ? Number(latest.ema20) : null,
          bollingerUpper: latest.bollingerUpper ? Number(latest.bollingerUpper) : null,
          bollingerMiddle: latest.bollingerMiddle ? Number(latest.bollingerMiddle) : null,
          bollingerLower: latest.bollingerLower ? Number(latest.bollingerLower) : null,
          timestamp: latest.timestamp.toISOString()
        }
      });
    }

    const history = await getStockDataProvider()
      .getHistory(normalized, "1y", "1d")
      .catch((error) => {
        throw parseProviderError(error);
      });
    const indicators = calculateIndicators(normalized, history);

    await prisma.technicalIndicator.create({
      data: {
        symbol: normalized,
        rsi14: indicators.rsi14,
        macd: indicators.macd,
        macdSignal: indicators.macdSignal,
        sma20: indicators.sma20,
        sma50: indicators.sma50,
        sma200: indicators.sma200,
        ema20: indicators.ema20,
        bollingerUpper: indicators.bollingerUpper,
        bollingerMiddle: indicators.bollingerMiddle,
        bollingerLower: indicators.bollingerLower,
        timestamp: new Date(indicators.timestamp)
      }
    });

    return NextResponse.json({ indicators });
  } catch (error) {
    return apiError(error);
  }
}
