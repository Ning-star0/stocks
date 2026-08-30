import assert from "node:assert/strict";
import test from "node:test";

import {
  NEWS_INDUSTRY_CLASSIFICATION_SCHEMA_VERSION,
  resolveStoredIndustryClassification
} from "@/lib/news/industryClassification";
import { resolveSharedSectorTopic } from "@/lib/news/relevance";

const symbol = "600000.SH";
const fetchedAt = "2026-08-25T01:00:00.000Z";

test("fresh persisted EM2016 classification becomes auditable shared-topic evidence", () => {
  const evidence = resolveStoredIndustryClassification({
    symbol,
    fundamentalsJson: fundamentalsWithIndustry("航空运输", fetchedAt),
    asOf: new Date("2026-08-25T02:00:00.000Z")
  });

  assert.equal(evidence.schemaVersion, NEWS_INDUSTRY_CLASSIFICATION_SCHEMA_VERSION);
  assert.equal(evidence.status, "verified");
  assert.equal(evidence.industryName, "航空运输");
  assert.equal(evidence.evidenceHash?.length, 64);

  const topic = resolveSharedSectorTopic(["甲航股份", "600000"], evidence);
  assert.match(topic?.key ?? "", /^sector-topic-v2:eastmoney-em2016:[a-f0-9]{16}$/);
  assert.equal(topic?.source, "verified_industry_v1");
  assert.deepEqual(topic?.keywords, ["航空运输"]);
  assert.equal(topic?.keywords.some((keyword) => keyword.includes("甲航") || keyword.includes("600000")), false);
});

test("two stocks with the same verified unknown industry share the same deterministic key", () => {
  const first = resolveStoredIndustryClassification({
    symbol: "600000.SH",
    fundamentalsJson: fundamentalsWithIndustry("航空运输", fetchedAt, "600000.SH"),
    asOf: new Date("2026-08-25T02:00:00.000Z")
  });
  const second = resolveStoredIndustryClassification({
    symbol: "600001.SH",
    fundamentalsJson: fundamentalsWithIndustry("航空运输", fetchedAt, "600001.SH"),
    asOf: new Date("2026-08-25T02:00:00.000Z")
  });

  assert.equal(resolveSharedSectorTopic(["甲公司"], first)?.key, resolveSharedSectorTopic(["乙公司"], second)?.key);
});

test("stale, future-dated and mismatched classifications remain visible but cannot be shared", () => {
  const stale = resolveStoredIndustryClassification({
    symbol,
    fundamentalsJson: fundamentalsWithIndustry("航空运输", fetchedAt),
    asOf: new Date("2026-08-26T02:00:00.001Z")
  });
  const future = resolveStoredIndustryClassification({
    symbol,
    fundamentalsJson: fundamentalsWithIndustry("航空运输", "2026-08-25T03:00:00.000Z"),
    asOf: new Date("2026-08-25T02:00:00.000Z")
  });
  const mismatch = resolveStoredIndustryClassification({
    symbol,
    fundamentalsJson: fundamentalsWithIndustry("航空运输", fetchedAt, "600001.SH"),
    asOf: new Date("2026-08-25T02:00:00.000Z")
  });

  assert.equal(stale.status, "stale");
  assert.equal(future.status, "conflicted");
  assert.match(future.missingReason ?? "", /未来证据/);
  assert.equal(mismatch.status, "conflicted");
  assert.equal(resolveSharedSectorTopic(["甲公司"], stale), null);
  assert.equal(resolveSharedSectorTopic(["甲公司"], future), null);
  assert.equal(resolveSharedSectorTopic(["甲公司"], mismatch), null);
});

test("missing and invalid source URL fall back without guessing, while known aliases still work", () => {
  const missing = resolveStoredIndustryClassification({ symbol, fundamentalsJson: null });
  const invalidSource = fundamentalsWithIndustry("航空运输", fetchedAt);
  ((invalidSource as Record<string, any>).valuation.peerEvidence as Record<string, unknown>).classificationSourceUrl =
    "https://example.com/PC_HSF10/CompanySurvey/PageAjax?code=SH600000";
  const conflicted = resolveStoredIndustryClassification({
    symbol,
    fundamentalsJson: invalidSource,
    asOf: new Date("2026-08-25T02:00:00.000Z")
  });

  assert.equal(missing.status, "missing");
  assert.equal(conflicted.status, "conflicted");
  assert.equal(resolveSharedSectorTopic(["甲公司"], missing), null);
  assert.equal(resolveSharedSectorTopic(["电网设备", "特高压"], missing)?.key, "sector-topic-v1:power-grid");
});

function fundamentalsWithIndustry(industryName: string, timestamp: string, targetSymbol: string = symbol) {
  const [code, exchange] = targetSymbol.split(".");
  return {
    valuation: {
      peerEvidence: {
        schemaVersion: "peer-valuation-v1",
        provider: "EASTMONEY",
        classificationMethod: "EASTMONEY_EM2016",
        targetSymbol,
        industryName,
        classificationSourceUrl: `https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/PageAjax?code=${exchange}${code}`,
        fetchedAt: timestamp,
        contentHash: "a".repeat(64)
      }
    }
  };
}
