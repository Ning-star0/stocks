import { createHmac, timingSafeEqual } from "node:crypto";

const FEEDBACK_ACTIONS = new Set(["bought", "sold", "watched", "skipped", "other"]);

export function normalizeFeedbackAction(value?: string | null) {
  const action = String(value ?? "").trim().toLowerCase();
  return FEEDBACK_ACTIONS.has(action) ? action : "other";
}

export function feedbackActionLabel(action: string) {
  const map: Record<string, string> = {
    bought: "已买入/增持",
    sold: "已卖出/减仓",
    watched: "继续观察",
    skipped: "未采纳/暂不操作",
    other: "其他决策"
  };
  return map[action] ?? map.other;
}

export function buildDecisionFeedbackUrl(input: { userId: string; decisionId?: string | null; action?: string | null }) {
  if (!input.decisionId) return null;
  const url = new URL("/feedback/decision", appBaseUrl());
  url.searchParams.set("decisionId", input.decisionId);
  url.searchParams.set("token", buildDecisionFeedbackToken({ userId: input.userId, decisionId: input.decisionId }));
  if (input.action) url.searchParams.set("action", normalizeFeedbackAction(input.action));
  return url.toString();
}

export function buildDecisionFeedbackToken(input: { userId: string; decisionId: string }) {
  return createHmac("sha256", feedbackSecret())
    .update(`${input.userId}:${input.decisionId}`)
    .digest("hex")
    .slice(0, 40);
}

export function verifyDecisionFeedbackToken(input: { userId: string; decisionId: string; token?: string | null }) {
  const token = String(input.token ?? "");
  const expected = buildDecisionFeedbackToken(input);
  if (token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

function appBaseUrl() {
  return (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://aurorastar.cn").replace(/\/+$/, "");
}

function feedbackSecret() {
  return process.env.FEEDBACK_TOKEN_SECRET || process.env.NEXTAUTH_SECRET || "stock-ai-feedback-local-secret";
}
