import { createHash } from "node:crypto";

import type { NewsIndustryClassificationEvidence } from "@/lib/news/industryClassification";
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

const sectorAliases: Array<{ key: string; match: string[]; aliases: string[] }> = [
  { key: "power-grid", match: ["电网", "电力设备", "电气设备"], aliases: ["电网设备", "智能电网", "特高压", "输变电", "配电网", "电力设备", "国家电网", "南方电网"] },
  { key: "semiconductor", match: ["芯片", "半导体"], aliases: ["芯片", "半导体", "集成电路", "晶圆", "算力", "AI芯片"] },
  { key: "telecom", match: ["通信", "通信设备", "5G"], aliases: ["通信设备", "5G", "光模块", "光通信", "算力网络", "运营商", "数据中心"] },
  { key: "new-energy-auto", match: ["新能源车", "电动车", "汽车"], aliases: ["新能源汽车", "电动车", "动力电池", "智能汽车", "车企"] },
  { key: "banking", match: ["银行"], aliases: ["银行", "信贷", "息差", "存款", "贷款", "金融监管"] },
  { key: "energy", match: ["能源", "煤炭", "石油"], aliases: ["能源", "煤炭", "油气", "原油", "电力"] },
  { key: "healthcare", match: ["医药", "医疗"], aliases: ["医药", "创新药", "医疗器械", "医保", "药企"] }
];

const catalystTerms = [
  "招标",
  "采购",
  "中标",
  "订单",
  "合同",
  "项目",
  "投资",
  "扩产",
  "并网",
  "改造",
  "政策",
  "补贴",
  "规划",
  "十四五",
  "十五五",
  "业绩",
  "营收",
  "利润",
  "预告",
  "指引",
  "并购",
  "重组",
  "特高压",
  "配电网",
  "输变电",
  "国家电网",
  "南方电网"
];

const lowValueMarketTerms = [
  "涨幅",
  "跌幅",
  "上涨",
  "下跌",
  "收涨",
  "收跌",
  "涨超",
  "跌超",
  "盘中",
  "异动",
  "净值",
  "估值",
  "成交额",
  "成交量",
  "资金流入",
  "资金流出",
  "换手率"
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

export function buildSectorNewsKeywords(input: { symbol: string; name?: string | null; extraKeywords?: string[] }) {
  const output = new Set<string>();
  const rawName = input.name?.trim();
  const coreName = rawName ? cleanStockName(rawName) : "";
  const baseKeywords = buildStockNewsKeywords(input);
  const joined = [...baseKeywords, coreName, ...(input.extraKeywords ?? [])].join(" ");

  for (const keyword of [...baseKeywords, ...(input.extraKeywords ?? [])]) {
    const clean = keyword.trim();
    if (!clean || /^\d+$/.test(clean)) continue;
    if (isFundSuffixTerm(clean)) continue;
    output.add(clean);
  }
  if (coreName && !/^\d+$/.test(coreName)) output.add(coreName);

  for (const group of sectorAliases) {
    if (group.match.some((keyword) => joined.includes(keyword)) || group.aliases.some((keyword) => joined.includes(keyword))) {
      for (const alias of group.aliases) output.add(alias);
    }
  }

  return [...output].map((item) => item.trim()).filter((item) => item.length >= 2).slice(0, 16);
}

export function resolveSharedSectorTopic(
  keywords: string[],
  industryClassification?: NewsIndustryClassificationEvidence | null
) {
  const joined = normalizeText(keywords.join(" "));
  const group = sectorAliases.find((item) =>
    [...item.match, ...item.aliases].some((keyword) => joined.includes(normalizeText(keyword)))
  );
  if (group) {
    return {
      key: `sector-topic-v1:${group.key}`,
      keywords: uniqueText([...group.match, ...group.aliases]).slice(0, 5),
      source: "alias_map_v1" as const,
      classificationEvidenceHash: industryClassification?.status === "verified"
        ? industryClassification.evidenceHash
        : null
    };
  }
  if (industryClassification?.status !== "verified" || !industryClassification.industryName) return null;
  const normalizedIndustry = normalizeText(industryClassification.industryName);
  const industryKey = createHash("sha256").update(normalizedIndustry).digest("hex").slice(0, 16);
  return {
    key: `sector-topic-v2:eastmoney-em2016:${industryKey}`,
    // TianAPI currently consumes one topic keyword by default, so the verified
    // provider industry must remain first and stock-specific names stay out.
    keywords: [industryClassification.industryName],
    source: "verified_industry_v1" as const,
    classificationEvidenceHash: industryClassification.evidenceHash
  };
}

export function isLowValueMarketMoveNews(
  item: NewsItem | ({ title: string; summary?: string | null; rawContent?: string | null } & Record<string, unknown>)
) {
  const text = normalizeText(`${item.title ?? ""} ${item.summary ?? ""} ${item.rawContent ?? ""}`);
  const hasMarketMove = lowValueMarketTerms.some((term) => text.includes(normalizeText(term))) || /[涨跌][0-9.]+%/.test(text);
  if (!hasMarketMove) return false;
  return !catalystTerms.some((term) => text.includes(normalizeText(term)));
}

export function scoreNewsCatalyst(
  item: NewsItem | ({ title: string; summary?: string | null; rawContent?: string | null; sectors?: string[] | null } & Record<string, unknown>),
  keywords: string[] = []
) {
  const text = normalizeText(`${item.title ?? ""} ${item.summary ?? ""} ${item.rawContent ?? ""}`);
  let score = 0;
  for (const term of catalystTerms) {
    if (text.includes(normalizeText(term))) score += 3;
  }
  for (const keyword of keywords) {
    const normalized = normalizeText(keyword);
    if (normalized.length >= 2 && text.includes(normalized)) score += 1;
  }
  if (isLowValueMarketMoveNews(item)) score -= 8;
  return score;
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

function isFundSuffixTerm(value: string) {
  return fundSuffixTerms.some((term) => term.toLowerCase() === value.toLowerCase());
}

function compactCode(symbol: string) {
  return symbol.trim().toUpperCase().replace(/\.(SH|SZ|BJ|HK)$/i, "").replace(/^(SH|SZ|BJ|HK)/i, "");
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, "");
}

function uniqueText(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
