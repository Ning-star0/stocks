ALTER TABLE "AiUsageLog"
ADD COLUMN "promptCacheHitTokens" INTEGER,
ADD COLUMN "promptCacheMissTokens" INTEGER,
ADD COLUMN "modelTier" TEXT,
ADD COLUMN "routingReason" TEXT;
