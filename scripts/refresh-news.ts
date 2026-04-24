import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

loadDotEnv();

async function main() {
  const [{ getNewsProvider }, { enqueueJob }, { JOB_PRIORITY, JOB_TYPES }, { calculateNewsImportance }, { upsertNewsItem }, { prisma }] = await Promise.all([
    import("@/lib/news"),
    import("@/lib/jobs/enqueueJob"),
    import("@/lib/jobs/jobTypes"),
    import("@/lib/news/importance"),
    import("@/lib/news/store"),
    import("@/lib/prisma")
  ]);
  const user = await prisma.user.findFirst();
  if (!user) {
    console.log(JSON.stringify({ fetched: 0, queued: 0, reason: "no_user" }));
    return;
  }
  const provider = getNewsProvider();
  const symbols = (await prisma.watchlistItem.findMany({ where: { watchlist: { userId: user.id } }, select: { symbol: true }, distinct: ["symbol"], take: 50 })).map((item) => item.symbol);
  const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const to = new Date().toISOString();
  let fetched = 0;
  let queued = 0;
  for (const symbol of symbols) {
    for (const item of await provider.searchCompanyNews(symbol, from, to)) {
      fetched += 1;
      const row = await upsertNewsItem(item);
      const importance = calculateNewsImportance({ ...item, symbols: row.symbols }, symbols);
      await prisma.newsItem.update({ where: { id: row.id }, data: { importance: importance.level } });
      if (importance.level === "high") {
        await enqueueJob({ userId: user.id, symbol, jobType: JOB_TYPES.NEWS_ANALYSIS, priority: JOB_PRIORITY.HIGH_IMPORTANCE_NEWS, inputHash: `news:${row.id}`, payload: { newsItemId: row.id } });
        queued += 1;
      }
    }
  }
  console.log(JSON.stringify({ fetched, queued }, null, 2));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[refresh-news] fatal", error);
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

