import { setDefaultResultOrder } from "node:dns";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

setDefaultResultOrder("ipv4first");
loadDotEnv();

async function main() {
  const [{ getNewsProvider }, { createNewsRequestContext }, { createNewsBatchContext, searchSharedTopicNews }, { buildSectorNewsKeywords, buildStockNewsKeywords, resolveSharedSectorTopic }, { enqueueJob }, { JOB_PRIORITY, JOB_TYPES }, { calculateNewsImportance }, { upsertNewsItem }, { prisma }, { getQuote }, { deleteCache }, { needsSimplifiedChineseSummary }] = await Promise.all([
    import("@/lib/news"),
    import("@/lib/news/NewsProvider"),
    import("@/lib/news/batchCoordinator"),
    import("@/lib/news/relevance"),
    import("@/lib/jobs/enqueueJob"),
    import("@/lib/jobs/jobTypes"),
    import("@/lib/news/importance"),
    import("@/lib/news/store"),
    import("@/lib/prisma"),
    import("@/lib/services/quoteService"),
    import("@/lib/cache"),
    import("@/lib/text/simplifiedChinese")
  ]);
  const user = await prisma.user.findFirst();
  if (!user) {
    console.log(JSON.stringify({ fetched: 0, queued: 0, reason: "no_user" }));
    return;
  }
  const provider = getNewsProvider();
  const [symbols, sectorWatches] = await Promise.all([
    prisma.watchlistItem
      .findMany({ where: { watchlist: { userId: user.id } }, select: { symbol: true }, distinct: ["symbol"], take: 50 })
      .then((items) => items.map((item) => item.symbol)),
    prisma.sectorWatch.findMany({ where: { userId: user.id }, take: 20 })
  ]);
  const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const to = new Date().toISOString();
  let fetched = 0;
  let queued = 0;
  const newsBatch = createNewsBatchContext();
  for (const symbol of symbols) {
    const context = createNewsRequestContext({ userId: user.id, symbol, priority: "routine", requestBatchId: newsBatch.id });
    const items = await provider.searchCompanyNews(symbol, from, to, context);
    const name = await resolveSymbolName(getQuote, symbol);
    if (name) {
      const keywords = buildStockNewsKeywords({ symbol, name });
      const sectorKeywords = buildSectorNewsKeywords({ symbol, name, extraKeywords: keywords });
      const sharedTopic = resolveSharedSectorTopic(sectorKeywords);
      const namedItems = sharedTopic
        ? await searchSharedTopicNews({
            batch: newsBatch,
            key: sharedTopic.key,
            context,
            load: () => provider.searchTopicNews(sharedTopic.keywords, from, to, context)
          })
        : await provider.searchTopicNews([name], from, to, context);
      items.push(...namedItems.map((item) => attachSymbol(item, symbol, name)));
    }

    for (const item of items) {
      fetched += 1;
      const row = await upsertNewsItem(item);
      const importance = calculateNewsImportance({ ...item, symbols: row.symbols }, symbols);
      await prisma.newsItem.update({ where: { id: row.id }, data: { importance: importance.level } });
      const needsTranslation = importance.level === "medium" && needsSimplifiedChineseSummary(`${row.title} ${row.summary ?? ""}`);
      if (importance.level === "high" || needsTranslation) {
        await enqueueJob({
          userId: user.id,
          symbol,
          jobType: JOB_TYPES.NEWS_ANALYSIS,
          priority: importance.level === "high" ? JOB_PRIORITY.HIGH_IMPORTANCE_NEWS : JOB_PRIORITY.SCHEDULED_REFRESH,
          inputHash: `news:${row.id}`,
          payload: { newsItemId: row.id, reason: importance.level === "high" ? "high_importance_news" : "translate_foreign_news_summary" }
        });
        queued += 1;
      }
    }
    await deleteCache(`news:${symbol}:24h`);
  }

  for (const watch of sectorWatches) {
    const context = createNewsRequestContext({ userId: user.id, symbol: watch.symbols[0], priority: "routine", requestBatchId: newsBatch.id });
    const sharedTopic = resolveSharedSectorTopic([watch.sectorName, ...watch.keywords]);
    const topicItems = sharedTopic
      ? await searchSharedTopicNews({
          batch: newsBatch,
          key: sharedTopic.key,
          context,
          load: () => provider.searchTopicNews(sharedTopic.keywords, from, to, context)
        })
      : await provider.searchTopicNews(watch.keywords, from, to, context);
    for (const item of topicItems.map((newsItem) => attachSectorWatch(newsItem, watch.sectorName, watch.keywords, watch.symbols))) {
      fetched += 1;
      const row = await upsertNewsItem(item);
      const importance = calculateNewsImportance({ ...item, symbols: row.symbols }, symbols);
      await prisma.newsItem.update({ where: { id: row.id }, data: { importance: importance.level } });
      const needsTranslation = importance.level === "medium" && needsSimplifiedChineseSummary(`${row.title} ${row.summary ?? ""}`);
      if (importance.level === "high" || needsTranslation) {
        const symbol = row.symbols[0] ?? null;
        await enqueueJob({
          userId: user.id,
          symbol,
          jobType: JOB_TYPES.NEWS_ANALYSIS,
          priority: importance.level === "high" ? JOB_PRIORITY.HIGH_IMPORTANCE_NEWS : JOB_PRIORITY.SCHEDULED_REFRESH,
          inputHash: `news:${row.id}`,
          payload: { newsItemId: row.id, reason: importance.level === "high" ? "high_importance_news" : "translate_foreign_news_summary" }
        });
        queued += 1;
      }
      await Promise.all(row.symbols.map((symbol) => deleteCache(`news:${symbol}:24h`)));
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

async function resolveSymbolName(
  getQuote: (symbol: string, options?: { allowStale?: boolean }) => Promise<{ name?: string | null }>,
  symbol: string
) {
  try {
    const quote = await getQuote(symbol, { allowStale: true });
    const name = quote.name?.trim();
    if (!name || name.toUpperCase() === symbol.toUpperCase()) return null;
    if (name.includes("模拟")) return null;
    return name;
  } catch {
    return null;
  }
}

function attachSymbol<T extends { symbols?: string[]; sectors?: string[] }>(item: T, symbol: string, sectorName?: string) {
  return {
    ...item,
    symbols: uniqueUpper([...(item.symbols ?? []), symbol]),
    sectors: uniqueText([...(item.sectors ?? []), ...(sectorName ? [sectorName] : [])])
  };
}

function attachSectorWatch<T extends { symbols?: string[]; sectors?: string[] }>(item: T, sectorName: string, keywords: string[], symbols: string[]) {
  return {
    ...item,
    symbols: uniqueUpper([...(item.symbols ?? []), ...symbols]),
    sectors: uniqueText([...(item.sectors ?? []), sectorName, ...keywords])
  };
}

function uniqueUpper(values: string[]) {
  return [...new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean))];
}

function uniqueText(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
