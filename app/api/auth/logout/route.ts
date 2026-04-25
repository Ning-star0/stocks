import { NextResponse } from "next/server";

import { clearSessionCookieData } from "@/lib/auth";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  const cookie = clearSessionCookieData();
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
