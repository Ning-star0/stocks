ALTER TABLE "AiConfig"
ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'deepseek',
ADD COLUMN "flagshipModel" TEXT NOT NULL DEFAULT 'deepseek-v4-pro',
ADD COLUMN "standardModel" TEXT NOT NULL DEFAULT 'deepseek-v4-flash',
ADD COLUMN "flagshipInputPricePerMillion" DECIMAL(18,8) NOT NULL DEFAULT 0,
ADD COLUMN "flagshipOutputPricePerMillion" DECIMAL(18,8) NOT NULL DEFAULT 0,
ADD COLUMN "standardInputPricePerMillion" DECIMAL(18,8) NOT NULL DEFAULT 0,
ADD COLUMN "standardOutputPricePerMillion" DECIMAL(18,8) NOT NULL DEFAULT 0,
ADD COLUMN "costCurrency" TEXT NOT NULL DEFAULT 'CNY';
