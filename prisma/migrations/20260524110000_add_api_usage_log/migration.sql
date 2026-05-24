CREATE TABLE "ApiUsageLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "provider" TEXT NOT NULL,
    "apiName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'success',
    "unit" TEXT NOT NULL DEFAULT 'request',
    "amount" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiUsageLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApiUsageLog_userId_provider_apiName_createdAt_idx" ON "ApiUsageLog"("userId", "provider", "apiName", "createdAt");
CREATE INDEX "ApiUsageLog_provider_apiName_createdAt_idx" ON "ApiUsageLog"("provider", "apiName", "createdAt");

ALTER TABLE "ApiUsageLog" ADD CONSTRAINT "ApiUsageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
