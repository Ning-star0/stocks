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

CREATE INDEX "AnalysisRun_userId_startedAt_idx" ON "AnalysisRun"("userId", "startedAt");
CREATE INDEX "AnalysisRun_status_startedAt_idx" ON "AnalysisRun"("status", "startedAt");
CREATE INDEX "AnalysisRunItem_runId_idx" ON "AnalysisRunItem"("runId");
CREATE INDEX "AnalysisRunItem_symbol_createdAt_idx" ON "AnalysisRunItem"("symbol", "createdAt");
CREATE INDEX "DecisionHistory_userId_decisionTime_idx" ON "DecisionHistory"("userId", "decisionTime");
CREATE INDEX "DecisionHistory_userId_symbol_decisionTime_idx" ON "DecisionHistory"("userId", "symbol", "decisionTime");
CREATE INDEX "DecisionHistory_action_idx" ON "DecisionHistory"("action");
CREATE INDEX "DecisionHistory_riskLevel_idx" ON "DecisionHistory"("riskLevel");

ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalysisRunItem" ADD CONSTRAINT "AnalysisRunItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DecisionHistory" ADD CONSTRAINT "DecisionHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DecisionHistory" ADD CONSTRAINT "DecisionHistory_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AnalysisRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
