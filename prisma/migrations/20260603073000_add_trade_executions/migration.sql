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

CREATE UNIQUE INDEX "TradeExecution_feedbackId_key" ON "TradeExecution"("feedbackId");
CREATE INDEX "TradeExecution_userId_executedAt_idx" ON "TradeExecution"("userId", "executedAt");
CREATE INDEX "TradeExecution_symbol_executedAt_idx" ON "TradeExecution"("symbol", "executedAt");
CREATE INDEX "TradeExecution_side_idx" ON "TradeExecution"("side");

ALTER TABLE "TradeExecution" ADD CONSTRAINT "TradeExecution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TradeExecution" ADD CONSTRAINT "TradeExecution_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "DecisionFeedback"("id") ON DELETE SET NULL ON UPDATE CASCADE;
