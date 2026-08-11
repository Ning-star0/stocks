import { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/currentUser";
import { apiError, AppError } from "@/lib/errors";
import { buildPortfolioSnapshot } from "@/lib/focus/portfolio";
import { prisma } from "@/lib/prisma";
import { readRequestJson } from "@/lib/serverApi";
import { getQuotesBatch } from "@/lib/services/quoteService";
import { displaySymbolBase } from "@/lib/trading/display";
import {
  createManualTradeAndRebuild,
  deleteTradeExecutionAndRebuild,
  parsePositiveNumber,
  parseTradeSide,
  reconcileAndRebuildUserPositions
} from "@/lib/trades/ledger";
import { buildTradePerformance } from "@/lib/trades/performance";
import { buildPortfolioRiskBudget } from "@/lib/trading/riskBudget";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const searchParams = request.nextUrl.searchParams;
    const limitParam = searchParams.get("limit");
    const limit = limitParam === "all" ? undefined : Math.min(Math.max(Number(limitParam || 100), 1), 500);
    await prisma.$transaction((tx) => reconcileAndRebuildUserPositions(tx, user.id));
    const [allExecutions, focus, watchlistItems] = await Promise.all([
      prisma.tradeExecution.findMany({
        where: { userId: user.id },
        orderBy: [{ executedAt: "desc" }, { createdAt: "desc" }]
      }),
      prisma.focusGroup.findUnique({ where: { userId: user.id }, select: { capital: true } }),
      prisma.watchlistItem.findMany({
        where: { watchlist: { userId: user.id } },
        select: { symbol: true, isHolding: true, holdingPrice: true, holdingShares: true, stopLoss: true, riskLevel: true }
      })
    ]);
    const executions = limit ? allExecutions.slice(0, limit) : allExecutions;
    const symbols = [...new Set([...allExecutions.map((execution) => execution.symbol.toUpperCase()), ...watchlistItems.map((item) => item.symbol.toUpperCase())])];
    const quotes = symbols.length ? await getQuotesBatch(symbols, { cacheOnly: true, allowStale: true }) : {};
    const quoteNameByBase = new Map(
      Object.values(quotes)
        .filter((quote) => quote.name)
        .map((quote) => [displaySymbolBase(quote.symbol), quote.name] as const)
    );
    const capital = Number(focus?.capital ?? 0);
    const portfolio = buildPortfolioSnapshot({
      capital,
      portfolioItems: watchlistItems.filter((item) => item.isHolding),
      tradeExecutions: allExecutions,
      quotes
    });
    const serializedExecutions = executions.map((execution) => ({
      id: execution.id,
      symbol: execution.symbol,
      name: quoteNameByBase.get(displaySymbolBase(execution.symbol)) ?? null,
      side: execution.side,
      price: Number(execution.price),
      shares: Number(execution.shares),
      amount: Number(execution.amount),
      fee: Number(execution.fee),
      netCashChange: Number(execution.netCashChange),
      realizedPnl: execution.realizedPnl === null ? null : Number(execution.realizedPnl),
      executedAt: execution.executedAt.toISOString(),
      note: execution.note
    }));
    const performanceExecutions = allExecutions.map((execution) => ({
      id: execution.id,
      symbol: execution.symbol,
      side: execution.side,
      amount: Number(execution.amount),
      fee: Number(execution.fee),
      realizedPnl: execution.realizedPnl === null ? null : Number(execution.realizedPnl),
      executedAt: execution.executedAt
    }));
    const performance = buildTradePerformance(performanceExecutions, capital);
    const riskBudget = buildPortfolioRiskBudget({
      capital,
      totalAssets: portfolio.totalAssets,
      tradePerformance: performance,
      positions: watchlistItems
        .filter((item) => item.isHolding)
        .map((item) => {
          const quote = quotes[item.symbol] ?? quotes[symbols.find((symbol) => displaySymbolBase(symbol) === displaySymbolBase(item.symbol)) ?? item.symbol];
          return {
            symbol: item.symbol,
            shares: item.holdingShares === null ? null : Number(item.holdingShares),
            currentPrice: quote?.price ?? null,
            holdingPrice: item.holdingPrice === null ? null : Number(item.holdingPrice),
            stopLossPrice: item.stopLoss === null ? null : Number(item.stopLoss),
            riskLevel: item.riskLevel
          };
        })
    });

    return Response.json({
      executions: serializedExecutions,
      instruments: watchlistItems.map((item) => {
        const quote = quotes[item.symbol] ?? quotes[symbols.find((symbol) => displaySymbolBase(symbol) === displaySymbolBase(item.symbol)) ?? item.symbol];
        return {
          symbol: item.symbol,
          name: quoteNameByBase.get(displaySymbolBase(item.symbol)) ?? null,
          price: quote?.price ?? null,
          isHolding: item.isHolding,
          holdingShares: item.holdingShares === null ? null : Number(item.holdingShares)
        };
      }),
      portfolio: {
        capital,
        ...portfolio,
        totalReturnPct: capital > 0 ? Number((((portfolio.totalAssets - capital) / capital) * 100).toFixed(2)) : null
      },
      performance,
      riskBudget
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const body = await readRequestJson<Record<string, unknown>>(request);
    const symbol = String(body.symbol ?? "").trim().toUpperCase();
    const side = parseTradeSide(body.side);
    const price = parsePositiveNumber(body.price);
    const shares = parsePositiveNumber(body.shares);
    const executedAt = parseExecutedAt(body.executedAt);
    const note = String(body.note ?? "").trim() || null;

    if (!symbol) throw new AppError("BAD_REQUEST", "请选择交易标的。");
    if (!side) throw new AppError("BAD_REQUEST", "请选择买入或卖出。");
    if (!price) throw new AppError("BAD_REQUEST", "请输入有效成交价。");
    if (!shares) throw new AppError("BAD_REQUEST", "请输入有效成交数量。");

    const result = await prisma.$transaction(async (tx) => {
      return createManualTradeAndRebuild(tx, {
        userId: user.id,
        symbol,
        side,
        price,
        shares,
        executedAt,
        note
      });
    });

    return Response.json({
      ok: true,
      execution: {
        id: result.execution.id,
        symbol: result.execution.symbol,
        side: result.execution.side,
        price: Number(result.execution.price),
        shares: Number(result.execution.shares),
        amount: Number(result.execution.amount),
        fee: Number(result.execution.fee),
        netCashChange: Number(result.execution.netCashChange),
        realizedPnl: result.execution.realizedPnl === null ? null : Number(result.execution.realizedPnl),
        executedAt: result.execution.executedAt.toISOString(),
        note: result.execution.note
      },
      position: result.position
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new AppError("BAD_REQUEST", "缺少交易记录 ID。");

    const result = await prisma.$transaction(async (tx) => {
      return deleteTradeExecutionAndRebuild(tx, { userId: user.id, executionId: id });
    });

    return Response.json({ ok: true, ...result });
  } catch (error) {
    return apiError(error);
  }
}

function parseExecutedAt(value: unknown) {
  if (!value) return new Date();
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new AppError("BAD_REQUEST", "交易时间格式无效。");
  return date;
}
