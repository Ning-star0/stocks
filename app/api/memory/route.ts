import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/currentUser";
import { apiError } from "@/lib/errors";
import { addMemoryEntries, deleteMemoryEntry, getMemoryState, updateMemory } from "@/lib/memory";

export async function GET() {
  try {
    const user = await getCurrentUser();
    const memory = await getMemoryState(user.id);
    return NextResponse.json(memory);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    const body = await request.json();
    const text = String(body.text ?? "").trim();
    const entries = await addMemoryEntries(user.id, text, "manual");
    return NextResponse.json({ ok: true, entries });
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

export async function DELETE(request: Request) {
  try {
    const user = await getCurrentUser();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: { code: "BAD_REQUEST", message: "缺少记忆 ID。" } }, { status: 400 });
    const entries = await deleteMemoryEntry(user.id, id);
    return NextResponse.json({ ok: true, entries });
  } catch (error) {
    return apiError(error);
  }
}
