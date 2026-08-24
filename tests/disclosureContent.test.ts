import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDisclosureRiskExcerpt,
  isAllowedCninfoPdfUrl
} from "@/lib/stock-data/disclosureContent";

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
