import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

import { getAiConfig, selectAiModel } from "@/lib/ai/config";
import { createChatCompletion } from "@/lib/ai/deepseek";
import { AppError } from "@/lib/errors";
import { newsAnalysisSchema } from "@/lib/schemas";
import { containsCjk, toSimplifiedChinese } from "@/lib/text/simplifiedChinese";
import type { NewsAnalysisResult } from "@/lib/types";

export type AnalyzeNewsInput = {
  title: string;
  url?: string | null;
  source?: string | null;
  publishedAt: string;
  content?: string | null;
  candidateSymbols?: string[];
  candidateSectors?: string[];
  timeoutMs?: number;
};

const systemPrompt =
  "你是一个谨慎的金融新闻证据整理助手。你只能基于提供的新闻内容分析，不得利用模型记忆补造实时事实、原始来源或市场预期。你需要判断情绪、影响级别、相关标的，并结构化提取事件阶段、原始来源、原文明示或推断的市场预期、实际事实、影响期限和证伪条件。没有原文明示基线时 expectation.status 只能是 inferred 或 unavailable。你不能给出确定性投资建议。除 expectation.evidence 必须保留原文短摘录以便程序核验外，所有自然语言解释必须使用简体中文。输出必须是严格 JSON，不要输出 Markdown。";

export async function analyzeNews(input: AnalyzeNewsInput): Promise<NewsAnalysisResult> {
  const config = await getAiConfig();
  if (!config.apiKey) return fallbackNewsAnalysis(input, "API key 未配置，使用关键词规则兜底。");

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl || undefined,
    timeout: input.timeoutMs
  });

  const prompt = buildPrompt(input);
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const request: ChatCompletionCreateParamsNonStreaming = {
        model: selectAiModel(config, "standard"),
        temperature: 0.15,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content:
              attempt === 0
                ? prompt
                : `${prompt}\n\n上一次输出没有通过校验。请只返回严格 JSON，枚举值必须使用英文值。summary、riskNotes、whyItMatters 必须使用简体中文。`
          }
        ]
      };
      const completion = await createChatCompletion(client, request, { timeoutMs: input.timeoutMs });

      const text = completion.choices[0]?.message?.content;
      if (!text) throw new Error("AI 返回了空内容。");
      return newsAnalysisSchema.parse(normalizeNewsAnalysis(parseJsonObject(text), input));
    } catch (error) {
      lastError = error;
      if (error instanceof AppError && (error.code === "DATA_PROVIDER_ERROR" || error.code === "RATE_LIMIT")) break;
    }
  }

  const reason =
    lastError instanceof AppError
      ? `AI 新闻分析请求失败，使用关键词规则兜底。原因：${lastError.message}`
      : `AI 新闻分析返回内容未通过 JSON/schema 校验，使用关键词规则兜底。原因：${lastError instanceof Error ? lastError.message : "未知错误"}`;
  return fallbackNewsAnalysis(input, reason);
}

function buildPrompt(input: AnalyzeNewsInput) {
  return `请分析以下新闻：

标题：
${input.title}

当前文章 URL：
${input.url ?? "未提供"}

来源：
${input.source ?? "未知来源"}

发布时间：
${input.publishedAt}

正文或摘要：
${truncate(input.content ?? input.title, 6000)}

输出语言要求：
1. summary 必须是简体中文，控制在 120 字以内。
2. riskNotes 必须是简体中文数组。
3. whyItMatters 必须是简体中文。
4. sentiment、impactLevel 等枚举值仍然使用英文。
5. 原文标题和链接可以保留原始语言，但不要把英文原文整段复制到 summary。
6. JSON 示例中的枚举字段只能返回一个合法值，例如 sentiment 只能返回 "positive"、"neutral" 或 "negative" 其中之一，不能返回说明文字。
7. eventContext.expectation.status=explicit 只允许用于正文同时明确给出“事前基线/共识”和“实际结果”的情况；expectation.evidence 必须逐字复制能同时证明两者的原文短摘录，禁止翻译、改写或拼接；程序找不到该摘录时会自动降级为 inferred。仅凭语气推测时必须使用 inferred，没有依据时使用 unavailable。
8. originalSource.status=current_source 表示当前文章本身就是公司、交易所、政府或监管原始发布；文章只提到原始来源但没有可核验链接时用 referenced_without_url；不得编造 URL。
9. eventOccurredAt 表示事件实际发生时间，不是文章抓取时间；无法确认时必须为 null。

相关股票候选：
${JSON.stringify(input.candidateSymbols ?? [])}

相关行业候选：
${JSON.stringify(input.candidateSectors ?? [])}

请返回严格 JSON：
{
  "summary": "",
  "sentiment": "neutral",
  "impactLevel": "medium",
  "affectedSymbols": [],
  "affectedSectors": [],
  "riskNotes": [],
  "whyItMatters": "",
  "confidence": 0.0,
  "eventContext": {
    "schemaVersion": "news-event-context-v1",
    "eventOccurredAt": null,
    "informationStage": "unclear",
    "originalSource": { "status": "unavailable", "name": null, "url": null },
    "expectation": {
      "status": "unavailable",
      "baseline": null,
      "actual": null,
      "gapDirection": "unclear",
      "evidence": null
    },
    "expectedImpactHorizon": "unclear",
    "falsifiers": []
  }
}`;
}

function parseJsonObject(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("AI 返回内容不是可解析的 JSON 对象。");
  }
}

export function normalizeNewsAnalysis(value: unknown, input: AnalyzeNewsInput) {
  const record = isRecord(value) ? value : {};
  const riskNotes = toStringArray(record.riskNotes);
  const affectedSectors = toStringArray(record.affectedSectors);
  const impactLevel = normalizeImpact(record.impactLevel ?? record.importance);
  const sentiment = normalizeSentiment(record.sentiment);
  return {
    summary: ensureSimplifiedChineseSummary(toNonEmptyString(record.summary, buildChineseFallbackSummary(input, sentiment, impactLevel)), input, sentiment, impactLevel),
    sentiment,
    impactLevel,
    affectedSymbols: normalizeSymbolArray(record.affectedSymbols, input.candidateSymbols ?? []),
    affectedSectors: affectedSectors.length ? affectedSectors : input.candidateSectors ?? [],
    riskNotes: riskNotes.length && riskNotes.every(containsCjk) ? riskNotes.map(toSimplifiedChinese) : ["新闻分析可能遗漏上下文，请结合原文、公告和市场数据复核。"],
    whyItMatters: ensureSimplifiedChineseText(
      toNonEmptyString(record.whyItMatters, "该新闻可能影响市场情绪或相关主题关注度，但影响需要结合行情验证。"),
      "该新闻可能影响市场情绪或相关主题关注度，但影响需要结合行情验证。"
    ),
    confidence: normalizeConfidence(record.confidence),
    eventContext: normalizeNewsEventContext(record.eventContext, input),
    isFallback: false,
    fallbackReason: null
  };
}

function normalizeSentiment(value: unknown) {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("positive") || text.includes("利好") || text.includes("正面")) return "positive";
  if (text.includes("negative") || text.includes("利空") || text.includes("负面")) return "negative";
  return "neutral";
}

function normalizeImpact(value: unknown) {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("high") || text.includes("高")) return "high";
  if (text.includes("medium") || text.includes("中")) return "medium";
  return "low";
}

function normalizeConfidence(value: unknown) {
  const number = typeof value === "number" ? value : Number(String(value ?? "").replace("%", ""));
  if (!Number.isFinite(number)) return 0.5;
  const normalized = number > 1 ? number / 100 : number;
  return Math.min(1, Math.max(0, normalized));
}

function normalizeSymbolArray(value: unknown, fallback: string[]) {
  const values = Array.isArray(value) ? value : fallback;
  return values.map((item) => String(item ?? "").trim().toUpperCase()).filter((item) => /^[A-Z0-9.\-_:]{1,16}$/.test(item));
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function toNonEmptyString(value: unknown, fallback: string) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function fallbackNewsAnalysis(input: AnalyzeNewsInput, reason: string): NewsAnalysisResult {
  const text = `${input.title} ${input.content ?? ""}`.toLowerCase();
  const negativeTerms = ["risk", "miss", "cut", "probe", "lawsuit", "delay", "weak", "loss", "下滑", "调查", "诉讼", "亏损"];
  const positiveTerms = ["beat", "growth", "upgrade", "launch", "partnership", "demand", "approval", "增长", "上调", "合作", "中标"];
  const sentiment = negativeTerms.some((term) => text.includes(term))
    ? "negative"
    : positiveTerms.some((term) => text.includes(term))
      ? "positive"
      : "neutral";
  const impactLevel = text.includes("fed") || text.includes("earnings") || text.includes("guidance") || text.includes("业绩") ? "medium" : "low";

  return {
    summary: buildChineseFallbackSummary(input, sentiment, impactLevel),
    sentiment,
    impactLevel,
    affectedSymbols: input.candidateSymbols ?? [],
    affectedSectors: input.candidateSectors ?? [],
    riskNotes: [reason],
    whyItMatters: "该消息可能影响市场情绪或短期交易定位，但当前上下文有限。",
    confidence: 0.35,
    eventContext: {
      schemaVersion: "news-event-context-v1",
      eventOccurredAt: null,
      informationStage: "unclear",
      originalSource: { status: "unavailable", name: null, url: null },
      expectation: { status: "unavailable", baseline: null, actual: null, gapDirection: "unclear", evidence: null },
      expectedImpactHorizon: "unclear",
      falsifiers: []
    },
    isFallback: true,
    fallbackReason: reason
  };
}

export function normalizeNewsEventContext(value: unknown, input: AnalyzeNewsInput) {
  const record = isRecord(value) ? value : {};
  const original = isRecord(record.originalSource) ? record.originalSource : {};
  const expectation = isRecord(record.expectation) ? record.expectation : {};
  const originalStatus = normalizeEnum(original.status, ["current_source", "referenced_without_url", "unavailable"] as const, "unavailable");
  const originalName = nullableText(original.name, 120);
  const normalizedOriginalStatus = originalStatus === "current_source" && input.source
    ? "current_source"
    : originalStatus === "referenced_without_url" && originalName
      ? "referenced_without_url"
      : "unavailable";
  const baseline = evidenceText(expectation.baseline, "预期基线");
  const actual = evidenceText(expectation.actual, "实际事实");
  const evidenceExcerpt = nullableText(expectation.evidence, 360);
  const evidence = evidenceExcerpt ? toSimplifiedChinese(evidenceExcerpt) : null;
  const evidenceGrounded = evidenceExcerpt
    ? sourceContainsExactExcerpt(evidenceExcerpt, `${input.title}\n${input.content ?? ""}`)
    : false;
  const requestedExpectationStatus = normalizeEnum(expectation.status, ["explicit", "inferred", "unavailable"] as const, "unavailable");
  const expectationStatus = requestedExpectationStatus === "explicit" && baseline && actual && evidence && evidenceGrounded
    ? "explicit"
    : requestedExpectationStatus !== "unavailable" && (baseline || actual || evidence)
      ? "inferred"
      : "unavailable";
  const gapDirection = expectationStatus === "unavailable"
    ? "unclear"
    : normalizeEnum(expectation.gapDirection, ["positive", "negative", "neutral", "unclear"] as const, "unclear");

  return {
    schemaVersion: "news-event-context-v1" as const,
    eventOccurredAt: normalizePastEventTimestamp(record.eventOccurredAt, input.publishedAt),
    informationStage: normalizeEnum(record.informationStage, ["first_report", "follow_up", "reprint", "unclear"] as const, "unclear"),
    originalSource: {
      status: normalizedOriginalStatus,
      name: normalizedOriginalStatus === "unavailable" ? null : originalName ?? input.source ?? null,
      url: normalizedOriginalStatus === "current_source" ? input.url ?? null : null
    },
    expectation: {
      status: expectationStatus,
      baseline: expectationStatus === "unavailable" ? null : baseline,
      actual: expectationStatus === "unavailable" ? null : actual,
      gapDirection,
      evidence: expectationStatus === "unavailable" ? null : evidence
    },
    expectedImpactHorizon: normalizeEnum(record.expectedImpactHorizon, ["days", "quarters", "long_term", "unclear"] as const, "unclear"),
    falsifiers: toStringArray(record.falsifiers)
      .slice(0, 6)
      .map((item) => evidenceText(item, "证伪条件"))
      .filter((item): item is string => Boolean(item))
  };
}

function buildChineseFallbackSummary(input: AnalyzeNewsInput, sentiment: string, impactLevel: string) {
  const title = truncate(input.title.replace(/\s+/g, " ").trim(), 80);
  const source = input.source ? `来自 ${input.source}，` : "";
  return toSimplifiedChinese(`${source}该新闻围绕“${title}”。系统初步判断情绪为${sentimentLabel(sentiment)}、影响级别为${impactLabel(impactLevel)}，具体影响需结合原文和行情确认。`);
}

function ensureSimplifiedChineseSummary(value: string, input: AnalyzeNewsInput, sentiment: string, impactLevel: string) {
  return containsCjk(value) ? truncate(toSimplifiedChinese(value), 180) : buildChineseFallbackSummary(input, sentiment, impactLevel);
}

function ensureSimplifiedChineseText(value: string, fallback: string) {
  return containsCjk(value) ? toSimplifiedChinese(value) : fallback;
}

function sentimentLabel(value: string) {
  if (value === "positive") return "正面";
  if (value === "negative") return "负面";
  return "中性";
}

function impactLabel(value: string) {
  if (value === "high") return "高";
  if (value === "medium") return "中";
  return "低";
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function normalizeEnum<const T extends readonly string[]>(value: unknown, values: T, fallback: T[number]) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return (values as readonly string[]).includes(normalized) ? normalized as T[number] : fallback;
}

function nullableText(value: unknown, maxLength: number) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, maxLength) : null;
}

function evidenceText(value: unknown, label: string) {
  const text = nullableText(value, 360);
  if (!text) return null;
  return toSimplifiedChinese(containsCjk(text) ? text : `${label}：${text}`);
}

function normalizePastEventTimestamp(value: unknown, publishedAt: string) {
  const parsed = Date.parse(String(value ?? ""));
  const published = Date.parse(publishedAt);
  if (!Number.isFinite(parsed) || !Number.isFinite(published)) return null;
  // 容许来源时区或只给日期造成的一天偏差，但拒绝把未来计划时间冒充已发生事件。
  return parsed <= published + 24 * 60 * 60 * 1000 ? new Date(parsed).toISOString() : null;
}

function sourceContainsExactExcerpt(excerpt: string, source: string) {
  const normalizedExcerpt = normalizeForEvidenceMatch(excerpt);
  const normalizedSource = normalizeForEvidenceMatch(source);
  return normalizedExcerpt.length >= 8 && normalizedSource.includes(normalizedExcerpt);
}

function normalizeForEvidenceMatch(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}%]+/gu, "");
}
