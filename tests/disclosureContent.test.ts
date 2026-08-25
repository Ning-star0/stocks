import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDisclosureRiskExcerpt,
  enrichDisclosureContent,
  extractDisclosurePdfText,
  extractDisclosureItem,
  isAllowedCninfoPdfUrl,
  selectDisclosureExtractionCandidateIds
} from "@/lib/stock-data/disclosureContent";
import type { DisclosureEvidence, DisclosureEvidenceItem } from "@/lib/stock-data/types";

test("announcement PDF download only accepts the exact CNINFO finalpage allowlist", () => {
  assert.equal(isAllowedCninfoPdfUrl("https://static.cninfo.com.cn/finalpage/2026-08-20/1234567890.PDF"), true);
  assert.equal(isAllowedCninfoPdfUrl("http://static.cninfo.com.cn/finalpage/2026-08-20/1234567890.PDF"), false);
  assert.equal(isAllowedCninfoPdfUrl("https://evil.example/finalpage/2026-08-20/1234567890.PDF"), false);
  assert.equal(isAllowedCninfoPdfUrl("https://static.cninfo.com.cn/other/1234567890.PDF"), false);
});

test("long disclosures retain the opening and risk-related original text", () => {
  const text = `公告开头：本公司保证披露真实准确完整。${"一般说明。".repeat(700)}重大风险：公司收到监管警示函，相关事项存在不确定性。${"后续说明。".repeat(700)}`;
  const excerpt = buildDisclosureRiskExcerpt(text, 2_600);

  assert.ok(excerpt.startsWith("公告开头"));
  assert.ok(excerpt.includes("重大风险"));
  assert.ok(excerpt.includes("监管警示函"));
  assert.ok(excerpt.length <= 2_600);
});

test("an unread historical report progresses before repeatedly failed PDFs", () => {
  const failed = disclosureItem("failed-latest", true, false, "扫描件不可读", "2026-08-20T00:00:00.000Z");
  const untried = disclosureItem("untried-older", true, false, null, "2026-04-20T00:00:00.000Z");
  const critical = disclosureItem("critical-risk", false, true, null, "2026-08-19T00:00:00.000Z");
  const selected = selectDisclosureExtractionCandidateIds([failed, untried, critical], 2, 1);

  assert.deepEqual([...selected].sort(), ["critical-risk", "untried-older"]);
});

test("embedded PDF text records full-document extraction without invoking OCR", async () => {
  let ocrCalls = 0;
  const extracted = await extractDisclosurePdfText(new Uint8Array([1]), {
    createParser: () => fakeParser([
      "第一页正式公告文本。".repeat(12),
      "第二页风险提示文本。".repeat(12)
    ]),
    ocrPage: async () => {
      ocrCalls += 1;
      throw new Error("不应调用 OCR");
    }
  });

  assert.equal(extracted.extraction.method, "embedded_text");
  assert.equal(extracted.extraction.coverage, "full_document");
  assert.equal(extracted.extraction.totalPages, 2);
  assert.equal(extracted.extraction.ocrPages, 0);
  assert.equal(ocrCalls, 0);
});

test("scan-only PDF renders and OCRs every page before it can become extracted", async () => {
  const ocrPages: number[] = [];
  const extracted = await extractDisclosurePdfText(new Uint8Array([1]), {
    createParser: () => fakeParser(["", ""]),
    ocrPage: async (_image, pageNumber) => {
      ocrPages.push(pageNumber);
      return { text: `第${pageNumber}页扫描公告原文，包含重大风险与不确定性。`.repeat(8), engine: "fixture-tesseract", languages: ["chi_sim", "eng"] };
    }
  });

  assert.equal(extracted.extraction.method, "ocr");
  assert.equal(extracted.extraction.coverage, "full_document");
  assert.equal(extracted.extraction.totalPages, 2);
  assert.equal(extracted.extraction.extractedPages, 2);
  assert.equal(extracted.extraction.ocrPages, 2);
  assert.deepEqual(ocrPages, [1, 2]);
  assert.match(extracted.text, /重大风险/);
});

test("mixed PDF OCRs only pages without useful embedded text and preserves page order", async () => {
  const ocrPages: number[] = [];
  const extracted = await extractDisclosurePdfText(new Uint8Array([1]), {
    createParser: () => fakeParser(["第一页已有可读正文。".repeat(16), ""]),
    ocrPage: async (_image, pageNumber) => {
      ocrPages.push(pageNumber);
      return { text: "第二页扫描正文，存在监管处罚风险。".repeat(8), engine: "fixture-tesseract", languages: ["chi_sim", "eng"] };
    }
  });

  assert.equal(extracted.extraction.method, "hybrid_ocr");
  assert.equal(extracted.extraction.ocrPages, 1);
  assert.deepEqual(ocrPages, [2]);
  assert.ok(extracted.text.indexOf("第一页") < extracted.text.indexOf("第二页"));
});

test("concurrent disclosure OCR is serialized across the process", async () => {
  let activeOcr = 0;
  let maximumActiveOcr = 0;
  const ocrPage = async (_image: Uint8Array, pageNumber: number) => {
    activeOcr += 1;
    maximumActiveOcr = Math.max(maximumActiveOcr, activeOcr);
    await new Promise((resolve) => setTimeout(resolve, 15));
    activeOcr -= 1;
    return {
      text: `第${pageNumber}页扫描公告原文，包含重大风险与不确定性。`.repeat(8),
      engine: "fixture-tesseract",
      languages: ["chi_sim", "eng"]
    };
  };

  await Promise.all([
    extractDisclosurePdfText(new Uint8Array([1]), {
      createParser: () => fakeParser([""]),
      ocrPage
    }),
    extractDisclosurePdfText(new Uint8Array([2]), {
      createParser: () => fakeParser([""]),
      ocrPage
    })
  ]);

  assert.equal(maximumActiveOcr, 1);
});

test("OCR page, pixel and recognition failures stay explicit instead of accepting partial content", async () => {
  let screenshots = 0;
  await assert.rejects(() => extractDisclosurePdfText(new Uint8Array([1]), {
    createParser: () => fakeParser([""]),
    ocrEnabled: false
  }), /OCR 已禁用/);

  await assert.rejects(() => extractDisclosurePdfText(new Uint8Array([1]), {
    createParser: () => fakeParser(["", "", ""], () => { screenshots += 1; }),
    maxOcrPages: 2,
    ocrPage: async () => ({ text: "不应运行", engine: "fixture", languages: ["chi_sim", "eng"] })
  }), /超过 2 页安全上限/);
  assert.equal(screenshots, 0);

  await assert.rejects(() => extractDisclosurePdfText(new Uint8Array([1]), {
    createParser: () => fakeParser([""]),
    maxTotalPixels: 100,
    ocrPage: async () => ({ text: "不应运行", engine: "fixture", languages: ["chi_sim", "eng"] })
  }), /渲染像素累计超过/);

  await assert.rejects(() => extractDisclosurePdfText(new Uint8Array([1]), {
    createParser: () => fakeParser([""]),
    ocrPage: async () => { throw new Error("OCR runtime missing"); }
  }), /OCR runtime missing/);

  await assert.rejects(() => extractDisclosurePdfText(new Uint8Array([1]), {
    createParser: () => fakeParser([""]),
    ocrPage: async () => ({ text: "太短", engine: "fixture", languages: ["chi_sim", "eng"] })
  }), /原文保持未读/);
});

test("a full OCR receipt is hashed, persisted and reused without redownloading", async () => {
  const item = disclosureItem("ocr-risk", false, true, null, "2026-08-20T00:00:00.000Z");
  const extracted = await extractDisclosureItem(item, {
    download: async () => new Uint8Array([37, 80, 68, 70, 45]),
    extractText: async () => ({
      text: "扫描公告全文：公司收到监管处罚，相关事项存在重大不确定性。".repeat(8),
      extraction: {
        schemaVersion: "disclosure-content-extraction-v1",
        extractorVersion: "pdfparse-tesseract-v1",
        method: "ocr",
        coverage: "full_document",
        totalPages: 2,
        extractedPages: 2,
        ocrPages: 2,
        ocrEngine: "fixture-tesseract",
        ocrLanguages: ["chi_sim", "eng"]
      }
    })
  });
  assert.equal(extracted.contentStatus, "extracted");
  assert.equal(extracted.contentHash?.length, 64);
  assert.equal(extracted.contentExtraction?.method, "ocr");

  const currentEvidence = disclosureEvidence({ ...item, extractionFailure: null });
  const previousEvidence = disclosureEvidence(extracted);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("不应重新下载已完成 OCR 的同一公告"); };
  try {
    const reused = await enrichDisclosureContent(currentEvidence, previousEvidence);
    assert.equal(reused.items[0].contentHash, extracted.contentHash);
    assert.equal(reused.items[0].contentExtraction?.method, "ocr");
    assert.equal(reused.criticalUnreadCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function disclosureItem(
  id: string,
  isFundamentalSource: boolean,
  isCritical: boolean,
  extractionFailure: string | null,
  publishedAt: string
): DisclosureEvidenceItem {
  return {
    id,
    symbol: "600000.SH",
    companyName: "测试银行",
    title: `${id} 2026年半年度报告`,
    publishedAt,
    category: isFundamentalSource ? "periodic_report" : "risk_notice",
    source: "CNINFO",
    sourceUrl: `https://static.cninfo.com.cn/finalpage/2026-08-20/${id}.PDF`,
    contentStatus: "metadata_only",
    contentHash: null,
    contentExcerpt: null,
    extractedCharacters: 0,
    extractionFailure,
    contentExtraction: null,
    isCritical,
    isFundamentalSource,
    adjustedNetIncomeFact: null
  };
}

function fakeParser(pageTexts: string[], onScreenshot?: () => void) {
  return {
    async getText() {
      return {
        text: pageTexts.join("\n\n"),
        total: pageTexts.length,
        pages: pageTexts.map((text, index) => ({ num: index + 1, text }))
      };
    },
    async getScreenshot(input: { partial: number[] }) {
      onScreenshot?.();
      const pageNumber = input.partial[0];
      return {
        total: pageTexts.length,
        pages: [{ data: new Uint8Array([1, 2, 3]), pageNumber, width: 100, height: 100 }]
      };
    },
    async destroy() {}
  };
}

function disclosureEvidence(item: DisclosureEvidenceItem): DisclosureEvidence {
  return {
    schemaVersion: "disclosure-evidence-v2",
    status: "checked",
    provider: "CNINFO",
    queryUrl: "https://www.cninfo.com.cn/new/hisAnnouncement/query",
    checkedAt: "2026-08-25T00:00:00.000Z",
    windowFrom: "2026-01-01",
    windowTo: "2026-08-25",
    latestPublishedAt: item.publishedAt,
    totalCount: 1,
    criticalUnreadCount: item.contentStatus === "metadata_only" ? 1 : 0,
    items: [item],
    failures: []
  };
}
