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
    "targetPrice" DECIMAL(18,4),
    "stopLoss" DECIMAL(18,4),
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsAnalysis_pkey" PRIMARY KEY ("id")
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
    "estimatedCost" DECIMAL(18,8),
    "cacheHit" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageLog_pkey" PRIMARY KEY ("id")
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
ALTER TABLE "SectorWatch" ADD CONSTRAINT "SectorWatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyMarketBrief" ADD CONSTRAINT "DailyMarketBrief_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisJob" ADD CONSTRAINT "AnalysisJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsageLog" ADD CONSTRAINT "AiUsageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
