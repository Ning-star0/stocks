type ImportanceNewsItem = {
  title: string;
  source?: string | null;
  publishedAt?: string | Date | null;
  rawContent?: string | null;
  summary?: string | null;
  symbols?: string[];
  duplicate?: boolean;
};

const trustedSources = [
  "reuters",
  "ap",
  "cnbc",
  "bloomberg",
  "wsj",
  "financial times",
  "新华社",
  "财联社",
  "证券时报",
  "上海证券报",
  "中国证券报",
  "第一财经",
  "经济观察报",
  "澎湃",
  "东方财富",
  "同花顺"
];

const lowQualitySources = ["blog", "forum", "unknown", "mock", "股吧", "论坛", "博客", "自媒体"];

export function calculateNewsImportance(newsItem: ImportanceNewsItem, userSymbols: string[] = []) {
  const title = newsItem.title.toLowerCase();
  const source = newsItem.source?.toLowerCase() ?? "";
  const content = `${newsItem.rawContent ?? ""} ${newsItem.summary ?? ""}`.trim();
  const symbols = newsItem.symbols ?? [];
  const userSymbolSet = new Set(userSymbols.map((symbol) => symbol.toUpperCase()));
  const reasons: string[] = [];
  let score = 0;

  score += match(title, ["earnings", "revenue", "profit", "guidance", "业绩", "营收", "利润", "净利润", "预告", "指引", "亏损", "增长", "下滑"], 5, reasons, "earnings/revenue/profit/guidance");
  score += match(title, ["upgrade", "downgrade", "price target", "上调", "下调", "评级", "目标价", "券商"], 5, reasons, "analyst rating or price target");
  score += match(title, ["sec", "lawsuit", "investigation", "probe", "证监会", "监管", "处罚", "立案", "调查", "诉讼", "风险警示"], 4, reasons, "regulatory/legal risk");
  score += match(title, ["merger", "acquisition", "buyout", "并购", "收购", "重组", "合并", "定增", "回购"], 4, reasons, "deal activity");
  score += match(title, ["ceo", "cfo", "resignation", "董事长", "总经理", "辞职", "离任", "高管"], 3, reasons, "executive change");

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

  if (source && lowQualitySources.some((low) => source.includes(low))) {
    score -= 2;
    reasons.push("lower quality source");
  }

  if (`${newsItem.title} ${content}`.trim().length > 0 && `${newsItem.title} ${content}`.trim().length < 40) {
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
