type ImportanceNewsItem = {
  title: string;
  source?: string | null;
  publishedAt?: string | Date | null;
  rawContent?: string | null;
  summary?: string | null;
  symbols?: string[];
  duplicate?: boolean;
};

const trustedSources = ["reuters", "ap", "cnbc", "bloomberg", "wsj", "financial times"];

export function calculateNewsImportance(newsItem: ImportanceNewsItem, userSymbols: string[] = []) {
  const title = newsItem.title.toLowerCase();
  const source = newsItem.source?.toLowerCase() ?? "";
  const content = `${newsItem.rawContent ?? ""} ${newsItem.summary ?? ""}`.trim();
  const symbols = newsItem.symbols ?? [];
  const userSymbolSet = new Set(userSymbols.map((symbol) => symbol.toUpperCase()));
  const reasons: string[] = [];
  let score = 0;

  score += match(title, ["earnings", "revenue", "profit", "guidance"], 5, reasons, "earnings/revenue/profit/guidance");
  score += match(title, ["upgrade", "downgrade", "price target"], 5, reasons, "analyst rating or price target");
  score += match(title, ["sec", "lawsuit", "investigation", "probe"], 4, reasons, "regulatory/legal risk");
  score += match(title, ["merger", "acquisition", "buyout"], 4, reasons, "deal activity");
  score += match(title, ["ceo", "cfo", "resignation"], 3, reasons, "executive change");

  if (trustedSources.some((trusted) => source.includes(trusted))) {
    score += 3;
    reasons.push("trusted source");
  }

  if (symbols.some((symbol) => userSymbolSet.has(symbol.toUpperCase()))) {
    score += 2;
    reasons.push("in user watchlist");
  }

  if (newsItem.publishedAt && Date.now() - new Date(newsItem.publishedAt).getTime() <= 24 * 60 * 60 * 1000) {
    score += 2;
    reasons.push("published within 24h");
  }

  if (newsItem.duplicate) {
    score -= 5;
    reasons.push("duplicate news");
  }

  if (source && ["blog", "forum", "unknown", "mock"].some((low) => source.includes(low))) {
    score -= 2;
    reasons.push("lower quality source");
  }

  if (content.length > 0 && content.length < 160) {
    score -= 2;
    reasons.push("content too short");
  }

  return {
    score,
    level: score >= 7 ? "high" : score >= 4 ? "medium" : "low",
    reasons
  } as const;
}

function match(title: string, terms: string[], points: number, reasons: string[], reason: string) {
  if (!terms.some((term) => title.includes(term))) return 0;
  reasons.push(reason);
  return points;
}

