const DEFAULT_CN_MARKET_CLOSED_RANGES_2026: Array<[string, string]> = [
  ["2026-01-01", "2026-01-03"],
  ["2026-02-15", "2026-02-23"],
  ["2026-04-04", "2026-04-06"],
  ["2026-05-01", "2026-05-05"],
  ["2026-06-19", "2026-06-21"],
  ["2026-09-25", "2026-09-27"],
  ["2026-10-01", "2026-10-07"]
];

const MAX_LOOKAHEAD_DAYS = 370;

export function isMarketTradingDay(date = new Date()) {
  const day = date.getDay();
  const key = formatLocalDateKey(date);
  if (configuredOpenDays().has(key)) return true;
  if (day === 0 || day === 6) return false;
  return !closedDays().has(key);
}

export function nextMarketScheduledTime(times: string[], now = new Date()) {
  const sorted = normalizeTimes(times);
  if (!sorted.length) return null;

  for (let offset = 0; offset <= MAX_LOOKAHEAD_DAYS; offset += 1) {
    const date = new Date(now);
    date.setDate(now.getDate() + offset);
    if (!isMarketTradingDay(date)) continue;

    for (const time of sorted) {
      const candidate = withLocalTime(date, time);
      if (candidate > now) return candidate;
    }
  }

  return null;
}

export function formatLocalDateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function withLocalTime(date: Date, time: string) {
  const [hour = "0", minute = "0"] = time.split(":");
  const next = new Date(date);
  next.setHours(Number(hour), Number(minute), 0, 0);
  return next;
}

function normalizeTimes(times: string[]) {
  return [...new Set(times.filter((time) => /^\d{1,2}:\d{2}$/.test(time)).map((time) => {
    const [hour = "0", minute = "0"] = time.split(":");
    return `${String(Number(hour)).padStart(2, "0")}:${minute}`;
  }))].sort();
}

function configuredOpenDays() {
  return parseDateSet(process.env.MARKET_OPEN_DAYS);
}

function closedDays() {
  const configured = parseDateSet(process.env.MARKET_CLOSED_DAYS);
  for (const [start, end] of DEFAULT_CN_MARKET_CLOSED_RANGES_2026) {
    for (const date of expandDateRange(start, end)) configured.add(date);
  }
  return configured;
}

function parseDateSet(value?: string) {
  return new Set(
    String(value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item))
  );
}

function expandDateRange(startKey: string, endKey: string) {
  const result: string[] = [];
  const current = new Date(`${startKey}T00:00:00`);
  const end = new Date(`${endKey}T00:00:00`);
  while (!Number.isNaN(current.getTime()) && current <= end) {
    result.push(formatLocalDateKey(current));
    current.setDate(current.getDate() + 1);
  }
  return result;
}
