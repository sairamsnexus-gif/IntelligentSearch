import "server-only";
/**
 * Hosted (Netlify) mode has no database: a single operator account is defined
 * by NEXUS_OPERATOR_EMAIL + NEXUS_OPERATOR_PASSWORD_HASH (scrypt hash produced
 * by `npm run hash-password`). The plain password is never stored anywhere.
 */
import { env } from "@/lib/config/env";
import { DomainError } from "@/lib/errors";
import { verifyPassword } from "./session";

const DUMMY = "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(88);

export function hostedOperatorConfigured(): boolean {
  const e = env();
  return Boolean(e.NEXUS_OPERATOR_EMAIL && e.NEXUS_OPERATOR_PASSWORD_HASH?.startsWith("scrypt$"));
}

export function authenticateOperator(email: string, password: string): { id: string; email: string; role: "admin" } {
  const e = env();
  if (!hostedOperatorConfigured()) {
    verifyPassword(password, DUMMY);
    throw new DomainError("Hosted login is not configured (set NEXUS_OPERATOR_EMAIL and NEXUS_OPERATOR_PASSWORD_HASH)", 503);
  }
  const emailOk = email.trim().toLowerCase() === e.NEXUS_OPERATOR_EMAIL!.trim().toLowerCase();
  const pwOk = verifyPassword(password, emailOk ? e.NEXUS_OPERATOR_PASSWORD_HASH! : DUMMY);
  if (!emailOk || !pwOk) throw new DomainError("Invalid email or password", 401);
  return { id: "operator", email: e.NEXUS_OPERATOR_EMAIL!.trim().toLowerCase(), role: "admin" };
}
