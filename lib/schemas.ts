import { z } from "zod";

const optionalDateSchema = z.preprocess(
  (value) => (value === "" || value === null ? null : value),
  z.coerce.date().nullable().optional()
);

const timeOfDaySchema = z
  .string()
  .trim()
  .regex(/^\d{1,2}:\d{2}$/, "时间格式应为 HH:mm。")
  .transform((value, ctx) => {
    const [hourText, minuteText] = value.split(":");
    const hour = Number(hourText);
    const minute = Number(minuteText);
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "时间必须在 00:00 到 23:59 之间。"
      });
      return z.NEVER;
    }
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  });

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
  isHolding: z.boolean().optional(),
  holdingPrice: z.coerce.number().positive().optional().nullable(),
  holdingShares: z.coerce.number().positive().optional().nullable(),
  targetPrice: z.coerce.number().positive().optional().nullable(),
  stopLoss: z.coerce.number().positive().optional().nullable(),
  positionOpenedAt: optionalDateSchema,
  timeHorizon: z.enum(["day_trade", "swing_trade", "long_term"]).default("swing_trade"),
  riskLevel: z.enum(["low", "medium", "high"]).default("medium")
});

export const updateWatchlistItemSchema = z.object({
  note: z.string().trim().max(500).optional().nullable(),
  isHolding: z.boolean().optional(),
  holdingPrice: z.coerce.number().positive().optional().nullable(),
  holdingShares: z.coerce.number().positive().optional().nullable(),
  targetPrice: z.coerce.number().positive().optional().nullable(),
  stopLoss: z.coerce.number().positive().optional().nullable(),
  positionOpenedAt: optionalDateSchema,
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

export const focusGroupSchema = z.object({
  name: z.string().trim().min(1).max(40).default("今日关注"),
  symbols: z.array(symbolSchema).min(1).max(30),
  capital: z.coerce.number().positive().nullable().optional(),
  newsFetchTime: timeOfDaySchema.default("09:30"),
  analysisTimes: z.array(timeOfDaySchema).max(12).default([])
}).transform((value) => ({
  ...value,
  symbols: [...new Set(value.symbols)],
  analysisTimes: [...new Set(value.analysisTimes)].sort()
}));

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
  confidence: z.number().min(0).max(1),
  isFallback: z.boolean().default(false),
  fallbackReason: z.string().nullable().default(null)
});

const aiActionSchema = z.object({
  action: z.enum(["hold", "watch", "reduce", "consider_entry", "avoid"]),
  reason: z.string().min(1),
  timing: z.string().optional().default(""),
  triggerCondition: z.string().optional().default(""),
  entryZone: z.string().optional().default(""),
  stopLossPlan: z.string().optional().default(""),
  takeProfitPlan: z.string().optional().default(""),
  positionSizing: z.string().optional().default(""),
  followUpCheck: z.string().optional().default(""),
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

const holdAdviceSchema = z.object({
  action: z.string().min(1),
  reason: z.string().min(1),
  stopLoss: z.string().optional().default(""),
  takeProfit: z.string().optional().default(""),
  positionManagement: z.string().optional().default(""),
  keyMonitorPoints: z.string().optional().default(""),
  invalidIf: z.string().min(1)
});

const entryAdviceSchema = z.object({
  action: z.string().min(1),
  reason: z.string().min(1),
  entryZone: z.string().optional().default(""),
  timing: z.string().optional().default(""),
  triggerCondition: z.string().optional().default(""),
  firstPositionSize: z.string().optional().default(""),
  stopLoss: z.string().optional().default(""),
  takeProfit: z.string().optional().default(""),
  invalidIf: z.string().min(1)
});

const analysisTradePlanLegSchema = z.object({
  status: z.enum(["conditional", "watch", "blocked", "not_applicable"]),
  action: z.enum(["buy", "add", "reduce", "sell", "watch", "avoid"]),
  triggerPrice: z.number().nullable(),
  stopLossPrice: z.number().nullable(),
  takeProfitPrice: z.number().nullable(),
  shares: z.number().nullable(),
  amount: z.number().nullable(),
  estimatedFee: z.number().nullable(),
  totalCost: z.number().nullable().optional(),
  netProceeds: z.number().nullable().optional(),
  maxLossAmount: z.number().nullable().optional(),
  riskRewardRatio: z.number().nullable().optional(),
  estimatedExitFee: z.number().nullable().optional(),
  roundTripFees: z.number().nullable().optional(),
  feeDragPct: z.number().nullable().optional(),
  breakEvenPrice: z.number().nullable().optional(),
  breakEvenMovePct: z.number().nullable().optional(),
  grossExpectedProfit: z.number().nullable().optional(),
  netExpectedProfit: z.number().nullable().optional(),
  netMaxLossAmount: z.number().nullable().optional(),
  netRiskRewardRatio: z.number().nullable().optional(),
  expectedValueStatus: z.enum(["not_calibrated", "positive", "non_positive"]).optional(),
  calibratedWinProbability: z.number().min(0).max(1).nullable().optional(),
  expectedValue: z.number().nullable().optional(),
  validationSampleSize: z.number().int().nonnegative().nullable().optional(),
  sellRatioPct: z.number().nullable().optional(),
  estimatedPnl: z.number().nullable().optional(),
  reason: z.string().min(1),
  constraints: z.array(z.string())
});

const analysisTradePlanSchema = z.object({
  entry: analysisTradePlanLegSchema,
  exit: analysisTradePlanLegSchema,
  feeRule: z.object({
    rate: z.number(),
    minimumFeeBase: z.number(),
    minimumFee: z.number(),
    lotSize: z.number(),
    description: z.string()
  })
});

const newsEvidenceCoverageSummarySchema = z.object({
  fetchedCount: z.number().int().nonnegative(),
  savedCount: z.number().int().nonnegative(),
  filteredOutCount: z.number().int().nonnegative(),
  relevantCount: z.number().int().nonnegative(),
  highCount: z.number().int().nonnegative(),
  mediumCount: z.number().int().nonnegative(),
  verifiedAnalyzedCount: z.number().int().nonnegative(),
  fallbackAnalysisCount: z.number().int().nonnegative(),
  failedAnalysisCount: z.number().int().nonnegative(),
  pendingCriticalCount: z.number().int().nonnegative(),
  pendingRelevantCount: z.number().int().nonnegative(),
  deadlineExceeded: z.boolean(),
  webSearchUsed: z.boolean(),
  quotaStatus: z.enum(["available", "quota_low", "quota_exhausted"]).optional(),
  cacheHitCount: z.number().int().nonnegative().optional(),
  tianapiCalls: z.number().int().nonnegative().optional(),
  tavilyCalls: z.number().int().nonnegative().optional(),
  sharedTopicReused: z.boolean().optional(),
  skippedQueryCount: z.number().int().nonnegative().optional(),
  sourceProviders: z.array(z.string()).optional()
});

const dataQualityReportSchema = z.object({
  status: z.enum(["complete", "partial", "insufficient", "conflicted"]),
  quoteFresh: z.boolean(),
  klineFresh: z.boolean(),
  latestDisclosureChecked: z.boolean(),
  disclosuresFresh: z.boolean(),
  criticalDisclosuresRead: z.boolean(),
  fundamentalsAvailable: z.boolean(),
  fundamentalsFresh: z.boolean(),
  fundamentalsComplete: z.boolean(),
  portfolioRiskEvaluated: z.boolean(),
  newsRefreshCompleted: z.boolean(),
  newsQuotaStatus: z.enum(["available", "quota_low", "quota_exhausted"]).optional(),
  criticalNewsAnalyzed: z.boolean(),
  missingFields: z.array(z.string()),
  staleFields: z.array(z.string()),
  conflictingFields: z.array(z.string()),
  fallbacksUsed: z.array(z.string()),
  entryBlockers: z.array(z.string()),
  newsCoverage: newsEvidenceCoverageSummarySchema.optional()
});

export const aiAnalysisSchema = z.object({
  evidenceSchemaVersion: z.string().optional(),
  decisionMode: z.enum(["long_term", "swing_trade", "position_management"]).optional(),
  decisionStatus: z
    .enum(["insufficient_data", "rejected", "research_candidate", "setup_wait", "conditional_entry", "manage_position", "exit_risk"])
    .optional(),
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
      newsCoverage: newsEvidenceCoverageSummarySchema.nullable().optional(),
      newsRefreshFailures: z.array(z.string()).optional(),
      fundamentalsStatus: z.string().optional(),
      fundamentalsReportPeriod: z.string().nullable().optional(),
      fundamentalsSourceUrl: z.string().nullable().optional(),
      fundamentalCoverage: z.object({
        annualPeriodCount: z.number().int().nonnegative(),
        standaloneQuarterCount: z.number().int().nonnegative(),
        freeCashFlowTtmCny10k: z.number().nullable(),
        operatingCashFlowToParentNetIncomeTtm: z.number().nullable(),
        freeCashFlowToParentNetIncomeTtm: z.number().nullable(),
        freeCashFlowMarginTtmPct: z.number().nullable(),
        cashFlowQualityStatus: z.enum(["available", "partial", "not_meaningful", "unavailable"]),
        adjustedNetIncomeAvailable: z.boolean(),
        historicalValuationAvailable: z.boolean(),
        peerValuationAvailable: z.boolean(),
        peTtm: z.number().nullable(),
        pb: z.number().nullable(),
        historicalPercentile: z.number().nullable(),
        missingFields: z.array(z.string())
      }).nullable().optional(),
      disclosureStatus: z.string().optional(),
      disclosureCheckedAt: z.string().nullable().optional(),
      disclosureCount: z.number().int().nonnegative().optional(),
      disclosureCriticalCount: z.number().int().nonnegative().optional(),
      disclosureExtractedCount: z.number().int().nonnegative().optional(),
      disclosureSources: z.array(z.object({
        id: z.string(),
        title: z.string(),
        publishedAt: z.string(),
        url: z.string(),
        contentStatus: z.enum(["metadata_only", "extracted", "analyzed"]),
        isCritical: z.boolean()
      })).optional(),
      companyEvidenceFailures: z.array(z.string()).optional(),
      portfolioRiskStatus: z.string().optional(),
      portfolioAvailableRiskAmount: z.number().nullable().optional(),
      portfolioRiskFailure: z.string().nullable().optional(),
      webSearchStatus: z.string().optional()
    })
    .optional(),
  isFallback: z.boolean().optional(),
  fallbackReason: z.string().optional(),
  dataQuality: dataQualityReportSchema.optional(),
  supportingEvidence: z.array(z.string()).optional().default([]),
  opposingEvidence: z.array(z.string()).optional().default([]),
  missingEvidence: z.array(z.string()).optional().default([]),
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
  holdAdvice: holdAdviceSchema.optional().nullable(),
  entryAdvice: entryAdviceSchema.optional().nullable(),
  tradePlan: analysisTradePlanSchema.optional(),
  disclaimer: z.string().min(1)
});

export type CreateWatchlistItemInput = z.infer<typeof createWatchlistItemSchema>;
export type UpdateWatchlistItemInput = z.infer<typeof updateWatchlistItemSchema>;
export type AlertRuleInput = z.infer<typeof alertRuleSchema>;
export type SectorWatchInput = z.infer<typeof sectorWatchSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
