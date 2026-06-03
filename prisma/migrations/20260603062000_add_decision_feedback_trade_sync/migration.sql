ALTER TABLE "DecisionFeedback" ADD COLUMN "tradeSymbol" TEXT;
ALTER TABLE "DecisionFeedback" ADD COLUMN "tradeSide" TEXT;
ALTER TABLE "DecisionFeedback" ADD COLUMN "positionSyncedAt" TIMESTAMP(3);

CREATE INDEX "DecisionFeedback_tradeSymbol_idx" ON "DecisionFeedback"("tradeSymbol");
