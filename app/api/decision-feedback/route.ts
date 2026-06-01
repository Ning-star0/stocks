import { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/currentUser";
import { feedbackActionLabel, normalizeFeedbackAction, verifyDecisionFeedbackToken } from "@/lib/decisionFeedback";
import { apiError, AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const input = await parseFeedbackInput(request);
    const decision = await prisma.focusDecision.findUnique({
      where: { id: input.decisionId },
      select: { id: true, userId: true }
    });
    if (!decision) throw new AppError("BAD_REQUEST", "这条 AI 决策不存在。");
    await assertCanWriteFeedback({ userId: decision.userId, decisionId: decision.id, token: input.token });

    const action = normalizeFeedbackAction(input.feedbackAction);
    const note = input.note.trim() || null;
    const executedPrice = parsePositiveNumber(input.executedPrice);
    const executedShares = parsePositiveNumber(input.executedShares);
    const feedback = await prisma.decisionFeedback.upsert({
      where: { decisionId: decision.id },
      create: {
        userId: decision.userId,
        decisionId: decision.id,
        feedbackAction: action,
        note,
        executedPrice,
        executedShares
      },
      update: {
        feedbackAction: action,
        note,
        executedPrice,
        executedShares
      }
    });

    if (input.respondWithJson) {
      return Response.json({
        ok: true,
        feedback: {
          id: feedback.id,
          action,
          label: feedbackActionLabel(action),
          note: feedback.note,
          executedPrice: feedback.executedPrice ? Number(feedback.executedPrice) : null,
          executedShares: feedback.executedShares ? Number(feedback.executedShares) : null,
          updatedAt: feedback.updatedAt.toISOString()
        }
      });
    }

    const url = new URL("/feedback/decision", request.url);
    url.searchParams.set("decisionId", decision.id);
    url.searchParams.set("token", input.token);
    url.searchParams.set("action", action);
    url.searchParams.set("saved", "1");
    return Response.redirect(url, 303);
  } catch (error) {
    return apiError(error);
  }
}

async function assertCanWriteFeedback(input: { userId: string; decisionId: string; token?: string | null }) {
  if (verifyDecisionFeedbackToken(input)) return;

  const currentUser = await getCurrentUser().catch(() => null);
  if (currentUser?.id === input.userId) return;

  throw new AppError("UNAUTHORIZED", "反馈链接已失效，或当前账号无权修改这条反馈。");
}

async function parseFeedbackInput(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    return {
      decisionId: String(body.decisionId ?? ""),
      token: String(body.token ?? ""),
      feedbackAction: String(body.feedbackAction ?? body.action ?? ""),
      note: String(body.note ?? ""),
      executedPrice: body.executedPrice,
      executedShares: body.executedShares,
      respondWithJson: true
    };
  }
  const form = await request.formData();
  return {
    decisionId: String(form.get("decisionId") ?? ""),
    token: String(form.get("token") ?? ""),
    feedbackAction: String(form.get("feedbackAction") ?? form.get("action") ?? ""),
    note: String(form.get("note") ?? ""),
    executedPrice: form.get("executedPrice"),
    executedShares: form.get("executedShares"),
    respondWithJson: false
  };
}

function parsePositiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}
