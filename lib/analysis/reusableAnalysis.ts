import { prisma } from "@/lib/prisma";
import { stockSymbolVariants } from "@/lib/symbols";

export async function findReusableAnalysisByContextHash(
  userId: string,
  symbol: string,
  contextHash: string
) {
  const rows = await prisma.aiAnalysis.findMany({
    where: { userId, symbol: { in: stockSymbolVariants(symbol) } },
    orderBy: { createdAt: "desc" },
    take: 20
  });
  return rows.find((row) => {
    const input = row.inputJson as { contextHash?: string } | null;
    return input?.contextHash === contextHash && !isFallbackAnalysis(row.outputJson);
  }) ?? null;
}

function isFallbackAnalysis(outputJson: unknown) {
  const output = outputJson as { isFallback?: boolean } | null;
  return Boolean(output?.isFallback);
}
