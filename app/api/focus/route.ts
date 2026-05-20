import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/currentUser";
import { AppError, apiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const user = await getCurrentUser();
    const group = await prisma.focusGroup.findUnique({ where: { userId: user.id } });
    if (!group) return NextResponse.json({ symbols: [], name: "今日关注", newsFetchTime: "09:30", analysisTimes: [], lastNewsFetch: null, lastAnalysis: null });
    return NextResponse.json(group);
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser();
    const body = await request.json();

    const symbols = Array.isArray(body.symbols) ? body.symbols.map((s: string) => String(s).trim().toUpperCase()).filter(Boolean) : [];
    if (!symbols.length) throw new AppError("BAD_REQUEST", "请至少选择一只股票。");

    const analysisTimes = Array.isArray(body.analysisTimes)
      ? body.analysisTimes.map((t: string) => String(t).trim()).filter((t: string) => /^\d{1,2}:\d{2}$/.test(t))
      : [];

    const newsFetchTime = String(body.newsFetchTime ?? "09:30").trim();
    if (!/^\d{1,2}:\d{2}$/.test(newsFetchTime)) throw new AppError("BAD_REQUEST", "新闻抓取时间格式应为 HH:mm。");

    const group = await prisma.focusGroup.upsert({
      where: { userId: user.id },
      update: {
        name: String(body.name ?? "今日关注").trim() || "今日关注",
        symbols,
        newsFetchTime,
        analysisTimes,
        updatedAt: new Date()
      },
      create: {
        userId: user.id,
        name: String(body.name ?? "今日关注").trim() || "今日关注",
        symbols,
        newsFetchTime,
        analysisTimes
      }
    });

    return NextResponse.json(group);
  } catch (error) {
    return apiError(error);
  }
}
