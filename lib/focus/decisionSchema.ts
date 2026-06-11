import { z } from "zod";

export const decisionSchema = z.object({
  summary: z.string().min(1),
  recommendedAction: z.enum(["buy", "sell", "mixed", "wait"]),
  totalBudgetToUse: z.coerce.number().min(0).default(0),
  cashReserve: z.coerce.number().min(0).default(0),
  orders: z
    .array(
      z.object({
        symbol: z.string().min(1),
        action: z.enum(["buy", "add", "watch", "avoid"]),
        amount: z.coerce.number().min(0).default(0),
        shares: z.coerce.number().int().min(0).default(0),
        planType: z.enum(["pullback", "breakout", "support", "trend_follow", "add_on_strength", "risk_rebalance"]).optional(),
        triggerPrice: z.coerce.number().positive().optional().nullable(),
        stopLossPrice: z.coerce.number().positive().optional().nullable(),
        takeProfitPrice: z.coerce.number().positive().optional().nullable(),
        maxLossAmount: z.coerce.number().min(0).optional().nullable(),
        riskRewardRatio: z.coerce.number().min(0).optional().nullable(),
        priority: z.coerce.number().int().min(1).max(5).optional(),
        reason: z.string().min(1),
        riskControl: z.string().default(""),
        invalidIf: z.string().default("")
      })
    )
    .default([]),
  sellOrders: z
    .array(
      z.object({
        symbol: z.string().min(1),
        action: z.enum(["sell", "reduce", "watch", "avoid"]),
        amount: z.coerce.number().min(0).default(0),
        shares: z.coerce.number().int().min(0).default(0),
        triggerPrice: z.coerce.number().positive().optional().nullable(),
        stopLossPrice: z.coerce.number().positive().optional().nullable(),
        takeProfitPrice: z.coerce.number().positive().optional().nullable(),
        sellRatioPct: z.coerce.number().min(0).max(100).optional().nullable(),
        priority: z.coerce.number().int().min(1).max(5).optional(),
        reason: z.string().min(1),
        riskControl: z.string().default(""),
        invalidIf: z.string().default("")
      })
    )
    .default([]),
  ranking: z
    .array(
      z.object({
        symbol: z.string().min(1),
        rank: z.coerce.number().int().positive(),
        view: z.string().min(1),
        reason: z.string().min(1)
      })
    )
    .default([]),
  disclaimer: z.string().default("本内容由 AI 生成，仅供研究参考，不构成投资建议。")
});

export type DecisionSchemaValue = z.infer<typeof decisionSchema>;
