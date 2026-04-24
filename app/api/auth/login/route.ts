import { NextResponse } from "next/server";

import { authenticateAdmin, createSessionCookie } from "@/lib/auth";
import { apiError } from "@/lib/errors";
import { loginSchema } from "@/lib/schemas";

export async function POST(request: Request) {
  try {
    const body = loginSchema.parse(await request.json());
    const user = await authenticateAdmin(body.email, body.password);
    await createSessionCookie(user.email);
    return NextResponse.json({ user });
  } catch (error) {
    return apiError(error);
  }
}
