import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDisclosureRiskExcerpt,
  isAllowedCninfoPdfUrl,
  selectDisclosureExtractionCandidateIds
} from "@/lib/stock-data/disclosureContent";
import type { DisclosureEvidenceItem } from "@/lib/stock-data/types";

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
    isCritical,
    isFundamentalSource,
    adjustedNetIncomeFact: null
  };
}
