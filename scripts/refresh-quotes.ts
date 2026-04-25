import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

loadDotEnv();

async function main() {
  const [{ mapWithConcurrency }, { setCache }, { MARKET_INDICES }, { prisma }, { getStockDataProvider }] = await Promise.all([
    import("@/lib/concurrency/pLimit"),
    import("@/lib/cache"),
    import("@/lib/marketIndices"),
    import("@/lib/prisma"),
    import("@/lib/stock-data")
  ]);
  const items = await prisma.watchlistItem.findMany({ select: { symbol: true }, distinct: ["symbol"], take: numberEnv("MAX_BATCH_SYMBOLS", 50) });
  const symbols = [...new Set([...items.map((item) => item.symbol), ...MARKET_INDICES.map((item) => item.symbol)])];
  const provider = getStockDataProvider();
  const results = await mapWithConcurrency(symbols, numberEnv("MAX_EXTERNAL_API_CONCURRENT", 2), async (symbol) => {
    const quote = await provider.getQuote(symbol);
    await setCache(`quote:${quote.symbol}`, quote, numberEnv("QUOTE_CACHE_TTL_SECONDS", 30));
    if (quote.symbol !== symbol) await setCache(`quote:${symbol}`, quote, numberEnv("QUOTE_CACHE_TTL_SECONDS", 30));
    return quote.symbol;
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
