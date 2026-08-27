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

export const newsEventContextSchema = z.object({
  schemaVersion: z.literal("news-event-context-v1"),
  eventOccurredAt: z.string().nullable(),
  informationStage: z.enum(["first_report", "follow_up", "reprint", "unclear"]),
  originalSource: z.object({
    status: z.enum(["current_source", "referenced_without_url", "unavailable"]),
    name: z.string().nullable(),
    url: z.string().url().nullable()
  }),
  expectation: z.object({
    status: z.enum(["explicit", "inferred", "unavailable"]),
    baseline: z.string().nullable(),
    actual: z.string().nullable(),
    gapDirection: z.enum(["positive", "negative", "neutral", "unclear"]),
    evidence: z.string().nullable()
  }),
  expectedImpactHorizon: z.enum(["days", "quarters", "long_term", "unclear"]),
  falsifiers: z.array(z.string())
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
  eventContext: newsEventContextSchema,
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
  shadowEligible: z.boolean().optional(),
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
  sourceProviders: z.array(z.string()).optional(),
  eventClusterCount: z.number().int().nonnegative().optional(),
  duplicateArticleCount: z.number().int().nonnegative().optional(),
  futureDatedArticleCount: z.number().int().nonnegative().optional(),
  explicitExpectationCount: z.number().int().nonnegative().optional(),
  inferredExpectationCount: z.number().int().nonnegative().optional(),
  unavailableExpectationCount: z.number().int().nonnegative().optional(),
  priceReactionAvailableCount: z.number().int().nonnegative().optional()
});

const newsEventTimelineSummarySchema = z.object({
  schemaVersion: z.literal("news-event-timeline-v1"),
  algorithmVersion: z.string(),
  status: z.enum(["complete", "partial", "insufficient"]),
  windowDescription: z.string(),
  futureDatedArticleCount: z.number().int().nonnegative(),
  events: z.array(z.object({
    eventId: z.string(),
    title: z.string(),
    firstSeenAt: z.string(),
    latestSeenAt: z.string(),
    novelty: z.enum(["single_report", "reprint_cluster"]),
    articleCount: z.number().int().positive(),
    importance: z.enum(["high", "medium", "low", "unknown"]),
    canonicalSource: z.object({
      name: z.string().nullable(),
      url: z.string().url().nullable(),
      tier: z.enum(["primary_official", "secondary_media", "unknown"])
    }),
    expectation: newsEventContextSchema.shape.expectation,
    eventContextSource: z.object({
      name: z.string().nullable(),
      url: z.string().url().nullable(),
      publishedAt: z.string()
    }).nullable(),
    expectedImpactHorizon: z.enum(["days", "quarters", "long_term", "unclear"]),
    priceReaction: z.object({
      status: z.enum(["available", "unavailable"]),
      reactionSessionDate: z.string().nullable(),
      close1dPct: z.number().nullable(),
      close3dPct: z.number().nullable(),
      close5dPct: z.number().nullable(),
      volumeRatio20: z.number().nullable(),
      observedSessions: z.number().int().nonnegative(),
      missingReason: z.string().nullable()
    }),
    limitations: z.array(z.string())
  }))
});

const etfSubEvidenceStatusSchema = z.enum(["available", "partial", "unavailable"]);

const etfEvidenceSchema = z.object({
  schemaVersion: z.literal("etf-evidence-v1"),
  status: z.enum(["complete", "partial", "insufficient"]),
  symbol: z.string(),
  analysisAsOf: z.string(),
  productIdentity: z.object({
    status: etfSubEvidenceStatusSchema,
    exchange: z.enum(["SH", "SZ"]).nullable(),
    name: z.string().nullable(),
    classificationSource: z.enum(["exchange_symbol", "unknown"]),
    quoteProvider: z.string(),
    quoteAsOf: z.string().nullable(),
    limitations: z.array(z.string())
  }),
  liquidity: z.object({
    status: etfSubEvidenceStatusSchema,
    algorithmVersion: z.literal("provider-volume-proxy-v1"),
    asOf: z.string().nullable(),
    sampleTradingDays: z.number().int().nonnegative(),
    averageDailyVolume20: z.number().nullable(),
    medianDailyVolume20: z.number().nullable(),
    zeroVolumeDays20: z.number().int().nonnegative(),
    averageDailyValueProxy20: z.number().nullable(),
    latestVolumeRatio20: z.number().nullable(),
    providerVolumeUnit: z.literal("provider_raw_unit"),
    valueProxyFormula: z.literal("close_x_provider_volume"),
    futureCandleExcludedCount: z.number().int().nonnegative(),
    limitations: z.array(z.string())
  }),
  tracking: z.object({ status: z.literal("unavailable"), benchmarkSymbol: z.null(), trackingError: z.null(), missingReason: z.string() }),
  premiumDiscount: z.object({ status: z.literal("unavailable"), nav: z.null(), iopv: z.null(), premiumDiscountPct: z.null(), missingReason: z.string() }),
  fundSize: z.object({ status: z.literal("unavailable"), assetsUnderManagement: z.null(), sharesOutstanding: z.null(), missingReason: z.string() }),
  holdingsExposure: z.object({ status: z.literal("unavailable"), asOf: z.null(), topHoldings: z.array(z.unknown()), industryExposure: z.array(z.unknown()), missingReason: z.string() }),
  managerDisclosures: z.object({ status: z.literal("unavailable"), checkedAt: z.null(), items: z.array(z.unknown()), missingReason: z.string() }),
  missingFields: z.array(z.string()),
  entryBlockers: z.array(z.string())
});

const dataQualityReportSchema = z.object({
  status: z.enum(["complete", "partial", "insufficient", "conflicted"]),
  instrumentType: z.enum(["a_share_stock", "etf", "index", "unknown"]),
  instrumentClassificationSource: z.enum(["exchange_symbol", "unknown"]),
  instrumentEvidencePolicyVersion: z.string(),
  instrumentEvidenceComplete: z.boolean(),
  etfProductIdentityStatus: etfSubEvidenceStatusSchema.optional(),
  etfLiquidityStatus: etfSubEvidenceStatusSchema.optional(),
  etfTrackingStatus: etfSubEvidenceStatusSchema.optional(),
  etfPremiumDiscountStatus: etfSubEvidenceStatusSchema.optional(),
  etfManagerDisclosuresStatus: etfSubEvidenceStatusSchema.optional(),
  etfEvidence: etfEvidenceSchema.optional(),
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
  entryOutcomeForecast: z.object({
    schemaVersion: z.literal("entry-outcome-forecast-v1"),
    status: z.enum(["subjective_unvalidated", "unavailable"]),
    targetBeforeStopProbability: z.number().min(0).max(1).nullable(),
    horizonTradingDays: z.union([z.literal(20), z.literal(63)]).nullable(),
    definition: z.string().min(1),
    reasoning: z.string()
  }).optional(),
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
      newsTimeline: newsEventTimelineSummarySchema.nullable().optional(),
      newsRefreshFailures: z.array(z.string()).optional(),
      marketRegimeStatus: z.string().optional(),
      marketRegime: z.string().optional(),
      marketRegimeBenchmarkSymbol: z.string().optional(),
      marketRegimeAsOf: z.string().nullable().optional(),
      marketRegimeSourceUrl: z.string().optional(),
      marketRegimeFailure: z.string().nullable().optional(),
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
        adjustedNetIncomeStatus: z.enum(["complete", "partial", "unavailable"]),
        adjustedNetIncomeAvailable: z.boolean(),
        adjustedNetIncomeTtmCny10k: z.number().nullable(),
        adjustedAnnualPeriodCount: z.number().int().nonnegative(),
        adjustedStandaloneQuarterCount: z.number().int().nonnegative(),
        adjustedNetIncomeSources: z.array(z.object({
          periodEnd: z.string(),
          title: z.string(),
          url: z.string(),
          publishedAt: z.string(),
          contentHash: z.string()
        })),
        historicalValuationAvailable: z.boolean(),
        historicalValuationStatus: z.enum(["available", "partial", "unavailable"]).default("unavailable"),
        peerValuationAvailable: z.boolean(),
        peerValuationStatus: z.enum(["available", "partial", "unavailable", "conflicted"]).default("unavailable"),
        peerValuationFresh: z.boolean().default(false),
        peerValuationAsOf: z.string().nullable().default(null),
        peerValuationIndustry: z.string().nullable().default(null),
        peerValuationSourceUrl: z.string().nullable().default(null),
        peerValuationClassificationSourceUrl: z.string().nullable().default(null),
        peerValuationContentHash: z.string().nullable().default(null),
        peerValuationMissingReason: z.string().nullable().default(null),
        peerValuationSampleSize: z.number().int().nonnegative().default(0),
        peerPeTtm: z.number().nullable().default(null),
        peerPeTtmMedian: z.number().nullable().default(null),
        peerPeTtmPercentile: z.number().nullable().default(null),
        peerPeTtmPremiumDiscountPct: z.number().nullable().default(null),
        peerPbMrq: z.number().nullable().default(null),
        peerPbMrqMedian: z.number().nullable().default(null),
        peerPbMrqPercentile: z.number().nullable().default(null),
        peerPbMrqPremiumDiscountPct: z.number().nullable().default(null),
        peerValuationComparables: z.array(z.object({
          symbol: z.string(),
          name: z.string(),
          peTtm: z.number().nullable(),
          pbMrq: z.number().nullable()
        })).default([]),
        peTtm: z.number().nullable(),
        pb: z.number().nullable(),
        historicalPercentile: z.number().nullable(),
        historicalPePercentile: z.number().nullable().default(null),
        historicalPbPercentile: z.number().nullable().default(null),
        historicalPeSampleSize: z.number().int().nonnegative().default(0),
        historicalPbSampleSize: z.number().int().nonnegative().default(0),
        historicalValuationWindowStart: z.string().nullable().default(null),
        historicalValuationWindowEnd: z.string().nullable().default(null),
        historicalValuationPriceProvider: z.string().nullable().default(null),
        historicalValuationPriceSourceUrl: z.string().nullable().default(null),
        historicalValuationPriceSeriesHash: z.string().nullable().default(null),
        historicalValuationPriceSeriesFresh: z.boolean().default(false),
        historicalValuationMissingReason: z.string().nullable().default(null),
        historicalValuationReportSources: z.array(z.object({
          periodEnd: z.string(),
          publishedAt: z.string(),
          effectiveFrom: z.string(),
          title: z.string(),
          url: z.string()
        })).default([]),
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
        extractionMethod: z.enum(["embedded_text", "ocr", "hybrid_ocr"]).nullable().optional(),
        extractionCoverage: z.enum(["full_document"]).nullable().optional(),
        totalPages: z.number().int().positive().nullable().optional(),
        ocrPages: z.number().int().nonnegative().optional(),
        extractorVersion: z.string().nullable().optional(),
        extractionFailure: z.string().nullable().optional(),
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
