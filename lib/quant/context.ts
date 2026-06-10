import { validNumber } from "@/lib/quant/math";
import type { QuantSectorBias, QuantStrategyContext } from "@/lib/quant/strategyTypes";

export function normalizeStrategyContext(value: QuantStrategyContext | null | undefined): QuantStrategyContext {
  if (!value) {
    return {
      marketRegime: "neutral",
      buyThresholdDelta: 0,
      sellThresholdDelta: 0,
      maxPositionPct: 30,
      allowAdd: true,
      avoidChasing: true,
      notes: [],
      sectorBiases: {}
    };
  }
  return {
    marketRegime: value.marketRegime ?? "neutral",
    buyThresholdDelta: validNumber(value.buyThresholdDelta) ?? 0,
    sellThresholdDelta: validNumber(value.sellThresholdDelta) ?? 0,
    maxPositionPct: validNumber(value.maxPositionPct) ?? 30,
    allowAdd: value.allowAdd !== false,
    avoidChasing: value.avoidChasing !== false,
    notes: Array.isArray(value.notes) ? value.notes.filter((item): item is string => typeof item === "string").slice(0, 6) : [],
    sectorBiases: value.sectorBiases ?? {}
  };
}

export function resolveSectorBias(context: QuantStrategyContext, sectorKey?: string | null): QuantSectorBias {
  if (!sectorKey) return "uncertain";
  return context.sectorBiases?.[sectorKey] ?? "uncertain";
}
