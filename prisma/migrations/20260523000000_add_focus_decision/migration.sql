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

CREATE UNIQUE INDEX "FocusDecision_userId_inputHash_source_key" ON "FocusDecision"("userId", "inputHash", "source");
CREATE INDEX "FocusDecision_userId_createdAt_idx" ON "FocusDecision"("userId", "createdAt");

ALTER TABLE "FocusDecision" ADD CONSTRAINT "FocusDecision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
