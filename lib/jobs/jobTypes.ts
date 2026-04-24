export const JOB_TYPES = {
  NEWS_ANALYSIS: "news_analysis",
  STOCK_ANALYSIS: "stock_analysis",
  DAILY_BRIEF: "daily_brief",
  ALERT_CHECK: "alert_check"
} as const;

export const JOB_STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  SKIPPED_CACHED: "skipped_cached"
} as const;

export const JOB_PRIORITY = {
  USER_MANUAL_ANALYSIS: 100,
  HIGH_IMPORTANCE_NEWS: 80,
  PRICE_MOVE: 70,
  ALERT_CHECK: 60,
  SCHEDULED_REFRESH: 30,
  DAILY_BRIEF: 20
} as const;

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];

