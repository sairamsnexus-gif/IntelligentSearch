import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { SESSION_COOKIE, verifySession, type SessionPayload } from "@/lib/auth/session";
import { SlidingWindowLimiter } from "@/lib/security/rate-limit";
import { log } from "@/lib/security/logger";
import { DomainError } from "@/lib/errors";
import { ensureWorker } from "@/lib/services/bootstrap";

type Access = "public" | "user" | "admin";

interface Opts {
  access?: Access;
  /** requests per minute per user/IP */
  rpm?: number;
}

const g = globalThis as unknown as { __isLimiters?: Map<number, SlidingWindowLimiter> };
const limiters = (g.__isLimiters ??= new Map());
function limiter(rpm: number) {
  let l = limiters.get(rpm);
  if (!l) limiters.set(rpm, (l = new SlidingWindowLimiter(rpm, 60_000)));
  return l;
}

export interface ApiContext<P> {
  req: NextRequest;
  user: SessionPayload | null;
  params: P;
}

function clientIp(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

/** Reject cross-site mutating requests (defence in depth on top of SameSite=Lax). */
function sameOrigin(req: NextRequest): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients
  try {
    return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
  } catch {
    return false;
  }
}

export function api<P = Record<string, string>>(fn: (ctx: ApiContext<P>) => Promise<unknown>, opts: Opts = {}) {
  return async (req: NextRequest, route: { params: Promise<P> }) => {
    ensureWorker();
    try {
      if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
      const user = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
      const access = opts.access ?? "user";
      if (access !== "public" && !user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
      if (access === "admin" && user?.role !== "admin") return NextResponse.json({ error: "Admin role required" }, { status: 403 });
      const rl = limiter(opts.rpm ?? 120).check(`${user?.uid ?? clientIp(req)}:${req.nextUrl.pathname.split("/").slice(0, 3).join("/")}`);
      if (!rl.ok) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } });
      const params = (await route?.params) ?? ({} as P);
      const out = await fn({ req, user, params });
      if (out instanceof NextResponse) return out;
      return NextResponse.json(out ?? { ok: true });
    } catch (e) {
      if (e instanceof ZodError) return NextResponse.json({ error: "Invalid input", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400 });
      if (e instanceof DomainError) return NextResponse.json({ error: e.message }, { status: e.status });
      log.error("api.error", { path: req.nextUrl.pathname, error: e instanceof Error ? e.message : "unknown" });
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  };
}

export async function body<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new DomainError("Body must be JSON");
  }
  return schema.parse(raw);
}
