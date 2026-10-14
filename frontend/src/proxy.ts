import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const protectedRoutes = ["/onboarding", "/profile", "/settings", "/admin"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const accessToken = request.cookies.get("access_token")?.value;

  const isProtected = protectedRoutes.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );

  if (isProtected && !accessToken) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/onboarding",
    "/profile/:path*",
    "/settings/:path*",
    // /admin exists in a later phase; listing it now means the guard is already correct
    // when those routes land
    "/admin/:path*",
  ],
};
