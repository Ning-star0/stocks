import { createHash } from "node:crypto";

import { PDFParse } from "pdf-parse";

import type { DisclosureEvidence, DisclosureEvidenceItem } from "@/lib/stock-data/types";

const DEFAULT_MAX_DOCUMENTS = 6;
const DEFAULT_MAX_PDF_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_EXCERPT_CHARS = 6_000;
const MIN_USEFUL_TEXT_CHARS = 120;
const RISK_TERMS = [
  "重大风险",
  "风险提示",
  "营业收入",
  "购建固定资产、无形资产和其他长期资产支付的现金",
  "经营活动产生的现金流量净额",
  "净利润",
  "可能存在",
  "不确定性",
  "立案",
  "处罚",
  "警示函",
  "问询",
  "诉讼",
  "仲裁",
  "质押",
  "减持",
  "退市",
  "异常波动",
  "重大合同",
  "重大资产重组"
];

export async function enrichDisclosureContent(
  evidence: DisclosureEvidence,
  previous?: DisclosureEvidence | null
): Promise<DisclosureEvidence> {
  if (evidence.status !== "checked") return evidence;

  const previousById = new Map((previous?.items ?? []).map((item) => [item.id, item]));
  const reused = evidence.items.map((item) => reuseExtractedContent(item, previousById.get(item.id)));
  const maxDocuments = positiveIntegerEnv("DISCLOSURE_MAX_PDF_PER_REFRESH", DEFAULT_MAX_DOCUMENTS);
  const candidateIds = new Set(
    reused
      .filter((item) => item.isCritical && item.contentStatus === "metadata_only")
      .sort(compareDisclosurePriority)
      .slice(0, maxDocuments)
      .map((item) => item.id)
  );
  const failures: string[] = [...evidence.failures];
  const items: DisclosureEvidenceItem[] = [];

  // PDF 解析会短时占用较多内存；低配部署中故意串行处理。
  for (const item of reused) {
    if (!candidateIds.has(item.id)) {
      items.push(item);
      continue;
    }
    const enriched = await extractDisclosureItem(item).catch((error) => ({
      ...item,
      extractionFailure: errorMessage(error)
    }));
    if (enriched.extractionFailure) failures.push(`${item.title}：${enriched.extractionFailure}`);
    items.push(enriched);
  }

  return {
    ...evidence,
    items,
    criticalUnreadCount: items.filter((item) => item.isCritical && item.contentStatus === "metadata_only").length,
    failures: uniqueStrings(failures)
  };
}

export async function extractDisclosureItem(item: DisclosureEvidenceItem): Promise<DisclosureEvidenceItem> {
  if (!isAllowedCninfoPdfUrl(item.sourceUrl)) {
    return { ...item, extractionFailure: "公告原文 URL 不属于巨潮官方 PDF 白名单。" };
  }
  const data = await downloadPdf(item.sourceUrl);
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    const text = normalizePdfText(result.text ?? "");
    if (text.length < MIN_USEFUL_TEXT_CHARS) {
      return { ...item, extractionFailure: "PDF 未提取到足够的可读文本，可能是扫描件或受保护文件。" };
    }
    return {
      ...item,
      contentStatus: "extracted",
      contentHash: createHash("sha256").update(text).digest("hex"),
      contentExcerpt: buildDisclosureRiskExcerpt(text),
      extractedCharacters: text.length,
      extractionFailure: null
    };
  } finally {
    await parser.destroy();
  }
}

export function isAllowedCninfoPdfUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "static.cninfo.com.cn"
      && /^\/finalpage\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9_-]+\.PDF$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function buildDisclosureRiskExcerpt(rawText: string, maxChars = MAX_EXCERPT_CHARS) {
  const text = normalizePdfText(rawText);
  if (text.length <= maxChars) return text;
  const sections = [text.slice(0, Math.min(1_800, maxChars))];
  const seen = new Set<string>();
  for (const term of RISK_TERMS) {
    const index = bestTermIndex(text, term);
    if (index < 0) continue;
    const start = Math.max(0, index - 260);
    const end = Math.min(text.length, index + term.length + 620);
    const section = text.slice(start, end).trim();
    const key = section.slice(0, 120);
    if (section && !seen.has(key)) {
      seen.add(key);
      sections.push(section);
    }
    if (sections.join("\n\n").length >= maxChars) break;
  }
  return sections.join("\n\n--- 风险相关原文片段 ---\n\n").slice(0, maxChars);
}

function bestTermIndex(text: string, term: string) {
  let bestIndex = -1;
  let bestScore = -1;
  let from = 0;
  for (let count = 0; count < 20; count += 1) {
    const index = text.indexOf(term, from);
    if (index < 0) break;
    const window = text.slice(Math.max(0, index - 160), Math.min(text.length, index + term.length + 420));
    const score = (window.match(/\d[\d,.%]*/g) ?? []).length;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
    from = index + term.length;
  }
  return bestIndex;
}

function reuseExtractedContent(current: DisclosureEvidenceItem, previous: DisclosureEvidenceItem | undefined) {
  if (!previous || previous.sourceUrl !== current.sourceUrl || previous.contentStatus === "metadata_only" || !previous.contentHash) return current;
  return {
    ...current,
    contentStatus: previous.contentStatus,
    contentHash: previous.contentHash,
    contentExcerpt: previous.contentExcerpt,
    extractedCharacters: previous.extractedCharacters,
    extractionFailure: null
  };
}

async function downloadPdf(url: string) {
  const maxBytes = positiveIntegerEnv("DISCLOSURE_MAX_PDF_BYTES", DEFAULT_MAX_PDF_BYTES);
  const timeoutMs = positiveIntegerEnv("DISCLOSURE_PDF_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const response = await fetch(url, {
    headers: {
      Referer: "https://www.cninfo.com.cn/",
      "User-Agent": "Mozilla/5.0 StockAI/1.0",
      Accept: "application/pdf"
    },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`公告 PDF 下载失败：HTTP ${response.status}`);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType && !contentType.includes("pdf") && !contentType.includes("octet-stream")) {
    throw new Error(`公告原文类型不是 PDF：${contentType}`);
  }
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    throw new Error(`公告 PDF 超过 ${formatMb(maxBytes)} MB 安全上限。`);
  }
  if (!response.body) throw new Error("公告 PDF 响应缺少正文。");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error(`公告 PDF 超过 ${formatMb(maxBytes)} MB 安全上限。`);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (data.length < 5 || new TextDecoder("ascii").decode(data.slice(0, 5)) !== "%PDF-") {
    throw new Error("公告响应未通过 PDF 文件头校验。");
  }
  return data;
}

function compareDisclosurePriority(a: DisclosureEvidenceItem, b: DisclosureEvidenceItem) {
  const score = (item: DisclosureEvidenceItem) => {
    if (item.category === "regulatory" || item.category === "risk_notice" || item.category === "litigation") return 0;
    if (item.category === "earnings") return 1;
    if (item.category === "major_contract" || item.category === "capital_action") return 2;
    if (item.category === "periodic_report" && !/摘要/.test(item.title)) return 3;
    return 4;
  };
  return score(a) - score(b) || b.publishedAt.localeCompare(a.publishedAt);
}

function normalizePdfText(value: string) {
  return value
    .replace(/\u0000/g, "")
    .replace(/[\t\f\v]+/g, " ")
    .replace(/ +/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function positiveIntegerEnv(name: string, fallback: number) {
  const value = Math.floor(Number(process.env[name]));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function formatMb(bytes: number) {
  return Math.round(bytes / (1024 * 1024));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
