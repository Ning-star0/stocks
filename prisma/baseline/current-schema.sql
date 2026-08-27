-- CreateEnum
CREATE TYPE "TimeHorizon" AS ENUM ('day_trade', 'swing_trade', 'long_term');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('low', 'medium', 'high');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Watchlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Watchlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchlistItem" (
    "id" TEXT NOT NULL,
    "watchlistId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'US',
    "note" TEXT,
    "holdingPrice" DECIMAL(18,4),
    "holdingShares" DECIMAL(18,4),
    "isHolding" BOOLEAN NOT NULL DEFAULT false,
    "targetPrice" DECIMAL(18,4),
    "stopLoss" DECIMAL(18,4),
    "positionOpenedAt" TIMESTAMP(3),
    "timeHorizon" "TimeHorizon" NOT NULL DEFAULT 'swing_trade',
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'medium',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceSnapshot" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "open" DECIMAL(18,4) NOT NULL,
    "high" DECIMAL(18,4) NOT NULL,
    "low" DECIMAL(18,4) NOT NULL,
    "close" DECIMAL(18,4) NOT NULL,
    "price" DECIMAL(18,4) NOT NULL,
    "volume" BIGINT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicalIndicator" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "rsi14" DECIMAL(18,6),
    "macd" DECIMAL(18,6),
    "macdSignal" DECIMAL(18,6),
    "sma20" DECIMAL(18,6),
    "sma50" DECIMAL(18,6),
    "sma200" DECIMAL(18,6),
    "ema20" DECIMAL(18,6),
    "bollingerUpper" DECIMAL(18,6),
    "bollingerMiddle" DECIMAL(18,6),
    "bollingerLower" DECIMAL(18,6),
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechnicalIndicator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAnalysis" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "inputJson" JSONB NOT NULL,
    "outputJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "threshold" DECIMAL(18,6) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "triggeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsItem" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleHash" TEXT NOT NULL,
    "url" TEXT,
    "source" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "rawContent" TEXT,
    "summary" TEXT,
    "symbols" TEXT[],
    "sectors" TEXT[],
    "sentiment" TEXT,
    "importance" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsAnalysis" (
    "id" TEXT NOT NULL,
    "newsItemId" TEXT NOT NULL,
    "aiSummary" TEXT NOT NULL,
    "sentiment" TEXT NOT NULL,
    "affectedSymbols" TEXT[],
    "affectedSectors" TEXT[],
    "impactLevel" TEXT NOT NULL,
    "riskNotes" TEXT[],
    "whyItMatters" TEXT,
    "confidence" DECIMAL(5,4),
    "eventContextJson" JSONB,
    "isFallback" BOOLEAN NOT NULL DEFAULT false,
    "fallbackReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShadowForecast" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "cohortKey" TEXT NOT NULL,
    "priceRegime" TEXT NOT NULL,
    "priceRegimeAlgorithmVersion" TEXT NOT NULL,
    "marketRegime" TEXT NOT NULL,
    "marketRegimeAlgorithmVersion" TEXT NOT NULL,
    "marketRegimeBenchmarkSymbol" TEXT NOT NULL,
    "marketRegimeEvidenceHash" TEXT,
    "benchmarkAlgorithmVersion" TEXT NOT NULL,
    "decisionMode" TEXT NOT NULL,
    "analysisAsOf" TIMESTAMP(3) NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "modelName" TEXT,
    "modelProbability" DECIMAL(5,4) NOT NULL,
    "horizonTradingDays" INTEGER NOT NULL,
    "priceBasis" TEXT NOT NULL,
    "entryTriggerPrice" DECIMAL(18,4) NOT NULL,
    "stopLossPrice" DECIMAL(18,4) NOT NULL,
    "takeProfitPrice" DECIMAL(18,4) NOT NULL,
    "plannedShares" DECIMAL(18,4) NOT NULL,
    "netProfitIfRight" DECIMAL(18,2) NOT NULL,
    "netLossIfWrong" DECIMAL(18,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "entryAt" TIMESTAMP(3),
    "entryPrice" DECIMAL(18,4),
    "exitAt" TIMESTAMP(3),
    "exitPrice" DECIMAL(18,4),
    "outcome" TEXT,
    "outcomeValue" INTEGER,
    "observedTradingDays" INTEGER NOT NULL DEFAULT 0,
    "maxFavorablePct" DECIMAL(12,6),
    "maxAdversePct" DECIMAL(12,6),
    "netReturnPct" DECIMAL(12,6),
    "benchmarkStatus" TEXT NOT NULL DEFAULT 'pending',
    "benchmarkExitAt" TIMESTAMP(3),
    "benchmarkExitPrice" DECIMAL(18,4),
    "benchmarkNetReturnPct" DECIMAL(12,6),
    "excessNetReturnPct" DECIMAL(12,6),
    "priceDataThrough" TIMESTAMP(3),
    "priceProvider" TEXT,
    "priceSourceUrl" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "invalidReason" TEXT,
    "lastCheckAt" TIMESTAMP(3),
    "lastCheckFailure" TEXT,
    "nextCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShadowForecast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockEvidenceState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "newsRefreshAt" TIMESTAMP(3),
    "newsRefreshJson" JSONB,
    "fundamentalsRefreshAt" TIMESTAMP(3),
    "fundamentalsJson" JSONB,
    "disclosuresRefreshAt" TIMESTAMP(3),
    "disclosuresJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockEvidenceState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectorWatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sectorName" TEXT NOT NULL,
    "keywords" TEXT[],
    "symbols" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SectorWatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyMarketBrief" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "watchlistSummary" TEXT NOT NULL,
    "sectorSummary" TEXT NOT NULL,
    "riskSummary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyMarketBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CacheEntry" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CacheEntry_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AnalysisJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT,
    "jobType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "priority" INTEGER NOT NULL DEFAULT 30,
    "inputHash" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 2,
    "resultId" TEXT,
    "errorMessage" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AnalysisJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsageLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT,
    "jobType" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputHash" TEXT,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "promptCacheHitTokens" INTEGER,
    "promptCacheMissTokens" INTEGER,
    "modelTier" TEXT,
    "routingReason" TEXT,
    "estimatedCost" DECIMAL(18,8),
    "cacheHit" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiUsageLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "provider" TEXT NOT NULL,
    "apiName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'success',
    "unit" TEXT NOT NULL DEFAULT 'request',
    "amount" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiConfig" (
    "id" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL DEFAULT '',
    "baseUrl" TEXT NOT NULL DEFAULT 'https://api.deepseek.com',
    "model" TEXT NOT NULL DEFAULT 'deepseek-v4-pro',
    "provider" TEXT NOT NULL DEFAULT 'deepseek',
    "flagshipModel" TEXT NOT NULL DEFAULT 'deepseek-v4-pro',
    "standardModel" TEXT NOT NULL DEFAULT 'deepseek-v4-flash',
    "flagshipInputPricePerMillion" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "flagshipOutputPricePerMillion" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "standardInputPricePerMillion" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "standardOutputPricePerMillion" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "costCurrency" TEXT NOT NULL DEFAULT 'CNY',
    "focusStockAnalysisConcurrency" INTEGER NOT NULL DEFAULT 5,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL DEFAULT 'wecom',
    "webhookUrl" TEXT NOT NULL DEFAULT '',
    "corpId" TEXT NOT NULL DEFAULT '',
    "agentId" TEXT NOT NULL DEFAULT '',
    "appSecret" TEXT NOT NULL DEFAULT '',
    "toUser" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMemory" (
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMemory_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "FocusGroup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '今日关注',
    "symbols" TEXT[],
    "capital" DECIMAL(18,2),
    "newsFetchTime" TEXT NOT NULL DEFAULT '09:30',
    "analysisTimes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastNewsFetch" TIMESTAMP(3),
    "lastAnalysis" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FocusGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FocusDecision" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "scheduledFor" TIMESTAMP(3),
    "decisionJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FocusDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "feedbackAction" TEXT NOT NULL,
    "note" TEXT,
    "executedPrice" DECIMAL(18,4),
    "executedShares" DECIMAL(18,4),
    "tradeSymbol" TEXT,
    "tradeSide" TEXT,
    "positionSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DecisionFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeExecution" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feedbackId" TEXT,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "price" DECIMAL(18,4) NOT NULL,
    "shares" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "fee" DECIMAL(18,2) NOT NULL,
    "netCashChange" DECIMAL(18,2) NOT NULL,
    "realizedPnl" DECIMAL(18,2),
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "runType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "totalSymbols" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" TIMESTAMP(3),
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisRunItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "stockName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "decisionId" TEXT,
    "aiStatus" TEXT,
    "quoteStatus" TEXT,
    "newsStatus" TEXT,
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "aiDurationMs" INTEGER,
    "quoteDurationMs" INTEGER,
    "newsDurationMs" INTEGER,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisRunItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "runId" TEXT,
    "analysisId" TEXT,
    "symbol" TEXT NOT NULL,
    "stockName" TEXT,
    "decisionTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "strategyDirection" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "riskLevel" TEXT,
    "confidence" DECIMAL(5,4),
    "summary" TEXT NOT NULL,
    "keyReasons" JSONB NOT NULL,
    "entryRange" TEXT,
    "stopLoss" TEXT,
    "takeProfit" TEXT,
    "invalidationCondition" TEXT,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "rawModelName" TEXT,
    "previousAction" TEXT,
    "previousStrategyDirection" TEXT,
    "changeSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Watchlist_userId_idx" ON "Watchlist"("userId");

-- CreateIndex
CREATE INDEX "WatchlistItem_symbol_idx" ON "WatchlistItem"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistItem_watchlistId_symbol_key" ON "WatchlistItem"("watchlistId", "symbol");

-- CreateIndex
CREATE INDEX "PriceSnapshot_symbol_timestamp_idx" ON "PriceSnapshot"("symbol", "timestamp");

-- CreateIndex
CREATE INDEX "TechnicalIndicator_symbol_timestamp_idx" ON "TechnicalIndicator"("symbol", "timestamp");

-- CreateIndex
CREATE INDEX "AiAnalysis_userId_symbol_createdAt_idx" ON "AiAnalysis"("userId", "symbol", "createdAt");

-- CreateIndex
CREATE INDEX "Alert_userId_symbol_idx" ON "Alert"("userId", "symbol");

-- CreateIndex
CREATE UNIQUE INDEX "NewsItem_titleHash_key" ON "NewsItem"("titleHash");

-- CreateIndex
CREATE UNIQUE INDEX "NewsItem_url_key" ON "NewsItem"("url");

-- CreateIndex
CREATE INDEX "NewsItem_publishedAt_idx" ON "NewsItem"("publishedAt");

-- CreateIndex
CREATE INDEX "NewsItem_symbols_idx" ON "NewsItem"("symbols");

-- CreateIndex
CREATE INDEX "NewsItem_sectors_idx" ON "NewsItem"("sectors");

-- CreateIndex
CREATE INDEX "NewsAnalysis_newsItemId_createdAt_idx" ON "NewsAnalysis"("newsItemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShadowForecast_analysisId_key" ON "ShadowForecast"("analysisId");

-- CreateIndex
CREATE INDEX "ShadowForecast_status_nextCheckAt_idx" ON "ShadowForecast"("status", "nextCheckAt");

-- CreateIndex
CREATE INDEX "ShadowForecast_userId_decisionMode_resolvedAt_idx" ON "ShadowForecast"("userId", "decisionMode", "resolvedAt");

-- CreateIndex
CREATE INDEX "ShadowForecast_benchmarkStatus_nextCheckAt_idx" ON "ShadowForecast"("benchmarkStatus", "nextCheckAt");

-- CreateIndex
CREATE INDEX "ShadowForecast_symbol_analysisAsOf_idx" ON "ShadowForecast"("symbol", "analysisAsOf");

-- CreateIndex
CREATE INDEX "StockEvidenceState_symbol_newsRefreshAt_idx" ON "StockEvidenceState"("symbol", "newsRefreshAt");

-- CreateIndex
CREATE INDEX "StockEvidenceState_symbol_fundamentalsRefreshAt_idx" ON "StockEvidenceState"("symbol", "fundamentalsRefreshAt");

-- CreateIndex
CREATE INDEX "StockEvidenceState_symbol_disclosuresRefreshAt_idx" ON "StockEvidenceState"("symbol", "disclosuresRefreshAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockEvidenceState_userId_symbol_key" ON "StockEvidenceState"("userId", "symbol");

-- CreateIndex
CREATE INDEX "SectorWatch_userId_idx" ON "SectorWatch"("userId");

-- CreateIndex
CREATE INDEX "DailyMarketBrief_userId_date_idx" ON "DailyMarketBrief"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyMarketBrief_userId_date_key" ON "DailyMarketBrief"("userId", "date");

-- CreateIndex
CREATE INDEX "CacheEntry_expiresAt_idx" ON "CacheEntry"("expiresAt");

-- CreateIndex
CREATE INDEX "AnalysisJob_status_priority_createdAt_idx" ON "AnalysisJob"("status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "AnalysisJob_symbol_jobType_idx" ON "AnalysisJob"("symbol", "jobType");

-- CreateIndex
CREATE INDEX "AnalysisJob_inputHash_idx" ON "AnalysisJob"("inputHash");

-- CreateIndex
CREATE INDEX "AiUsageLog_userId_symbol_createdAt_idx" ON "AiUsageLog"("userId", "symbol", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsageLog_inputHash_idx" ON "AiUsageLog"("inputHash");

-- CreateIndex
CREATE INDEX "ApiUsageLog_userId_provider_apiName_createdAt_idx" ON "ApiUsageLog"("userId", "provider", "apiName", "createdAt");

-- CreateIndex
CREATE INDEX "ApiUsageLog_provider_apiName_createdAt_idx" ON "ApiUsageLog"("provider", "apiName", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationConfig_userId_key" ON "NotificationConfig"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FocusGroup_userId_key" ON "FocusGroup"("userId");

-- CreateIndex
CREATE INDEX "FocusDecision_userId_createdAt_idx" ON "FocusDecision"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FocusDecision_userId_inputHash_source_key" ON "FocusDecision"("userId", "inputHash", "source");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionFeedback_decisionId_key" ON "DecisionFeedback"("decisionId");

-- CreateIndex
CREATE INDEX "DecisionFeedback_userId_createdAt_idx" ON "DecisionFeedback"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "DecisionFeedback_feedbackAction_idx" ON "DecisionFeedback"("feedbackAction");

-- CreateIndex
CREATE INDEX "DecisionFeedback_tradeSymbol_idx" ON "DecisionFeedback"("tradeSymbol");

-- CreateIndex
CREATE UNIQUE INDEX "TradeExecution_feedbackId_key" ON "TradeExecution"("feedbackId");

-- CreateIndex
CREATE INDEX "TradeExecution_userId_executedAt_idx" ON "TradeExecution"("userId", "executedAt");

-- CreateIndex
CREATE INDEX "TradeExecution_symbol_executedAt_idx" ON "TradeExecution"("symbol", "executedAt");

-- CreateIndex
CREATE INDEX "TradeExecution_side_idx" ON "TradeExecution"("side");

-- CreateIndex
CREATE INDEX "AnalysisRun_userId_startedAt_idx" ON "AnalysisRun"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "AnalysisRun_status_startedAt_idx" ON "AnalysisRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "AnalysisRunItem_runId_idx" ON "AnalysisRunItem"("runId");

-- CreateIndex
CREATE INDEX "AnalysisRunItem_symbol_createdAt_idx" ON "AnalysisRunItem"("symbol", "createdAt");

-- CreateIndex
CREATE INDEX "DecisionHistory_userId_decisionTime_idx" ON "DecisionHistory"("userId", "decisionTime");

-- CreateIndex
CREATE INDEX "DecisionHistory_userId_symbol_decisionTime_idx" ON "DecisionHistory"("userId", "symbol", "decisionTime");

-- CreateIndex
CREATE INDEX "DecisionHistory_action_idx" ON "DecisionHistory"("action");

-- CreateIndex
CREATE INDEX "DecisionHistory_riskLevel_idx" ON "DecisionHistory"("riskLevel");

-- AddForeignKey
ALTER TABLE "Watchlist" ADD CONSTRAINT "Watchlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAnalysis" ADD CONSTRAINT "AiAnalysis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsAnalysis" ADD CONSTRAINT "NewsAnalysis_newsItemId_fkey" FOREIGN KEY ("newsItemId") REFERENCES "NewsItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShadowForecast" ADD CONSTRAINT "ShadowForecast_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShadowForecast" ADD CONSTRAINT "ShadowForecast_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "AiAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockEvidenceState" ADD CONSTRAINT "StockEvidenceState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectorWatch" ADD CONSTRAINT "SectorWatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyMarketBrief" ADD CONSTRAINT "DailyMarketBrief_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisJob" ADD CONSTRAINT "AnalysisJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsageLog" ADD CONSTRAINT "AiUsageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiUsageLog" ADD CONSTRAINT "ApiUsageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationConfig" ADD CONSTRAINT "NotificationConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMemory" ADD CONSTRAINT "UserMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FocusGroup" ADD CONSTRAINT "FocusGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FocusDecision" ADD CONSTRAINT "FocusDecision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionFeedback" ADD CONSTRAINT "DecisionFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionFeedback" ADD CONSTRAINT "DecisionFeedback_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "FocusDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeExecution" ADD CONSTRAINT "TradeExecution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeExecution" ADD CONSTRAINT "TradeExecution_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "DecisionFeedback"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRunItem" ADD CONSTRAINT "AnalysisRunItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionHistory" ADD CONSTRAINT "DecisionHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionHistory" ADD CONSTRAINT "DecisionHistory_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AnalysisRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
