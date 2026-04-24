import { NextRequest, NextResponse } from "next/server";

const AUTH_COOKIE_NAME = "stock_ai_session";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname === "/login" || pathname.startsWith("/api/auth/");
  const isPublicAsset = pathname.startsWith("/_next/") || pathname === "/favicon.ico";
  if (isAuthRoute || isPublicAsset) return NextResponse.next();

  const hasSessionCookie = Boolean(request.cookies.get(AUTH_COOKIE_NAME)?.value);
  if (hasSessionCookie) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "\u8bf7\u5148\u767b\u5f55\u3002" } }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!.*\\..*).*)"]
};
