import type { AnalyzeStockInput } from "@/lib/ai/stockAnalysisTypes";
import type { AiModelTier } from "@/lib/ai/config";

export const AI_MODEL_ROUTING_POLICY_VERSION = "cost-aware-routing-v1";

export type StockAnalysisModelRoute = {
  policyVersion: typeof AI_MODEL_ROUTING_POLICY_VERSION;
  tier: AiModelTier;
  reason: "existing_position_review" | "research_default_flash";
};

/**
 * Model choice must depend only on structured server-side facts. AI wording,
 * confidence and trend are deliberately unavailable here and cannot upgrade a
 * request to Pro or change a trading state.
 */
export function routeStockAnalysisModel(input: AnalyzeStockInput): StockAnalysisModelRoute {
  const userContext = asRecord(input.userContext);
  const isHolding = input.evidencePackage?.decisionMode === "position_management"
    || userContext.isHolding === true
    || positiveNumber(userContext.holdingShares) !== null;

  if (isHolding) {
    return {
      policyVersion: AI_MODEL_ROUTING_POLICY_VERSION,
      tier: "flagship",
      reason: "existing_position_review"
    };
  }

  return {
    policyVersion: AI_MODEL_ROUTING_POLICY_VERSION,
    tier: "standard",
    reason: "research_default_flash"
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}
