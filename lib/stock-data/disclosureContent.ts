import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { PDFParse } from "pdf-parse";

import { parseAdjustedNetIncomeDisclosureFact } from "@/lib/stock-data/adjustedNetIncomeEvidence";
import type { DisclosureEvidence, DisclosureEvidenceItem } from "@/lib/stock-data/types";

const DEFAULT_MAX_DOCUMENTS = 6;
const DEFAULT_MIN_FUNDAMENTAL_DOCUMENTS = 3;
const DEFAULT_MAX_PDF_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_OCR_MAX_PAGES = 24;
const DEFAULT_OCR_DESIRED_WIDTH = 1_800;
const DEFAULT_OCR_MAX_RENDERED_BYTES = 64 * 1024 * 1024;
const DEFAULT_OCR_MAX_TOTAL_PIXELS = 120_000_000;
const DEFAULT_OCR_PAGE_TIMEOUT_MS = 15_000;
const DEFAULT_OCR_TOTAL_TIMEOUT_MS = 90_000;
const MAX_EXCERPT_CHARS = 6_000;
const MIN_USEFUL_TEXT_CHARS = 120;
const MIN_USEFUL_PAGE_TEXT_CHARS = 20;
const CONTENT_EXTRACTOR_VERSION = "pdfparse-tesseract-v1";
const OCR_LANGUAGES = ["chi_sim", "eng"];
const execFileAsync = promisify(execFile);

type PdfParserLike = {
  getText(): Promise<{
    text: string;
    total: number;
    pages: Array<{ num: number; text: string }>;
  }>;
  getScreenshot(input: {
    partial: number[];
    desiredWidth: number;
    imageBuffer: true;
    imageDataUrl: false;
  }): Promise<{
    total: number;
    pages: Array<{ data: Uint8Array; pageNumber: number; width: number; height: number }>;
  }>;
  destroy(): Promise<void>;
};

export type ExtractedDisclosurePdfText = {
  text: string;
  extraction: NonNullable<DisclosureEvidenceItem["contentExtraction"]>;
};

export type DisclosurePdfTextDependencies = {
  createParser?: (data: Uint8Array) => PdfParserLike;
  ocrPage?: (image: Uint8Array, pageNumber: number, timeoutMs: number) => Promise<{
    text: string;
    engine: string;
    languages: string[];
  }>;
  ocrEnabled?: boolean;
  maxOcrPages?: number;
  desiredWidth?: number;
  maxRenderedBytes?: number;
  maxTotalPixels?: number;
  pageTimeoutMs?: number;
  totalTimeoutMs?: number;
};

export type DisclosureItemExtractionDependencies = {
  download?: (url: string) => Promise<Uint8Array>;
  extractText?: (data: Uint8Array) => Promise<ExtractedDisclosurePdfText>;
};
const RISK_TERMS = [
  "重大风险",
  "风险提示",
  "营业收入",
  "购建固定资产、无形资产和其他长期资产支付的现金",
  "经营活动产生的现金流量净额",
  "净利润",
  "归属于上市公司股东的扣除非经常性损益的净利润",
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
  const fundamentalSlots = Math.min(maxDocuments, positiveIntegerEnv(
    "DISCLOSURE_MIN_FUNDAMENTAL_PDF_PER_REFRESH",
    DEFAULT_MIN_FUNDAMENTAL_DOCUMENTS
  ));
  const candidateIds = selectDisclosureExtractionCandidateIds(reused, maxDocuments, fundamentalSlots);
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

export function selectDisclosureExtractionCandidateIds(
  items: DisclosureEvidenceItem[],
  maxDocuments: number,
  fundamentalSlots: number
) {
  const pending = items.filter((item) => (item.isCritical || item.isFundamentalSource) && item.contentStatus === "metadata_only");
  const reservedFundamentalIds = pending
    .filter((item) => item.isFundamentalSource)
    .sort((a, b) => Number(Boolean(a.extractionFailure)) - Number(Boolean(b.extractionFailure))
      || b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, Math.min(maxDocuments, fundamentalSlots))
    .map((item) => item.id);
  return new Set([
    ...reservedFundamentalIds,
    ...pending
      .filter((item) => !reservedFundamentalIds.includes(item.id))
      .sort(compareDisclosurePriority)
      .slice(0, maxDocuments - reservedFundamentalIds.length)
      .map((item) => item.id)
  ]);
}

export async function extractDisclosureItem(
  item: DisclosureEvidenceItem,
  dependencies: DisclosureItemExtractionDependencies = {}
): Promise<DisclosureEvidenceItem> {
  if (!isAllowedCninfoPdfUrl(item.sourceUrl)) {
    return { ...item, extractionFailure: "公告原文 URL 不属于巨潮官方 PDF 白名单。" };
  }
  const data = await (dependencies.download ?? downloadPdf)(item.sourceUrl);
  const extracted = await (dependencies.extractText ?? extractDisclosurePdfText)(data);
  const contentHash = createHash("sha256").update(extracted.text).digest("hex");
  return {
    ...item,
    contentStatus: "extracted",
    contentHash,
    contentExcerpt: buildDisclosureRiskExcerpt(extracted.text),
    extractedCharacters: extracted.text.length,
    extractionFailure: null,
    contentExtraction: extracted.extraction,
    adjustedNetIncomeFact: item.category === "periodic_report"
      ? parseAdjustedNetIncomeDisclosureFact({ title: item.title, text: extracted.text })
      : null
  };
}

export async function extractDisclosurePdfText(
  data: Uint8Array,
  dependencies: DisclosurePdfTextDependencies = {}
): Promise<ExtractedDisclosurePdfText> {
  const parser = dependencies.createParser?.(data) ?? new PDFParse({ data }) as unknown as PdfParserLike;
  try {
    const result = await parser.getText();
    const totalPages = positiveInteger(result.total);
    if (!totalPages) throw new Error("PDF 未返回有效页数，无法确认原文覆盖范围。");
    const embeddedByPage = new Map(result.pages.map((page) => [page.num, normalizePdfText(page.text ?? "")]));
    const embeddedText = normalizePdfText(result.text ?? "");
    const pagesNeedingOcr = Array.from({ length: totalPages }, (_, index) => index + 1)
      .filter((pageNumber) => (embeddedByPage.get(pageNumber)?.length ?? 0) < MIN_USEFUL_PAGE_TEXT_CHARS);
    const embeddedDocumentIsUseful = embeddedText.length >= MIN_USEFUL_TEXT_CHARS;

    if (embeddedDocumentIsUseful && !pagesNeedingOcr.length) {
      return {
        text: embeddedText,
        extraction: {
          schemaVersion: "disclosure-content-extraction-v1",
          extractorVersion: CONTENT_EXTRACTOR_VERSION,
          method: "embedded_text",
          coverage: "full_document",
          totalPages,
          extractedPages: totalPages,
          ocrPages: 0,
          ocrEngine: null,
          ocrLanguages: []
        }
      };
    }

    const ocrEnabled = dependencies.ocrEnabled ?? booleanEnv("DISCLOSURE_OCR_ENABLED", true);
    if (!ocrEnabled) throw new Error("PDF 嵌入文本不足且扫描件 OCR 已禁用，原文保持未读。");
    const ocrPages = embeddedDocumentIsUseful
      ? pagesNeedingOcr
      : Array.from({ length: totalPages }, (_, index) => index + 1);
    const maxOcrPages = dependencies.maxOcrPages
      ?? positiveIntegerEnv("DISCLOSURE_OCR_MAX_PAGES", DEFAULT_OCR_MAX_PAGES);
    if (ocrPages.length > maxOcrPages) {
      throw new Error(`PDF 需要 OCR 的页面为 ${ocrPages.length} 页，超过 ${maxOcrPages} 页安全上限；禁止用部分页面冒充完整原文。`);
    }

    const ocrResult = await withOcrSlot(() => ocrMissingPages(parser, embeddedByPage, totalPages, ocrPages, dependencies));
    const recognizedText = normalizePdfText(ocrResult.pages
      .map((page) => page.text)
      .filter(Boolean)
      .join("\n\n"));
    if (recognizedText.length < MIN_USEFUL_TEXT_CHARS) {
      throw new Error(`扫描件 OCR 全文仅识别 ${recognizedText.length}/${MIN_USEFUL_TEXT_CHARS} 个实际正文字符，原文保持未读。`);
    }
    // 页码用于审计页面顺序，但不能计入最低正文字符门槛。
    const text = normalizePdfText(ocrResult.pages.map((page) => page.text
      ? `${page.text}\n\n-- 第 ${page.pageNumber}/${totalPages} 页 --`
      : `-- 第 ${page.pageNumber}/${totalPages} 页：空白或未识别到文字 --`).join("\n\n"));
    return {
      text,
      extraction: {
        schemaVersion: "disclosure-content-extraction-v1",
        extractorVersion: CONTENT_EXTRACTOR_VERSION,
        method: ocrPages.length === totalPages ? "ocr" : "hybrid_ocr",
        coverage: "full_document",
        totalPages,
        extractedPages: totalPages,
        ocrPages: ocrPages.length,
        ocrEngine: ocrResult.engine,
        ocrLanguages: ocrResult.languages
      }
    };
  } finally {
    await parser.destroy();
  }
}

async function ocrMissingPages(
  parser: PdfParserLike,
  embeddedByPage: Map<number, string>,
  totalPages: number,
  ocrPages: number[],
  dependencies: DisclosurePdfTextDependencies
) {
  const desiredWidth = dependencies.desiredWidth
    ?? boundedIntegerEnv("DISCLOSURE_OCR_RENDER_WIDTH", DEFAULT_OCR_DESIRED_WIDTH, 1_000, 2_400);
  const maxRenderedBytes = dependencies.maxRenderedBytes
    ?? positiveIntegerEnv("DISCLOSURE_OCR_MAX_RENDERED_BYTES", DEFAULT_OCR_MAX_RENDERED_BYTES);
  const maxTotalPixels = dependencies.maxTotalPixels
    ?? positiveIntegerEnv("DISCLOSURE_OCR_MAX_TOTAL_PIXELS", DEFAULT_OCR_MAX_TOTAL_PIXELS);
  const pageTimeoutMs = dependencies.pageTimeoutMs
    ?? positiveIntegerEnv("DISCLOSURE_OCR_PAGE_TIMEOUT_MS", DEFAULT_OCR_PAGE_TIMEOUT_MS);
  const totalTimeoutMs = dependencies.totalTimeoutMs
    ?? positiveIntegerEnv("DISCLOSURE_OCR_TOTAL_TIMEOUT_MS", DEFAULT_OCR_TOTAL_TIMEOUT_MS);
  const ocrPage = dependencies.ocrPage ?? runTesseractOcrPage;
  if (!dependencies.ocrPage) await getTesseractRuntime();
  const ocrPageSet = new Set(ocrPages);
  const deadline = Date.now() + totalTimeoutMs;
  const pages: Array<{ pageNumber: number; text: string }> = [];
  let renderedBytes = 0;
  let renderedPixels = 0;
  let engine = "Tesseract";
  let languages = [...OCR_LANGUAGES];

  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
    if (!ocrPageSet.has(pageNumber)) {
      pages.push({ pageNumber, text: embeddedByPage.get(pageNumber) ?? "" });
      continue;
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error(`扫描件 OCR 超过 ${totalTimeoutMs}ms 总时限，原文保持未读。`);
    const screenshot = await parser.getScreenshot({
      partial: [pageNumber],
      desiredWidth,
      imageBuffer: true,
      imageDataUrl: false
    });
    const page = screenshot.pages[0];
    if (!page?.data?.length || page.pageNumber !== pageNumber) {
      throw new Error(`PDF 第 ${pageNumber} 页未生成有效 OCR 图像。`);
    }
    renderedBytes += page.data.byteLength;
    renderedPixels += page.width * page.height;
    if (renderedBytes > maxRenderedBytes) {
      throw new Error(`OCR 渲染图像累计超过 ${formatMb(maxRenderedBytes)} MB 安全上限。`);
    }
    if (page.width <= 0 || page.height <= 0 || page.width * page.height > maxTotalPixels || renderedPixels > maxTotalPixels) {
      throw new Error(`OCR 渲染像素累计超过 ${maxTotalPixels} 安全上限。`);
    }
    const receipt = await ocrPage(page.data, pageNumber, Math.max(1, Math.min(pageTimeoutMs, remainingMs)));
    engine = receipt.engine;
    languages = receipt.languages;
    pages.push({ pageNumber, text: normalizePdfText(receipt.text) });
  }
  return { pages, engine, languages };
}

async function runTesseractOcrPage(image: Uint8Array, pageNumber: number, timeoutMs: number) {
  const runtime = await getTesseractRuntime();
  const directory = await mkdtemp(join(tmpdir(), "stocks-disclosure-ocr-"));
  const imagePath = join(directory, `page-${String(pageNumber).padStart(3, "0")}.png`);
  try {
    await writeFile(imagePath, image);
    const { stdout } = await execFileAsync(runtime.binary, [
      imagePath,
      "stdout",
      "-l",
      OCR_LANGUAGES.join("+"),
      "--psm",
      "3"
    ], {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      env: process.env
    });
    return {
      text: String(stdout ?? ""),
      engine: runtime.engine,
      languages: [...OCR_LANGUAGES]
    };
  } catch (error) {
    if (isTimeoutError(error)) throw new Error(`Tesseract 第 ${pageNumber} 页 OCR 超过 ${timeoutMs}ms 时限。`);
    throw new Error(`Tesseract 第 ${pageNumber} 页 OCR 失败：${errorMessage(error)}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const ocrGlobal = globalThis as unknown as {
  __stockDisclosureOcrQueue?: Promise<void>;
  __stockTesseractRuntime?: Promise<{ binary: string; engine: string }>;
};

async function withOcrSlot<T>(work: () => Promise<T>) {
  const previous = ocrGlobal.__stockDisclosureOcrQueue ?? Promise.resolve();
  let release = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  ocrGlobal.__stockDisclosureOcrQueue = queued;
  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
    if (ocrGlobal.__stockDisclosureOcrQueue === queued) delete ocrGlobal.__stockDisclosureOcrQueue;
  }
}

async function getTesseractRuntime() {
  if (ocrGlobal.__stockTesseractRuntime) return ocrGlobal.__stockTesseractRuntime;
  const binary = process.env.DISCLOSURE_TESSERACT_BIN?.trim() || "tesseract";
  const pending = (async () => {
    try {
      const [version, languageList] = await Promise.all([
        execFileAsync(binary, ["--version"], { encoding: "utf8", timeout: 5_000, maxBuffer: 512 * 1024, windowsHide: true }),
        execFileAsync(binary, ["--list-langs"], { encoding: "utf8", timeout: 5_000, maxBuffer: 512 * 1024, windowsHide: true })
      ]);
      const availableLanguages = String(languageList.stdout ?? "")
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean);
      const missingLanguages = OCR_LANGUAGES.filter((language) => !availableLanguages.includes(language));
      if (missingLanguages.length) throw new Error(`缺少 OCR 语言包：${missingLanguages.join("、")}`);
      const engine = String(version.stdout ?? version.stderr ?? "Tesseract")
        .split(/\r?\n/)[0]
        .trim() || "Tesseract";
      return { binary, engine };
    } catch (error) {
      throw new Error(`扫描件 OCR 运行时不可用：${errorMessage(error)}`);
    }
  })();
  ocrGlobal.__stockTesseractRuntime = pending;
  try {
    return await pending;
  } catch (error) {
    delete ocrGlobal.__stockTesseractRuntime;
    throw error;
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
  if (!previous || previous.sourceUrl !== current.sourceUrl) return current;
  if (previous.contentStatus === "metadata_only" || !previous.contentHash) {
    return { ...current, extractionFailure: previous.extractionFailure, contentExtraction: previous.contentExtraction ?? null };
  }
  if (
    previous.contentExtraction
    && previous.contentExtraction.method !== "embedded_text"
    && previous.contentExtraction.extractorVersion !== CONTENT_EXTRACTOR_VERSION
  ) {
    return current;
  }
  return {
    ...current,
    contentStatus: previous.contentStatus,
    contentHash: previous.contentHash,
    contentExcerpt: previous.contentExcerpt,
    extractedCharacters: previous.extractedCharacters,
    extractionFailure: null,
    contentExtraction: previous.contentExtraction ?? {
      schemaVersion: "disclosure-content-extraction-v1",
      extractorVersion: "legacy-pdfparse-v1",
      method: "embedded_text",
      coverage: "full_document",
      totalPages: null,
      extractedPages: null,
      ocrPages: 0,
      ocrEngine: null,
      ocrLanguages: []
    },
    adjustedNetIncomeFact: previous.adjustedNetIncomeFact
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
  return Number(Boolean(a.extractionFailure)) - Number(Boolean(b.extractionFailure))
    || score(a) - score(b)
    || b.publishedAt.localeCompare(a.publishedAt);
}

function normalizePdfText(value: string) {
  return value
    .replace(/\u0000/g, "")
    .replace(/[\t\f\v]+/g, " ")
    .replace(/ +/g, " ")
    .replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function positiveIntegerEnv(name: string, fallback: number) {
  const value = Math.floor(Number(process.env[name]));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function boundedIntegerEnv(name: string, fallback: number, minimum: number, maximum: number) {
  const value = positiveIntegerEnv(name, fallback);
  return Math.min(maximum, Math.max(minimum, value));
}

function booleanEnv(name: string, fallback: boolean) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

function formatMb(bytes: number) {
  return Math.round(bytes / (1024 * 1024));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}

function isTimeoutError(error: unknown) {
  return Boolean(error && typeof error === "object" && (
    (error as { killed?: unknown }).killed === true
    || (error as { signal?: unknown }).signal === "SIGTERM"
    || (error as { code?: unknown }).code === "ETIMEDOUT"
  ));
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
