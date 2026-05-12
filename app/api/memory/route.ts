import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/currentUser";
import { apiError } from "@/lib/errors";
import { getMemory, updateMemory } from "@/lib/memory";

export async function GET() {
  try {
    const user = await getCurrentUser();
    const memory = await getMemory(user.id);
    return NextResponse.json({ content: memory.content, updatedAt: memory.updatedAt });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser();
    const body = await request.json();
    const content = String(body.content ?? "").trim();
    await updateMemory(user.id, content);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
