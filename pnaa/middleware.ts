import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get("firebase_token")?.value;

  // Protected routes — redirect to signin if no token
  if (
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/chapters") ||
    pathname.startsWith("/events") ||
    pathname.startsWith("/fundraising") ||
    pathname.startsWith("/about") ||
    pathname.startsWith("/users")
  ) {
    if (!token) {
      return NextResponse.redirect(new URL("/signin", request.url));
    }
  }

  // If authenticated user visits signin, redirect to dashboard
  if (pathname === "/signin" && token) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/chapters/:path*",
    "/events/:path*",
    "/fundraising/:path*",
    "/about/:path*",
    "/users/:path*",
    "/signin",
  ],
};
