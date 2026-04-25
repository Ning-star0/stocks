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
    title: limitText(item.title, 300),
    titleHash,
    url: item.url ?? null,
    source: item.source ?? null,
    publishedAt,
    rawContent: item.rawContent ? limitText(item.rawContent, 2000) : null,
    summary: item.summary ? limitText(item.summary, 600) : null,
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
        title: limitText(item.title, 300),
        url: existing.url ?? item.url ?? null,
        source: item.source ?? existing.source,
        publishedAt,
        rawContent: item.rawContent ? limitText(item.rawContent, 2000) : existing.rawContent,
        summary: item.summary ? limitText(item.summary, 600) : existing.summary,
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
    publishedAt: Date | string | number | null;
    createdAt: Date | string | number | null;
    analyses?: Array<{ createdAt?: Date | string | number | null; confidence?: Prisma.Decimal | number | string | null } & Record<string, unknown>>;
  } & Record<string, unknown>
>(item: T) {
  return {
    ...item,
    publishedAt: toIsoString(item.publishedAt),
    createdAt: toIsoString(item.createdAt),
    analyses: item.analyses?.map((analysis) => ({
      ...analysis,
      confidence: analysis.confidence === null || analysis.confidence === undefined ? null : Number(analysis.confidence),
      createdAt: toIsoString(analysis.createdAt)
    }))
  };
}

function limitText(value: string, maxLength: number) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned;
}

function toIsoString(value: Date | string | number | null | undefined) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function uniqueUpper(values: string[]) {
  return [...new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean))];
}

function uniqueText(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
