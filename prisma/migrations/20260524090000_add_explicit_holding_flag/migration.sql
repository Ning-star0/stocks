ALTER TABLE "WatchlistItem"
ADD COLUMN "isHolding" BOOLEAN NOT NULL DEFAULT false;

UPDATE "WatchlistItem"
SET "isHolding" = true
WHERE "holdingPrice" IS NOT NULL OR "positionOpenedAt" IS NOT NULL;
