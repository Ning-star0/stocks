import { setDefaultResultOrder } from "node:dns";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

setDefaultResultOrder("ipv4first");
loadDotEnv();

async function main() {
  const [
    { createAnalysisRun },
    { enqueueJob },
    { JOB_PRIORITY, JOB_TYPES },
    { prisma },
    { getStockDataProvider },
    { MARKET_DATA_REVISION },
    { compareBacktestPresets },
    { saveStrategyHealthGates, STRATEGY_GATE_POLICY_VERSION }
  ] = await Promise.all([
    import("@/lib/analysis/runRecords"),
    import("@/lib/jobs/enqueueJob"),
    import("@/lib/jobs/jobTypes"),
    import("@/lib/prisma"),
    import("@/lib/stock-data"),
    import("@/lib/stock-data/corporateActions"),
    import("@/lib/strategy/backtest"),
    import("@/lib/strategy/gate")
  ]);

  const enqueueAnalysis = !process.argv.includes("--no-enqueue");
  const groups = await prisma.focusGroup.findMany({
    where: { symbols: { isEmpty: false } },
    select: { id: true, userId: true, capital: true, symbols: true }
  });
  const provider = getStockDataProvider();
  const report: Array<Record<string, unknown>> = [];

  // Old cache rows are no longer addressable because the revision is part of
  // every new key. Removing the DB copies keeps diagnostics and storage tidy;
  // Redis copies expire naturally and cannot be read by the new version.
  const deletedCaches = await prisma.cacheEntry.deleteMany({
    where: {
      OR: [
        { key: { startsWith: "strategy_health:" } },
        { key: { startsWith: "ai_analysis:v5:" } },
        { key: { startsWith: "focus_decision:" } }
      ]
    }
  });

  for (const group of groups) {
    const capital = Number(group.capital);
    const symbols = [...new Set(group.symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
    if (!Number.isFinite(capital) || capital <= 0 || !symbols.length) continue;

    const comparisons = [];
    const failed: Array<{ symbol: string; error: string }> = [];
    for (const symbol of symbols) {
      try {
        const candles = await provider.getHistory(symbol, "2y", "1d", { forceRefresh: true });
        comparisons.push(compareBacktestPresets({ symbol, candles, initialCapital: capital, range: "2y" }));
      } catch (error) {
        failed.push({ symbol, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (comparisons.length) await saveStrategyHealthGates({ userId: group.userId, capital, comparisons });

    let runId: string | null = null;
    if (enqueueAnalysis) {
      const run = await createAnalysisRun({ userId: group.userId, runType: "scheduled", totalSymbols: symbols.length });
      runId = run.id;
      const repairKey = `${MARKET_DATA_REVISION}:${Date.now()}:${group.id}`;
      await enqueueJob({
        userId: group.userId,
        jobType: JOB_TYPES.FOCUS_STOCK_BATCH,
        priority: JOB_PRIORITY.SCHEDULED_REFRESH,
        inputHash: `strategy_repair_batch:${repairKey}`,
        payload: { reason: `行情复权修复后强制重算 ${MARKET_DATA_REVISION}`, runId, symbols, scheduledFor: new Date().toISOString() }
      });
      await enqueueJob({
        userId: group.userId,
        jobType: JOB_TYPES.FOCUS_DECISION,
        priority: JOB_PRIORITY.FOCUS_DECISION,
        inputHash: `strategy_repair_decision:${repairKey}`,
        payload: { reason: `行情复权修复后重新生成策略观察 ${MARKET_DATA_REVISION}`, runId, scheduledFor: new Date().toISOString() }
      });
    }

    report.push({
      groupId: group.id,
      symbolCount: symbols.length,
      rebuiltGates: comparisons.length,
      failed,
      runId
    });
  }

  console.log(JSON.stringify({
    marketDataRevision: MARKET_DATA_REVISION,
    gatePolicyVersion: STRATEGY_GATE_POLICY_VERSION,
    deletedDbCaches: deletedCaches.count,
    enqueueAnalysis,
    groups: report
  }, null, 2));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[strategy-repair] fatal", error);
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
