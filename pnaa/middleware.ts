import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/chapters",
  "/events",
  "/fundraising",
  "/about",
  "/users",
  "/setup",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const response = NextResponse.next({ request });

  // (#18) Skip the session refresh on /signin when no Supabase cookie is
  // present. Most signin loads are unauthenticated users; touching getUser()
  // for them adds latency to the only public page.
  const hasSupabaseCookie = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-"));
  if (pathname === "/signin" && !hasSupabaseCookie) {
    return response;
  }

  // Build a request-scoped Supabase client that can refresh the session and
  // write rotated cookies back to the response.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(toSet: { name: string; value: string; options: CookieOptions }[]) {
          for (const { name, value, options } of toSet) {
            response.cookies.set(name, value, options as CookieOptions);
          }
        },
      },
    }
  );

  const { data } = await supabase.auth.getUser();
  const isAuthed = !!data.user;

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (isProtected && !isAuthed) {
    return NextResponse.redirect(new URL("/signin", request.url));
  }

  if (pathname === "/signin" && isAuthed) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/chapters/:path*",
    "/events/:path*",
    "/fundraising/:path*",
    "/about/:path*",
    "/users/:path*",
    "/setup",
    "/signin",
  ],
};
