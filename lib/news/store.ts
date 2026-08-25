import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { toSimplifiedChinese } from "@/lib/text/simplifiedChinese";
import type { NewsAnalysisResult, NewsItem } from "@/lib/types";

export function newsTitleHash(title: string, source?: string | null, publishedAt?: string | Date | null) {
  const day = publishedAt ? new Date(publishedAt).toISOString().slice(0, 10) : "";
  return createHash("sha256").update(`${title.trim().toLowerCase()}|${source ?? ""}|${day}`).digest("hex");
}

export async function upsertNewsItem(item: NewsItem) {
  const publishedAt = item.publishedAt ? new Date(item.publishedAt) : new Date();
  const titleHash = newsTitleHash(item.title, item.source, publishedAt);
  const createData = {
    title: limitText(toSimplifiedChinese(item.title), 300),
    titleHash,
    url: item.url ?? null,
    source: item.source ? toSimplifiedChinese(item.source) : null,
    publishedAt,
    rawContent: item.rawContent ? limitText(toSimplifiedChinese(item.rawContent), 2000) : null,
    summary: item.summary ? limitText(toSimplifiedChinese(item.summary), 600) : null,
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
        title: limitText(toSimplifiedChinese(item.title), 300),
        url: existing.url ?? item.url ?? null,
        source: item.source ? toSimplifiedChinese(item.source) : existing.source,
        publishedAt,
        rawContent: item.rawContent ? limitText(toSimplifiedChinese(item.rawContent), 2000) : existing.rawContent,
        summary: item.summary ? limitText(toSimplifiedChinese(item.summary), 600) : existing.summary,
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
        aiSummary: toSimplifiedChinese(analysis.summary),
        sentiment: analysis.sentiment,
        affectedSymbols: uniqueUpper(analysis.affectedSymbols),
        affectedSectors: uniqueText(analysis.affectedSectors.map(toSimplifiedChinese)),
        impactLevel: analysis.impactLevel,
        riskNotes: analysis.riskNotes.map(toSimplifiedChinese),
        whyItMatters: analysis.whyItMatters ? toSimplifiedChinese(analysis.whyItMatters) : null,
        confidence: analysis.confidence,
        eventContextJson: JSON.parse(JSON.stringify(analysis.eventContext)) as Prisma.InputJsonValue,
        isFallback: analysis.isFallback,
        fallbackReason: analysis.fallbackReason ? toSimplifiedChinese(analysis.fallbackReason) : null
      }
    });

    const newsItem = await tx.newsItem.findUnique({
      where: { id: newsItemId },
      select: { symbols: true, sectors: true, importance: true }
    });
    await tx.newsItem.update({
      where: { id: newsItemId },
      data: {
        summary: analysis.isFallback ? undefined : toSimplifiedChinese(analysis.summary),
        sentiment: analysis.isFallback ? undefined : analysis.sentiment,
        importance: analysis.isFallback ? newsItem?.importance : strongerImpact(newsItem?.importance, analysis.impactLevel),
        symbols: uniqueUpper([...(newsItem?.symbols ?? []), ...analysis.affectedSymbols]),
        sectors: uniqueText([...(newsItem?.sectors ?? []), ...analysis.affectedSectors.map(toSimplifiedChinese)])
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
    title: typeof item.title === "string" ? toSimplifiedChinese(item.title) : item.title,
    source: typeof item.source === "string" ? toSimplifiedChinese(item.source) : item.source,
    summary: typeof item.summary === "string" ? toSimplifiedChinese(item.summary) : item.summary,
    rawContent: typeof item.rawContent === "string" ? toSimplifiedChinese(item.rawContent) : item.rawContent,
    sectors: Array.isArray(item.sectors) ? item.sectors.map((sector) => (typeof sector === "string" ? toSimplifiedChinese(sector) : sector)) : item.sectors,
    publishedAt: toIsoString(item.publishedAt),
    createdAt: toIsoString(item.createdAt),
    analyses: item.analyses?.map((analysis) => ({
      ...analysis,
      aiSummary: typeof analysis.aiSummary === "string" ? toSimplifiedChinese(analysis.aiSummary) : analysis.aiSummary,
      affectedSectors: Array.isArray(analysis.affectedSectors)
        ? analysis.affectedSectors.map((sector) => (typeof sector === "string" ? toSimplifiedChinese(sector) : sector))
        : analysis.affectedSectors,
      riskNotes: Array.isArray(analysis.riskNotes) ? analysis.riskNotes.map((note) => (typeof note === "string" ? toSimplifiedChinese(note) : note)) : analysis.riskNotes,
      whyItMatters: typeof analysis.whyItMatters === "string" ? toSimplifiedChinese(analysis.whyItMatters) : analysis.whyItMatters,
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

function strongerImpact(existing: string | null | undefined, analyzed: string) {
  const rank: Record<string, number> = { low: 1, medium: 2, high: 3 };
  return (rank[existing ?? ""] ?? 0) >= (rank[analyzed] ?? 0) ? existing ?? analyzed : analyzed;
}
