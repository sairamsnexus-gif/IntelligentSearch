import "server-only";
import { count, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { hashPassword, verifyPassword } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors";
import { audit } from "./timeline";

export async function userCount(): Promise<number> {
  const db = await getDb();
  const [r] = await db.select({ n: count() }).from(schema.users);
  return Number(r.n);
}

/** First-run setup: only allowed while no user exists. First user is admin. */
export async function createFirstAdmin(email: string, password: string) {
  if ((await userCount()) > 0) throw new DomainError("Setup already completed", 409);
  return createUser(email, password, "admin");
}

export async function createUser(email: string, password: string, role: "admin" | "analyst") {
  const db = await getDb();
  const e = email.trim().toLowerCase();
  const existing = await db.query.users.findFirst({ where: eq(schema.users.email, e) });
  if (existing) throw new DomainError("User already exists", 409);
  const [u] = await db.insert(schema.users).values({ email: e, passwordHash: hashPassword(password), role }).returning();
  await audit(u.id, "user.create", u.id, { role });
  return u;
}

export async function authenticate(email: string, password: string) {
  const db = await getDb();
  const u = await db.query.users.findFirst({ where: eq(schema.users.email, email.trim().toLowerCase()) });
  // Constant-ish time: always run a hash comparison.
  const ok = u ? verifyPassword(password, u.passwordHash) : verifyPassword(password, "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(88));
  if (!u || !ok) {
    await audit(null, "auth.failed", null, {});
    throw new DomainError("Invalid email or password", 401);
  }
  await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, u.id));
  await audit(u.id, "auth.login", u.id);
  return u;
}
