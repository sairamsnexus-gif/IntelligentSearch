import { NextResponse, type NextRequest } from "next/server";

/**
 * Cheap gate: bounce requests without a session cookie to /login. Real
 * signature/role verification happens server-side in every page (requireUser)
 * and API handler (api()) — this is UX, not the security boundary.
 */
const PUBLIC = [/^\/login$/, /^\/setup$/, /^\/api\/auth\//];

/** Legacy database-backed features are unavailable in hosted (no-database) mode. */
const LEGACY = [/^\/(person-search|monitor|admin|persons|demo-source)(\/|$)/, /^\/api\/(searches|persons|admin|system)(\/|$)/];
const hosted = () => process.env.NEXUS_HOSTED === "true" || (process.env.NEXUS_HOSTED !== "false" && Boolean(process.env.NETLIFY));

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (hosted() && LEGACY.some((re) => re.test(pathname))) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Not available in hosted mode (no database). Run NEXUS locally for this feature." }, { status: 404 });
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
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
