import type { AiAnalysisResult } from "@/lib/types";
import { toNumber } from "@/lib/utils";

export type PositionContext = {
  isHolding?: boolean | null;
  holdingPrice?: number | string | null;
  positionOpenedAt?: string | Date | null;
};

export function hasUserPosition(context?: PositionContext | null) {
  if (typeof context?.isHolding === "boolean") return context.isHolding;
  const holdingPrice = toNumber(context?.holdingPrice);
  return Boolean((holdingPrice && holdingPrice > 0) || context?.positionOpenedAt);
}

export function getPrimaryAdvice(analysis: AiAnalysisResult | null | undefined, context?: PositionContext | null) {
  const isHolding = hasUserPosition(context);
  const advice = isHolding ? analysis?.holdAdvice : analysis?.entryAdvice;
  const fallbackAdvice = isHolding ? analysis?.entryAdvice : analysis?.holdAdvice;
  const action = advice?.action || fallbackAdvice?.action || "";
  const reason = advice?.reason || fallbackAdvice?.reason || analysis?.summary || "暂无 AI 建议。";

  return {
    isHolding,
    title: isHolding ? "持仓/增持观察" : "交易情景观察",
    statusLabel: isHolding ? "已持仓" : "未持仓",
    action,
    reason,
    advice,
    fallbackAdvice
  };
}
