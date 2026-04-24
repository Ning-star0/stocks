import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

loadDotEnv();

async function main() {
  const [{ evaluateAllActiveAlerts }, { updateAllWatchlistMarketData }, { prisma }] = await Promise.all([
    import("@/lib/alerts/evaluateAlerts"),
    import("@/lib/market-data"),
    import("@/lib/prisma")
  ]);

  const startedAt = new Date();
  console.log(`[update-prices] 开始 ${startedAt.toISOString()}`);

  try {
    const marketResults = await updateAllWatchlistMarketData();
    const okCount = marketResults.filter((result) => result.ok).length;
    const failed = marketResults.filter((result) => !result.ok);

    for (const result of marketResults) {
      if (result.ok) {
        console.log(`[update-prices] ${result.symbol} price=${result.data.quote.price} rsi14=${result.data.indicators.rsi14 ?? "n/a"}`);
      } else {
        console.warn(`[update-prices] ${result.symbol} 失败：${result.error}`);
      }
    }

    const alertResults = await evaluateAllActiveAlerts();
    const triggeredCount = alertResults.filter((result) => result.triggered).length;

    console.log(
      JSON.stringify(
        {
          updated: okCount,
          failed: failed.length,
          evaluatedAlerts: alertResults.length,
          triggeredAlerts: triggeredCount,
          durationMs: Date.now() - startedAt.getTime()
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[update-prices] 致命错误", error);
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
    const value = rawValue.replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}
