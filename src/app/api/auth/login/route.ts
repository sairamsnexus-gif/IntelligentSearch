import { NextResponse } from "next/server";
import { z } from "zod";
import { api, body } from "@/lib/api/handler";
import { cookieOptions, SESSION_COOKIE, signSession } from "@/lib/auth/session";
import { authenticate } from "@/lib/services/users";
import { authenticateOperator } from "@/lib/auth/operator";
import { isHosted } from "@/lib/nexus/engines";

const schema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

export const POST = api(
  async ({ req }) => {
    const { email, password } = await body(req, schema);
    const u = isHosted() ? authenticateOperator(email, password) : await authenticate(email, password);
    const res = NextResponse.json({ ok: true, role: u.role });
    res.cookies.set(SESSION_COOKIE, signSession({ uid: u.id, role: u.role as "admin" | "analyst", email: u.email }), cookieOptions);
    return res;
  },
  { access: "public", rpm: 10 },
);
