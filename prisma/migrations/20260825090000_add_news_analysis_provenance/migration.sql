ALTER TABLE "NewsAnalysis"
ADD COLUMN "isFallback" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "fallbackReason" TEXT;

UPDATE "NewsAnalysis"
SET
  "isFallback" = true,
  "fallbackReason" = COALESCE("fallbackReason", '历史新闻分析包含本地兜底标记，需重新精读后才可计入完整证据。')
WHERE array_to_string("riskNotes", ' ') ILIKE '%兜底%'
   OR array_to_string("riskNotes", ' ') ILIKE '%API key 未配置%'
   OR array_to_string("riskNotes", ' ') ILIKE '%请求失败%';
