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

CREATE UNIQUE INDEX "ShadowForecast_analysisId_key" ON "ShadowForecast"("analysisId");
CREATE INDEX "ShadowForecast_status_nextCheckAt_idx" ON "ShadowForecast"("status", "nextCheckAt");
CREATE INDEX "ShadowForecast_userId_decisionMode_resolvedAt_idx" ON "ShadowForecast"("userId", "decisionMode", "resolvedAt");
CREATE INDEX "ShadowForecast_benchmarkStatus_nextCheckAt_idx" ON "ShadowForecast"("benchmarkStatus", "nextCheckAt");
CREATE INDEX "ShadowForecast_symbol_analysisAsOf_idx" ON "ShadowForecast"("symbol", "analysisAsOf");

ALTER TABLE "ShadowForecast" ADD CONSTRAINT "ShadowForecast_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShadowForecast" ADD CONSTRAINT "ShadowForecast_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "AiAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
