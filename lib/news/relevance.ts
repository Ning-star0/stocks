import type { NewsItem } from "@/lib/types";

const fundSuffixTerms = [
  "ETF",
  "LOF",
  "QDII",
  "基金",
  "联接",
  "指数",
  "增强",
  "国泰",
  "华夏",
  "易方达",
  "南方",
  "嘉实",
  "广发",
  "富国",
  "招商",
  "博时",
  "汇添富",
  "天弘",
  "银华",
  "鹏华"
];

const sectorAliases: Array<{ match: string[]; aliases: string[] }> = [
  { match: ["电网", "电力设备", "电气设备"], aliases: ["电网设备", "智能电网", "特高压", "输变电", "配电网", "电力设备", "国家电网", "南方电网"] },
  { match: ["芯片", "半导体"], aliases: ["芯片", "半导体", "集成电路", "晶圆", "算力", "AI芯片"] },
  { match: ["新能源车", "电动车", "汽车"], aliases: ["新能源汽车", "电动车", "动力电池", "智能汽车", "车企"] },
  { match: ["银行"], aliases: ["银行", "信贷", "息差", "存款", "贷款", "金融监管"] },
  { match: ["能源", "煤炭", "石油"], aliases: ["能源", "煤炭", "油气", "原油", "电力"] },
  { match: ["医药", "医疗"], aliases: ["医药", "创新药", "医疗器械", "医保", "药企"] }
];

export function buildStockNewsKeywords(input: { symbol: string; name?: string | null; extraKeywords?: string[] }) {
  const output = new Set<string>();
  const compactSymbol = compactCode(input.symbol);
  if (compactSymbol) output.add(compactSymbol);

  const rawName = input.name?.trim();
  if (rawName && rawName.toUpperCase() !== input.symbol.toUpperCase()) {
    output.add(rawName);
    const core = cleanStockName(rawName);
    if (core) output.add(core);
    for (const token of splitNameTokens(core || rawName)) output.add(token);
  }

  for (const keyword of input.extraKeywords ?? []) {
    const clean = keyword.trim();
    if (clean) output.add(clean);
  }

  const joined = [...output].join(" ");
  for (const group of sectorAliases) {
    if (group.match.some((keyword) => joined.includes(keyword))) {
      for (const alias of group.aliases) output.add(alias);
    }
  }

  return [...output].map((item) => item.trim()).filter((item) => item.length >= 2).slice(0, 12);
}

export function isNewsRelevantToStock(
  item: NewsItem | ({ title: string; summary?: string | null; rawContent?: string | null; symbols?: string[] | null; sectors?: string[] | null } & Record<string, unknown>),
  input: { symbol: string; name?: string | null; keywords?: string[] }
) {
  const keywords = input.keywords?.length ? input.keywords : buildStockNewsKeywords({ symbol: input.symbol, name: input.name });
  const text = normalizeText(`${item.title ?? ""} ${item.summary ?? ""} ${item.rawContent ?? ""}`);
  const compactSymbol = compactCode(input.symbol);

  if (compactSymbol && text.includes(compactSymbol.toLowerCase())) return true;
  return keywords.some((keyword) => normalizeText(keyword).length >= 2 && text.includes(normalizeText(keyword)));
}

export function filterRelevantNewsForStock<T extends NewsItem>(
  items: T[],
  input: { symbol: string; name?: string | null; keywords?: string[] }
) {
  return items.filter((item) => isNewsRelevantToStock(item, input));
}

export function cleanStockName(name: string) {
  let output = name.trim();
  for (const term of fundSuffixTerms) {
    output = output.replace(new RegExp(term, "gi"), "");
  }
  return output.replace(/[（）()Ａ-ＺA-Z0-9.\-\s]+$/g, "").trim();
}

function splitNameTokens(name: string) {
  const normalized = name.replace(/[（）()A-Za-z0-9.\-\s]/g, " ").trim();
  const tokens = normalized.split(/[\s、，,]+/).filter(Boolean);
  const output = new Set(tokens);
  if (normalized.length >= 4) output.add(normalized.slice(0, 4));
  return [...output];
}

function compactCode(symbol: string) {
  return symbol.trim().toUpperCase().replace(/\.(SH|SZ|BJ|HK)$/i, "").replace(/^(SH|SZ|BJ|HK)/i, "");
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, "");
}
