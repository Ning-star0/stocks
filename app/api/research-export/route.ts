import { NextRequest } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/currentUser";
import { apiError, AppError } from "@/lib/errors";
import { focusSymbolBase, focusSymbolVariants } from "@/lib/focus/symbols";
import { prisma } from "@/lib/prisma";
import { buildChatGptResearchBundle } from "@/lib/research/package";
import { listResearchExports, readResearchExport, saveResearchBundle } from "@/lib/research/storage";
import type { ResearchExportOptions, ResearchExportResult } from "@/lib/research/types";
import { readRequestJson } from "@/lib/serverApi";
import { getQuotesBatch } from "@/lib/services/quoteService";
import { saveStrategyHealthGates } from "@/lib/strategy/gate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = z.object({
  symbols: z.array(z.string().trim().min(1).max(20).transform((value) => value.toUpperCase())).min(1).max(8),
  range: z.enum(["1mo", "3mo", "6mo", "1y", "2y"]).default("1y"),
  interval: z.enum(["1d", "60m"]).default("1d"),
  newsDays: z.coerce.number().int().min(1).max(90).default(30),
  includeForecast: z.boolean().default(true)
});

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const file = request.nextUrl.searchParams.get("file");
    if (file) {
      try {
        const stored = await readResearchExport(file);
        return new Response(stored.content, {
          headers: {
            "Content-Type": stored.contentType,
            "Content-Length": String(stored.size),
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file)}`,
            "Cache-Control": "private, no-store"
          }
        });
      } catch {
        throw new AppError("SYMBOL_NOT_FOUND", "研究包文件不存在或已清理。");
      }
    }

    const [items, focus, files] = await Promise.all([
      prisma.watchlistItem.findMany({
        where: { watchlist: { userId: user.id } },
        select: { symbol: true, isHolding: true },
        orderBy: { createdAt: "asc" }
      }),
      prisma.focusGroup.findUnique({ where: { userId: user.id }, select: { symbols: true } }),
      listResearchExports()
    ]);
    const symbols = [...new Set(items.map((item) => item.symbol.toUpperCase()))];
    const quotes = symbols.length ? await getQuotesBatch(symbols, { cacheOnly: true, allowStale: true }) : {};
    const focusedBases = new Set((focus?.symbols ?? []).map(focusSymbolBase));
    const defaultSymbols = symbols.filter((symbol) => focusedBases.has(focusSymbolBase(symbol))).slice(0, 8);
    const response: ResearchExportOptions = {
      instruments: items.map((item) => {
        const quote = quotes[item.symbol] ?? quotes[focusSymbolVariants(item.symbol).find((variant) => quotes[variant]) ?? item.symbol];
        return {
          symbol: item.symbol,
          name: quote?.name ?? null,
          isHolding: item.isHolding,
          isFocused: focusedBases.has(focusSymbolBase(item.symbol))
        };
      }),
      defaults: {
        symbols: defaultSymbols.length ? defaultSymbols : symbols.slice(0, Math.min(5, symbols.length)),
        range: "1y",
        interval: "1d",
        newsDays: 30,
        includeForecast: true
      },
      files: files.slice(0, 12),
      storageReady: true
    };
    return Response.json(response, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const input = requestSchema.parse(await readRequestJson(request));
    if (input.interval === "60m" && !["1mo", "3mo"].includes(input.range)) {
      throw new AppError("BAD_REQUEST", "60 分钟 K 线最多导出近 3 个月，请缩短范围或改用日线。");
    }
    const allowedItems = await prisma.watchlistItem.findMany({
      where: { watchlist: { userId: user.id } },
      select: { symbol: true }
    });
    const allowedBases = new Set(allowedItems.map((item) => focusSymbolBase(item.symbol)));
    const disallowed = input.symbols.filter((symbol) => !allowedBases.has(focusSymbolBase(symbol)));
    if (disallowed.length) throw new AppError("BAD_REQUEST", `研究包只能选择自选股：${disallowed.join("、")}`);

    const bundle = await buildChatGptResearchBundle({ userId: user.id, ...input });
    const bundleCapital = Number(bundle.portfolio.capital);
    if (Number.isFinite(bundleCapital) && bundleCapital > 0) {
      await saveStrategyHealthGates({ userId: user.id, capital: bundleCapital, comparisons: bundle.strategyBacktests });
    }
    const files = await saveResearchBundle(bundle);
    const result: ResearchExportResult = {
      generatedAt: bundle.generatedAt,
      symbols: bundle.symbols.map((item) => ({
        symbol: item.symbol,
        name: item.name,
        candles: item.candles.length,
        news: item.news.length,
        historyError: item.historyError
      })),
      forecast: bundle.forecast,
      strategyBacktests: bundle.strategyBacktests.map((comparison) => {
        const recommended = comparison.walkForward?.selectedValidation ?? comparison.results.find((item) => item.preset.id === comparison.recommendedPreset) ?? comparison.results[0];
        return {
          symbol: comparison.symbol,
          recommendedPreset: recommended?.preset.name ?? "当前策略",
          closedTrades: recommended?.closedTrades ?? 0,
          netReturnPct: recommended?.netReturnPct ?? 0,
          maxDrawdownPct: recommended?.maxDrawdownPct ?? 0
        };
      }),
      strategyBacktestPortfolio: bundle.strategyBacktestPortfolio,
      files
    };
    return Response.json(result);
  } catch (error) {
    return apiError(error);
  }
}
