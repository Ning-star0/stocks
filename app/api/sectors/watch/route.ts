import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/currentUser";
import { apiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { sectorWatchSchema } from "@/lib/schemas";

export async function GET() {
  try {
    const user = await getCurrentUser();
    const sectorWatches = await prisma.sectorWatch.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" }
    });
    return NextResponse.json({ sectorWatches });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const body = sectorWatchSchema.parse(await request.json());
    const sectorWatch = await prisma.sectorWatch.create({
      data: {
        userId: user.id,
        sectorName: body.sectorName,
        keywords: body.keywords,
        symbols: body.symbols
      }
    });
    return NextResponse.json({ sectorWatch }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

