import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/currentUser";
import { apiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const user = await getCurrentUser();
    const today = startOfDay(new Date());
    const brief = await prisma.dailyMarketBrief.findUnique({
      where: {
        userId_date: {
          userId: user.id,
          date: today
        }
      }
    });

    return NextResponse.json({ brief });
  } catch (error) {
    return apiError(error);
  }
}

function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

