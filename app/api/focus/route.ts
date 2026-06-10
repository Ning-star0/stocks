import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/currentUser";
import { apiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { readRequestJson } from "@/lib/serverApi";
import { focusGroupSchema } from "@/lib/schemas";

export async function GET() {
  try {
    const user = await getCurrentUser();
    const group = await prisma.focusGroup.findUnique({ where: { userId: user.id } });
    if (!group) return NextResponse.json({ symbols: [], name: "今日关注", capital: null, newsFetchTime: "09:30", analysisTimes: [], lastNewsFetch: null, lastAnalysis: null });
    return NextResponse.json(group);
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser();
    const body = focusGroupSchema.parse(await readRequestJson(request));

    const group = await prisma.focusGroup.upsert({
      where: { userId: user.id },
      update: {
        name: body.name,
        symbols: body.symbols,
        capital: body.capital ?? null,
        newsFetchTime: body.newsFetchTime,
        analysisTimes: body.analysisTimes,
        updatedAt: new Date()
      },
      create: {
        userId: user.id,
        name: body.name,
        symbols: body.symbols,
        capital: body.capital ?? null,
        newsFetchTime: body.newsFetchTime,
        analysisTimes: body.analysisTimes
      }
    });

    return NextResponse.json(group);
  } catch (error) {
    return apiError(error);
  }
}
