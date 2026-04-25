import { z } from "zod";

export const symbolSchema = z
  .string()
  .trim()
  .min(1)
  .max(16)
  .regex(/^[A-Za-z0-9.\-_:]+$/, "股票代码包含不支持的字符。")
  .transform((value) => value.toUpperCase());

export const createWatchlistItemSchema = z.object({
  symbol: symbolSchema,
  market: z.string().trim().min(1).max(16).default("US").transform((value) => value.toUpperCase()),
  note: z.string().trim().max(500).optional().nullable(),
  holdingPrice: z.coerce.number().positive().optional().nullable(),
  targetPrice: z.coerce.number().positive().optional().nullable(),
  stopLoss: z.coerce.number().positive().optional().nullable(),
  timeHorizon: z.enum(["day_trade", "swing_trade", "long_term"]).default("swing_trade"),
  riskLevel: z.enum(["low", "medium", "high"]).default("medium")
});

export const updateWatchlistItemSchema = z.object({
  note: z.string().trim().max(500).optional().nullable(),
  holdingPrice: z.coerce.number().positive().optional().nullable(),
  targetPrice: z.coerce.number().positive().optional().nullable(),
  stopLoss: z.coerce.number().positive().optional().nullable(),
  timeHorizon: z.enum(["day_trade", "swing_trade", "long_term"]).optional(),
  riskLevel: z.enum(["low", "medium", "high"]).optional()
});

export const alertRuleSchema = z.object({
  symbol: symbolSchema,
  alertType: z.enum(["price", "rsi", "volume"]),
  operator: z.enum(["gt", "lt"]),
  threshold: z.coerce.number().positive(),
  isActive: z.boolean().optional().default(true)
});

export const newsQuerySchema = z.object({
  symbol: symbolSchema.optional(),
  sector: z.string().trim().min(1).max(80).optional(),
  keyword: z.string().trim().min(1).max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional()
});

export const sectorWatchSchema = z.object({
  sectorName: z.string().trim().min(1).max(80),
  keywords: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
  symbols: z.array(symbolSchema).max(30).default([])
});

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(12).max(256)
});

export const newsAnalysisSchema = z.object({
  summary: z.string().min(1),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  impactLevel: z.enum(["low", "medium", "high"]),
  affectedSymbols: z.array(symbolSchema),
  affectedSectors: z.array(z.string().min(1).max(80)),
  riskNotes: z.array(z.string()),
  whyItMatters: z.string().min(1),
  confidence: z.number().min(0).max(1)
});

const aiActionSchema = z.object({
  action: z.enum(["hold", "watch", "reduce", "consider_entry", "avoid"]),
  reason: z.string().min(1),
  invalidIf: z.string().min(1)
});

const analysisNewsReferenceSchema = z.object({
  title: z.string().min(1),
  source: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  url: z.string().url().nullable().optional(),
  sentiment: z.string().nullable().optional(),
  impactLevel: z.string().nullable().optional()
});

const webSearchResultSchema = z.object({
  title: z.string().min(1),
  source: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  url: z.string().url().nullable().optional(),
  summary: z.string().nullable().optional()
});

export const aiAnalysisSchema = z.object({
  trend: z.enum(["bullish", "neutral", "bearish"]),
  confidence: z.number().min(0).max(1),
  summary: z.string().min(1),
  analysisAsOf: z.string().optional(),
  dataScope: z
    .object({
      quoteTime: z.string().nullable().optional(),
      historyRange: z.string().optional(),
      historyInterval: z.string().optional(),
      historyFrom: z.string().nullable().optional(),
      historyTo: z.string().nullable().optional(),
      historyCandles: z.number().int().nonnegative().optional(),
      newsWindow: z.string().optional(),
      newsCount: z.number().int().nonnegative().optional(),
      webSearchStatus: z.string().optional()
    })
    .optional(),
  isFallback: z.boolean().optional(),
  fallbackReason: z.string().optional(),
  keyLevels: z.object({
    support: z.array(z.number()),
    resistance: z.array(z.number())
  }),
  riskFactors: z.array(z.string()),
  newsSummary: z.string().default("暂无已分析的相关新闻。"),
  newsSentiment: z.enum(["positive", "neutral", "negative", "mixed"]).default("neutral"),
  webSearchSummary: z.string().optional().default(""),
  newsReferences: z.array(analysisNewsReferenceSchema).optional().default([]),
  webSearchResults: z.array(webSearchResultSchema).optional().default([]),
  catalystEvents: z.array(z.string()).default([]),
  macroRisks: z.array(z.string()).default([]),
  sectorRisks: z.array(z.string()).default([]),
  possibleActions: z.array(aiActionSchema).min(1),
  disclaimer: z.string().min(1)
});

export type CreateWatchlistItemInput = z.infer<typeof createWatchlistItemSchema>;
export type UpdateWatchlistItemInput = z.infer<typeof updateWatchlistItemSchema>;
export type AlertRuleInput = z.infer<typeof alertRuleSchema>;
export type SectorWatchInput = z.infer<typeof sectorWatchSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
