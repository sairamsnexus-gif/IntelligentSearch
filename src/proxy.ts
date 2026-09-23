import { NextResponse, type NextRequest } from "next/server";

/**
 * Cheap gate: bounce requests without a session cookie to /login. Real
 * signature/role verification happens server-side in every page (requireUser)
 * and API handler (api()) — this is UX, not the security boundary.
 */
const PUBLIC = [/^\/login$/, /^\/setup$/, /^\/api\/auth\//];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  if (req.cookies.get("is_session")?.value) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
