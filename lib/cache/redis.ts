import Redis from "ioredis";

const globalRedis = globalThis as unknown as {
  __stockAiRedisClient?: Redis | null;
  __stockAiRedisUnavailableUntil?: number;
};

const REDIS_RETRY_COOLDOWN_MS = 30_000;

export function getRedisClient() {
  if (!process.env.REDIS_URL) return null;
  if (globalRedis.__stockAiRedisUnavailableUntil && globalRedis.__stockAiRedisUnavailableUntil > Date.now()) {
    return null;
  }
  if (globalRedis.__stockAiRedisClient !== undefined) return globalRedis.__stockAiRedisClient;

  const client = new Redis(process.env.REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: numberEnv("REDIS_CONNECT_TIMEOUT_MS", 500),
    commandTimeout: numberEnv("REDIS_COMMAND_TIMEOUT_MS", 800)
  });

  client.on("error", () => {
    globalRedis.__stockAiRedisUnavailableUntil = Date.now() + REDIS_RETRY_COOLDOWN_MS;
  });

  globalRedis.__stockAiRedisClient = client;
  return client;
}

export async function ensureRedisReady(client: Redis) {
  const status = client.status as string;
  if (status === "ready") return true;
  if (status === "wait" || status === "end") {
    await client.connect();
    return true;
  }
  return status === "connect" || status === "connecting" || status === "ready";
}

export function redisKey(key: string) {
  return `${process.env.REDIS_KEY_PREFIX || "stock-ai"}:${key}`;
}

export function markRedisUnavailable() {
  globalRedis.__stockAiRedisUnavailableUntil = Date.now() + REDIS_RETRY_COOLDOWN_MS;
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
