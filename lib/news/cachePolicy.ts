export type NewsCacheKind = "company" | "topic" | "web";

export function resolveNewsCacheTtl(kind: NewsCacheKind, now = new Date()) {
  if (kind === "company") return positiveEnv("NEWS_CRITICAL_CACHE_TTL_SECONDS", 3600);
  if (isChinaTradingSession(now)) return positiveEnv("NEWS_TOPIC_CACHE_TTL_SECONDS", 4 * 3600);
  return positiveEnv("NEWS_OFF_HOURS_CACHE_TTL_SECONDS", 6 * 3600);
}

export function isChinaTradingSession(now: Date) {
  const parts = chinaParts(now);
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;
  const minutes = parts.hour * 60 + parts.minute;
  return minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 30;
}

function chinaParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { weekday: value("weekday"), hour: Number(value("hour")), minute: Number(value("minute")) };
}

function positiveEnv(name: string, fallback: number) {
  const value = Math.floor(Number(process.env[name]));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
