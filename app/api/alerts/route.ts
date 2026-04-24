import { NextRequest, NextResponse } from "next/server";

import { evaluateAlertsForUser } from "@/lib/alerts/evaluateAlerts";
import { getCurrentUser } from "@/lib/currentUser";
import { apiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { alertRuleSchema } from "@/lib/schemas";
import { serializeAlert } from "@/lib/serializers";

export async function GET() {
  try {
    const user = await getCurrentUser();
    const evaluations = await evaluateAlertsForUser(user.id);
    return NextResponse.json({ alerts: evaluations.map((result) => ({ ...result.alert, currentValue: result.currentValue, evaluationReason: result.reason ?? null })) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const body = alertRuleSchema.parse(await request.json());
    const alert = await prisma.alert.create({
      data: {
        userId: user.id,
        symbol: body.symbol,
        alertType: body.alertType,
        operator: body.operator,
        threshold: body.threshold,
        isActive: body.isActive
      }
    });

    return NextResponse.json({ alert: serializeAlert(alert) }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
