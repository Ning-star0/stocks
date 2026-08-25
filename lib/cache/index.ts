import type { Prisma } from "@prisma/client";

import { ensureRedisReady, getRedisClient, markRedisUnavailable, redisKey } from "@/lib/cache/redis";
import { prisma } from "@/lib/prisma";

type MemoryEntry = {
  value: unknown;
  expiresAt: number;
  size: number;
};

const globalCache = globalThis as unknown as {
  __stockAiMemoryCache?: Map<string, MemoryEntry>;
  __stockAiMemoryCacheBytes?: number;
  __stockAiInFlightCache?: Map<string, Promise<unknown>>;
};

const memoryCache = globalCache.__stockAiMemoryCache ?? new Map<string, MemoryEntry>();
globalCache.__stockAiMemoryCache = memoryCache;
globalCache.__stockAiMemoryCacheBytes ??= 0;
const inFlightCache = globalCache.__stockAiInFlightCache ?? new Map<string, Promise<unknown>>();
globalCache.__stockAiInFlightCache = inFlightCache;

const maxKeys = numberEnv("IN_MEMORY_CACHE_MAX_KEYS", 500);
const maxBytes = numberEnv("IN_MEMORY_CACHE_MAX_MB", 64) * 1024 * 1024;
const maxValueBytes = Math.min(512 * 1024, Math.max(64 * 1024, Math.floor(maxBytes / 64)));

export async function getCache<T>(key: string): Promise<T | null> {
  const memory = memoryCache.get(key);
  if (memory && memory.expiresAt > Date.now()) {
    memoryCache.delete(key);
    memoryCache.set(key, memory);
    return memory.value as T;
  }
  if (memory) deleteMemoryKey(key);

  const redis = await readRedisCache<T>(key);
  if (redis !== null) return redis;

  try {
    const row = await prisma.cacheEntry.findUnique({ where: { key } });
    if (!row || row.expiresAt.getTime() <= Date.now()) {
      return null;
    }
    putMemory(key, row.value, row.expiresAt.getTime());
    void writeRedisCache(key, row.value, Math.max(1, Math.floor((row.expiresAt.getTime() - Date.now()) / 1000)));
    return row.value as T;
  } catch {
    return null;
  }
}

export async function setCache<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const cacheValue = stripLargeFields(value);
  putMemory(key, cacheValue, expiresAt.getTime());
  const redisWritten = await writeRedisCache(key, cacheValue, ttlSeconds);

  if (redisWritten) void writeDbCache(key, cacheValue, expiresAt);
  else await writeDbCache(key, cacheValue, expiresAt);
}

export async function deleteCache(key: string): Promise<void> {
  deleteMemoryKey(key);
  await deleteRedisCache(key);

  try {
    await prisma.cacheEntry.deleteMany({ where: { key } });
  } catch {
    // Cache deletion is best effort; DB errors are fine.
  }
}

export async function remember<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  return (await rememberWithStatus(key, ttlSeconds, fn)).value;
}

export async function rememberWithStatus<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>
): Promise<{ value: T; source: "cache" | "fresh" | "in_flight" }> {
  const cached = await getCache<T>(key);
  if (cached !== null) return { value: cached, source: "cache" };

  return coalesceInFlight(key, async () => {
    const value = await fn();
    await setCache(key, value, ttlSeconds);
    return value;
  });
}

export async function coalesceInFlight<T>(
  key: string,
  fn: () => Promise<T>
): Promise<{ value: T; source: "fresh" | "in_flight" }> {
  const inFlight = inFlightCache.get(key) as Promise<T> | undefined;
  if (inFlight) return { value: await inFlight, source: "in_flight" };

  const pending = fn();
  inFlightCache.set(key, pending);
  try {
    return { value: await pending, source: "fresh" };
  } finally {
    if (inFlightCache.get(key) === pending) inFlightCache.delete(key);
  }
}

export async function deleteExpiredCache(): Promise<void> {
  const now = Date.now();
  for (const [key, entry] of memoryCache.entries()) {
    if (entry.expiresAt <= now) deleteMemoryKey(key);
  }

  try {
    await prisma.cacheEntry.deleteMany({
      where: { expiresAt: { lt: new Date() } }
    });
  } catch {
    // Ignore DB cleanup failure; cache is best effort.
  }
}

function putMemory(key: string, value: unknown, expiresAt: number) {
  const size = estimateSize(value);
  if (size > maxValueBytes) return;

  if (memoryCache.has(key)) deleteMemoryKey(key);
  memoryCache.set(key, { value, expiresAt, size });
  globalCache.__stockAiMemoryCacheBytes = (globalCache.__stockAiMemoryCacheBytes ?? 0) + size;
  evictIfNeeded();
}

function deleteMemoryKey(key: string) {
  const entry = memoryCache.get(key);
  if (!entry) return;
  memoryCache.delete(key);
  globalCache.__stockAiMemoryCacheBytes = Math.max(0, (globalCache.__stockAiMemoryCacheBytes ?? 0) - entry.size);
}

function evictIfNeeded() {
  while (memoryCache.size > maxKeys || (globalCache.__stockAiMemoryCacheBytes ?? 0) > maxBytes) {
    const oldest = memoryCache.keys().next().value as string | undefined;
    if (!oldest) break;
    deleteMemoryKey(oldest);
  }
}

function estimateSize(value: unknown) {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return maxValueBytes + 1;
  }
}

function stripLargeFields(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object" && typeof (value as { toJSON?: unknown }).toJSON === "function") {
    return (value as { toJSON: () => unknown }).toJSON();
  }
  if (Array.isArray(value)) return value.map(stripLargeFields);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (key === "rawContent") continue;
    output[key] = stripLargeFields(nestedValue);
  }
  return output;
}

async function readRedisCache<T>(key: string): Promise<T | null> {
  const client = getRedisClient();
  if (!client) return null;

  try {
    if (!(await ensureRedisReady(client))) return null;
    const namespacedKey = redisKey(key);
    const raw = await client.get(namespacedKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as T;
    const ttlMs = await client.pttl(namespacedKey);
    putMemory(key, value, ttlMs > 0 ? Date.now() + ttlMs : Date.now() + 1000);
    return value;
  } catch {
    markRedisUnavailable();
    return null;
  }
}

async function writeRedisCache(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
  const client = getRedisClient();
  if (!client) return false;

  try {
    if (!(await ensureRedisReady(client))) return false;
    await client.set(redisKey(key), JSON.stringify(value), "EX", Math.max(1, Math.floor(ttlSeconds)));
    return true;
  } catch {
    markRedisUnavailable();
    return false;
  }
}

async function deleteRedisCache(key: string): Promise<void> {
  const client = getRedisClient();
  if (!client) return;

  try {
    if (!(await ensureRedisReady(client))) return;
    await client.del(redisKey(key));
  } catch {
    markRedisUnavailable();
  }
}

async function writeDbCache(key: string, value: unknown, expiresAt: Date): Promise<void> {
  try {
    await prisma.cacheEntry.upsert({
      where: { key },
      update: { value: value as Prisma.InputJsonValue, expiresAt },
      create: { key, value: value as Prisma.InputJsonValue, expiresAt }
    });
  } catch {
    // Cache is best effort. Memory/Redis keep hot paths usable when DB cache writes fail.
  }
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
