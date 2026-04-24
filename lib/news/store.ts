import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { NewsAnalysisResult, NewsItem } from "@/lib/types";

export function newsTitleHash(title: string, source?: string | null, publishedAt?: string | Date | null) {
  const day = publishedAt ? new Date(publishedAt).toISOString().slice(0, 10) : "";
  return createHash("sha256").update(`${title.trim().toLowerCase()}|${source ?? ""}|${day}`).digest("hex");
}

export async function upsertNewsItem(item: NewsItem) {
  const publishedAt = item.publishedAt ? new Date(item.publishedAt) : new Date();
  const titleHash = newsTitleHash(item.title, item.source, publishedAt);
  const createData = {
    title: item.title,
    titleHash,
    url: item.url ?? null,
    source: item.source ?? null,
    publishedAt,
    rawContent: item.rawContent ?? null,
    summary: item.summary ?? null,
    symbols: uniqueUpper(item.symbols ?? []),
    sectors: uniqueText(item.sectors ?? []),
    sentiment: null,
    importance: null
  };

  return prisma.$transaction(async (tx) => {
    const existing = await tx.newsItem.findFirst({
      where: {
        OR: [{ titleHash }, ...(item.url ? [{ url: item.url }] : [])]
      }
    });

    if (!existing) {
      return tx.newsItem.create({ data: createData });
    }

    return tx.newsItem.update({
      where: { id: existing.id },
      data: {
        title: item.title,
        url: existing.url ?? item.url ?? null,
        source: item.source ?? existing.source,
        publishedAt,
        rawContent: item.rawContent ?? existing.rawContent,
        summary: item.summary ?? existing.summary,
        symbols: uniqueUpper([...existing.symbols, ...(item.symbols ?? [])]),
        sectors: uniqueText([...existing.sectors, ...(item.sectors ?? [])])
      }
    });
  });
}

export async function saveNewsAnalysis(newsItemId: string, analysis: NewsAnalysisResult) {
  return prisma.$transaction(async (tx) => {
    const saved = await tx.newsAnalysis.create({
      data: {
        newsItemId,
        aiSummary: analysis.summary,
        sentiment: analysis.sentiment,
        affectedSymbols: uniqueUpper(analysis.affectedSymbols),
        affectedSectors: uniqueText(analysis.affectedSectors),
        impactLevel: analysis.impactLevel,
        riskNotes: analysis.riskNotes,
        whyItMatters: analysis.whyItMatters,
        confidence: analysis.confidence
      }
    });

    await tx.newsItem.update({
      where: { id: newsItemId },
      data: {
        summary: analysis.summary,
        sentiment: analysis.sentiment,
        importance: analysis.impactLevel,
        symbols: uniqueUpper(analysis.affectedSymbols),
        sectors: uniqueText(analysis.affectedSectors)
      }
    });

    return saved;
  });
}

export function serializeNewsItem<
  T extends {
    publishedAt: Date;
    createdAt: Date;
    analyses?: Array<{ createdAt: Date; confidence?: Prisma.Decimal | null } & Record<string, unknown>>;
  } & Record<string, unknown>
>(item: T) {
  return {
    ...item,
    publishedAt: item.publishedAt.toISOString(),
    createdAt: item.createdAt.toISOString(),
    analyses: item.analyses?.map((analysis) => ({
      ...analysis,
      confidence: analysis.confidence === null || analysis.confidence === undefined ? null : Number(analysis.confidence),
      createdAt: analysis.createdAt.toISOString()
    }))
  };
}

function uniqueUpper(values: string[]) {
  return [...new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean))];
}

function uniqueText(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
