import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Authenticated / private surfaces that must never be indexed. These routes
// are all "use client" components (Supabase-auth gated), so they cannot
// export page-level `metadata` — this middleware is the enforcement point
// instead, matching the pattern used by the sibling "kron" app.
const NOINDEX_PREFIXES = ["/aidat", "/login"];

function shouldNoindex(pathname: string) {
  return NOINDEX_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  if (shouldNoindex(request.nextUrl.pathname)) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
