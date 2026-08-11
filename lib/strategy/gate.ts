import { getCache, setCache } from "@/lib/cache";
import { focusSymbolBase } from "@/lib/focus/symbols";
import { prisma } from "@/lib/prisma";
import { getStockDataProvider } from "@/lib/stock-data";
import { MARKET_DATA_REVISION } from "@/lib/stock-data/corporateActions";
import type { BacktestPresetId, StrategyBacktestComparison } from "@/lib/strategy/backtest";
import { compareBacktestPresets } from "@/lib/strategy/backtest";

const STRATEGY_GATE_TTL_SECONDS = 12 * 60 * 60;
export const STRATEGY_GATE_POLICY_VERSION = "small-sample-soft-gate-v2";

export type StrategyHealthGate = {
  symbol: string;
  capital: number;
  strategyHealth: StrategyBacktestComparison["strategyHealth"];
  entryPermission: StrategyBacktestComparison["entryPermission"];
  recommendedPreset: BacktestPresetId;
  validationReturnPct: number | null;
  validationMaxDrawdownPct: number | null;
  validationClosedTrades: number;
  reason: string;
  generatedAt: string;
  validUntil: string;
  policyVersion: string;
  marketDataRevision: string;
};

export async function saveStrategyHealthGates(input: {
  userId: string;
  capital: number;
  comparisons: StrategyBacktestComparison[];
}) {
  await Promise.all(input.comparisons.map((comparison) => {
    const validation = comparison.walkForward?.selectedValidation ?? null;
    const gate: StrategyHealthGate = {
      symbol: comparison.symbol,
      capital: input.capital,
      strategyHealth: comparison.strategyHealth,
      entryPermission: comparison.entryPermission,
      recommendedPreset: comparison.recommendedPreset,
      validationReturnPct: validation?.netReturnPct ?? null,
      validationMaxDrawdownPct: validation?.maxDrawdownPct ?? null,
      validationClosedTrades: validation?.closedTrades ?? 0,
      reason: comparison.healthReason,
      generatedAt: comparison.generatedAt,
      validUntil: new Date(Date.now() + STRATEGY_GATE_TTL_SECONDS * 1000).toISOString(),
      policyVersion: STRATEGY_GATE_POLICY_VERSION,
      marketDataRevision: MARKET_DATA_REVISION
    };
    return setCache(strategyGateKey(input.userId, comparison.symbol), gate, STRATEGY_GATE_TTL_SECONDS);
  }));
}

export async function loadStrategyHealthGates(input: {
  userId: string;
  capital: number;
  symbols: string[];
}) {
  const pairs = await Promise.all(input.symbols.map(async (symbol) => {
    const gate = await getCache<StrategyHealthGate>(strategyGateKey(input.userId, symbol));
    if (!gate || !gateIsCurrent(gate) || !capitalMatches(gate.capital, input.capital)) return [focusSymbolBase(symbol), null] as const;
    return [focusSymbolBase(symbol), gate] as const;
  }));
  return new Map(pairs.filter((pair): pair is readonly [string, StrategyHealthGate] => pair[1] !== null));
}

export async function ensureStrategyHealthGatesForFocus(userId: string) {
  const focus = await prisma.focusGroup.findUnique({
    where: { userId },
    select: { capital: true, symbols: true }
  });
  const capital = Number(focus?.capital);
  const symbols = [...new Set((focus?.symbols ?? []).map((symbol) => symbol.toUpperCase()))];
  if (!Number.isFinite(capital) || capital <= 0 || !symbols.length) return new Map<string, StrategyHealthGate>();

  const existing = await loadStrategyHealthGates({ userId, capital, symbols });
  const missing = symbols.filter((symbol) => !existing.has(focusSymbolBase(symbol)));
  if (!missing.length) return existing;

  const provider = getStockDataProvider();
  const comparisons: StrategyBacktestComparison[] = [];
  for (const symbol of missing) {
    try {
      const candles = await provider.getHistory(symbol, "2y", "1d", { forceRefresh: true });
      comparisons.push(compareBacktestPresets({ symbol, candles, initialCapital: capital, range: "2y" }));
    } catch (error) {
      console.warn("[strategy-health] refresh failed", symbol, error instanceof Error ? error.message : String(error));
    }
  }
  if (comparisons.length) await saveStrategyHealthGates({ userId, capital, comparisons });
  return loadStrategyHealthGates({ userId, capital, symbols });
}

function strategyGateKey(userId: string, symbol: string) {
  return `strategy_health:v2:${MARKET_DATA_REVISION}:${STRATEGY_GATE_POLICY_VERSION}:${userId}:${focusSymbolBase(symbol)}`;
}

function gateIsCurrent(gate: StrategyHealthGate) {
  if (gate.policyVersion !== STRATEGY_GATE_POLICY_VERSION || gate.marketDataRevision !== MARKET_DATA_REVISION) return false;
  const validUntil = Date.parse(gate.validUntil);
  return Number.isFinite(validUntil) && validUntil > Date.now();
}

function capitalMatches(gateCapital: number, currentCapital: number) {
  return Math.abs(gateCapital - currentCapital) <= Math.max(1, currentCapital * 0.02);
}
