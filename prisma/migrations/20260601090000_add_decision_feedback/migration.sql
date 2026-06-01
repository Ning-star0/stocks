CREATE TABLE "DecisionFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "feedbackAction" TEXT NOT NULL,
    "note" TEXT,
    "executedPrice" DECIMAL(18,4),
    "executedShares" DECIMAL(18,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DecisionFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DecisionFeedback_decisionId_key" ON "DecisionFeedback"("decisionId");
CREATE INDEX "DecisionFeedback_userId_createdAt_idx" ON "DecisionFeedback"("userId", "createdAt");
CREATE INDEX "DecisionFeedback_feedbackAction_idx" ON "DecisionFeedback"("feedbackAction");

ALTER TABLE "DecisionFeedback" ADD CONSTRAINT "DecisionFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DecisionFeedback" ADD CONSTRAINT "DecisionFeedback_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "FocusDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
