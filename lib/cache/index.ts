import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

type MemoryEntry = {
  value: unknown;
  expiresAt: number;
  size: number;
};

const globalCache = globalThis as unknown as {
  __stockAiMemoryCache?: Map<string, MemoryEntry>;
  __stockAiMemoryCacheBytes?: number;
};

const memoryCache = globalCache.__stockAiMemoryCache ?? new Map<string, MemoryEntry>();
globalCache.__stockAiMemoryCache = memoryCache;
globalCache.__stockAiMemoryCacheBytes ??= 0;

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

  try {
    const row = await prisma.cacheEntry.findUnique({ where: { key } });
    if (!row || row.expiresAt.getTime() <= Date.now()) {
      if (row) await prisma.cacheEntry.delete({ where: { key } }).catch(() => undefined);
      return null;
    }
    putMemory(key, row.value, row.expiresAt.getTime());
    return row.value as T;
  } catch {
    return null;
  }
}

export async function setCache<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  putMemory(key, value, expiresAt.getTime());

  try {
    await prisma.cacheEntry.upsert({
      where: { key },
      update: { value: value as Prisma.InputJsonValue, expiresAt },
      create: { key, value: value as Prisma.InputJsonValue, expiresAt }
    });
  } catch {
    // Memory cache fallback keeps local development usable without Redis or DB cache.
  }
}

export async function deleteCache(key: string): Promise<void> {
  deleteMemoryKey(key);

  try {
    await prisma.cacheEntry.delete({ where: { key } });
  } catch {
    // Cache deletion is best effort; a missing DB row is fine.
  }
}

export async function remember<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  const cached = await getCache<T>(key);
  if (cached !== null) return cached;
  const value = await fn();
  await setCache(key, value, ttlSeconds);
  return value;
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
  memoryCache.set(key, { value: stripLargeFields(value), expiresAt, size });
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
  if (Array.isArray(value)) return value.map(stripLargeFields);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (key === "rawContent") continue;
    output[key] = stripLargeFields(nestedValue);
  }
  return output;
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
