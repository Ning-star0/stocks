import { NextResponse } from "next/server";

import { authenticateAdmin, createSessionCookieData } from "@/lib/auth";
import { apiError } from "@/lib/errors";
import { loginSchema } from "@/lib/schemas";

export async function POST(request: Request) {
  try {
    const body = loginSchema.parse(await request.json());
    const user = await authenticateAdmin(body.email, body.password);
    const response = NextResponse.json({ user });
    const cookie = createSessionCookieData(user.email);
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  } catch (error) {
    return apiError(error);
  }
}
