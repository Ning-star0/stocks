import { NextRequest, NextResponse } from "next/server";

import { AUTH_COOKIE_NAME } from "@/lib/authConstants";

const PUBLIC_FILE_PATTERN = /\.(?:png|jpg|jpeg|gif|webp|svg|ico|txt|xml|webmanifest)$/i;

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname === "/login" || pathname.startsWith("/api/auth/");
  const isHealthRoute = pathname === "/api/health";
  const isPublicAsset = pathname.startsWith("/_next/") || PUBLIC_FILE_PATTERN.test(pathname);
  if (isAuthRoute || isHealthRoute || isPublicAsset) return NextResponse.next();

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
  matcher: ["/:path*"]
};
