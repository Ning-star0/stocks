import { getCurrentUser } from "@/lib/currentUser";
import { apiError } from "@/lib/errors";
import { generateAndStoreFocusDecision, getLatestStoredFocusDecision } from "@/lib/focus/decision";

export async function GET() {
  try {
    const user = await getCurrentUser();
    const decision = await getLatestStoredFocusDecision(user.id);
    if (!decision) {
      return Response.json({
        decisionUnavailable: true,
        message: "还没有定时生成的买入决策。到达你设置的自动分析时间后，系统会自动生成并保存。"
      });
    }
    return Response.json(decision);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST() {
  try {
    const user = await getCurrentUser();
    const decision = await generateAndStoreFocusDecision({
      userId: user.id,
      forceRefresh: true,
      source: "manual"
    });
    return Response.json(decision);
  } catch (error) {
    return apiError(error);
  }
}
