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

CREATE UNIQUE INDEX "StockEvidenceState_userId_symbol_key" ON "StockEvidenceState"("userId", "symbol");
CREATE INDEX "StockEvidenceState_symbol_newsRefreshAt_idx" ON "StockEvidenceState"("symbol", "newsRefreshAt");
CREATE INDEX "StockEvidenceState_symbol_fundamentalsRefreshAt_idx" ON "StockEvidenceState"("symbol", "fundamentalsRefreshAt");
CREATE INDEX "StockEvidenceState_symbol_disclosuresRefreshAt_idx" ON "StockEvidenceState"("symbol", "disclosuresRefreshAt");

ALTER TABLE "StockEvidenceState"
ADD CONSTRAINT "StockEvidenceState_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
