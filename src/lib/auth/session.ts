import "server-only";
/**
 * Stateless signed session cookie (HMAC-SHA256). Payload holds only the user
 * id, role and expiry. Passwords are hashed with scrypt.
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { env } from "@/lib/config/env";

export const SESSION_COOKIE = "is_session";
const MAX_AGE_S = 60 * 60 * 12;

export interface SessionPayload {
  uid: string;
  role: "admin" | "analyst";
  email: string;
  exp: number;
}

let cachedSecret: string | null = null;

/** AUTH_SECRET, or (development only) a random secret persisted in ./.data/auth-secret. */
export function authSecret(): string {
  if (cachedSecret) return cachedSecret;
  const configured = env().AUTH_SECRET;
  if (configured) return (cachedSecret = configured);
  if (env().APP_ENV === "production") throw new Error("AUTH_SECRET must be set in production");
  const file = path.resolve(".data/auth-secret");
  try {
    cachedSecret = fs.readFileSync(file, "utf8").trim();
  } catch {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    cachedSecret = randomBytes(32).toString("hex");
    fs.writeFileSync(file, cachedSecret, { mode: 0o600 });
  }
  return cachedSecret;
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");

export function signSession(p: Omit<SessionPayload, "exp">, now = Date.now()): string {
  const payload: SessionPayload = { ...p, exp: Math.floor(now / 1000) + MAX_AGE_S };
  const body = b64(JSON.stringify(payload));
  const sig = createHmac("sha256", authSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySession(token: string | undefined | null, now = Date.now()): SessionPayload | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", authSecret()).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (typeof p.exp !== "number" || p.exp * 1000 < now) return null;
    return p;
  } catch {
    return null;
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, saltB64, hashB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(actual, expected);
}

export async function currentUser(): Promise<SessionPayload | null> {
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value);
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_S,
};
