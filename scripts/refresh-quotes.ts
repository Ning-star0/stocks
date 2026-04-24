import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

loadDotEnv();

async function main() {
  const [{ mapWithConcurrency }, { setCache }, { prisma }, { getStockDataProvider }] = await Promise.all([
    import("@/lib/concurrency/pLimit"),
    import("@/lib/cache"),
    import("@/lib/prisma"),
    import("@/lib/stock-data")
  ]);
  const items = await prisma.watchlistItem.findMany({ select: { symbol: true }, distinct: ["symbol"], take: numberEnv("MAX_BATCH_SYMBOLS", 50) });
  const provider = getStockDataProvider();
  const results = await mapWithConcurrency(items, numberEnv("MAX_EXTERNAL_API_CONCURRENT", 2), async (item) => {
    const quote = await provider.getQuote(item.symbol);
    await setCache(`quote:${item.symbol}`, quote, numberEnv("QUOTE_CACHE_TTL_SECONDS", 30));
    return item.symbol;
  });
  console.log(JSON.stringify({ refreshed: results.length, symbols: results }, null, 2));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[refresh-quotes] fatal", error);
  process.exitCode = 1;
});

function loadDotEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    if (!process.env[key]) process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

